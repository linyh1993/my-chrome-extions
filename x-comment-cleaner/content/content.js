/**
 * X Spam Reply Cleaner - Content Script
 */

(function () {
  'use strict';

  const rulesEngine = globalThis.XCleanerRules || {};
  const evaluateSpamFn = rulesEngine.evaluateReplySpam || globalThis.evaluateReplySpam || (() => ({ isSpam: false }));
  const normalizeHandleFn = rulesEngine.normalizeHandle || ((h) => (h || '').replace(/^@+/, '').toLowerCase());

  // X Web Bearer token (publicly used by twitter/x web client)
  const X_WEB_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const USER_BY_SCREEN_NAME_QUERY_ID = '32pL5BWe9WKeSK1MoPvFQQ';
  const USER_FEATURES = encodeURIComponent('{"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":true,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"longform_notetweets_inline_media_enabled":false,"longform_notetweets_rich_text_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":false,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"tweet_awards_web_tipping_enabled":false,"articles_preview_enabled":false,"responsive_web_jetfuel_frame":false,"responsive_web_enhance_cards_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"standardized_nudges_misinfo":false,"view_counts_everywhere_api_enabled":false,"rweb_video_timestamps_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":false,"longform_notetweets_consumption_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":false,"responsive_web_grok_share_attachment_enabled":false,"responsive_web_grok_image_annotation_enabled":false,"c9s_tweet_anatomy_moderator_badge_enabled":false,"responsive_web_grok_analysis_button_from_backend":false,"responsive_web_edit_tweet_api_enabled":false,"premium_content_api_read_enabled":false,"responsive_web_twitter_article_tweet_consumption_enabled":false}');
  const FIELD_TOGGLES = encodeURIComponent('{"withAuxiliaryUserLabels":false}');

  let currentSettings = {
    enabled: true,
    hideMode: 'collapse', // 'collapse' or 'hide'
    filterKeywords: true,
    filterHomophones: true,
    filterPureNumbers: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    filterSimhash: true,
    filterHeuristics: true,
    packSettings: {},
    customKeywords: [],
    whitelist: [],
    blockedCount: 0
  };

  let currentThreadUrl = '';
  const threadTextOccurrences = new Map(); // normalizedText -> Set of author handles
  const threadSimhashTracker = new Map();  // BigInt hash -> Set of author handles
  const resolvedUserIds = new Map();       // handle -> xUserId
  const blockedHandlesState = new Set();   // handles blocked in current session
  let isScanning = false;
  let scanDebounceTimer = null;

  // Track cluster expand state across DOM re-renders (leadTweetText -> boolean)
  const clusterExpandedState = new Map();

  // Load stored settings
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) return;
    currentSettings = {
      ...currentSettings,
      ...stored
    };
    handleUrlChange();
  });

  // Listen for settings change
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let shouldRescan = false;

    for (const [key, change] of Object.entries(changes)) {
      currentSettings[key] = change.newValue;
      if (key !== 'blockedCount') {
        shouldRescan = true;
      }
    }

    if (shouldRescan) {
      if (!currentSettings.enabled) {
        restoreAll();
      } else {
        resetProcessedMarks();
        scheduleScan(50);
      }
    }
  });

  // --- X Native Action Helpers ---
  function readCsrfToken() {
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('ct0=')) {
        return trimmed.substring('ct0='.length) || null;
      }
    }
    return null;
  }

  async function resolveUserId(handle) {
    const norm = normalizeHandleFn(handle);
    if (resolvedUserIds.has(norm)) {
      return resolvedUserIds.get(norm);
    }
    const csrf = readCsrfToken();
    if (!csrf) return null;

    const variables = encodeURIComponent(JSON.stringify({ screen_name: norm, withSafetyModeUserFields: true }));
    const url = `https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName?variables=${variables}&features=${USER_FEATURES}&fieldToggles=${FIELD_TOGGLES}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: X_WEB_BEARER,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Csrf-Token': csrf
        }
      });
      if (!res.ok) return null;
      const body = await res.json();
      const result = body.data?.user?.result;
      if (result?.__typename === 'UserUnavailable' || !result?.rest_id) return null;
      const uid = String(result.rest_id);
      resolvedUserIds.set(norm, uid);
      return uid;
    } catch {
      return null;
    }
  }

  async function runNativeAction(type, userId) {
    const csrf = readCsrfToken();
    if (!csrf) return { ok: false, error: '未读取到 ct0 会话，请确认已登录 X' };
    const endpoint = type === 'block'
      ? 'https://x.com/i/api/1.1/blocks/create.json'
      : 'https://x.com/i/api/1.1/blocks/destroy.json';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          Authorization: X_WEB_BEARER,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
          'X-Csrf-Token': csrf
        },
        body: `user_id=${encodeURIComponent(userId)}`
      });
      if (res.ok) return { ok: true };
      if (res.status === 429) return { ok: false, error: '操作过快限流 (429)' };
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e.message || '网络请求异常' };
    }
  }

  async function blockUserByHandle(handle) {
    const norm = normalizeHandleFn(handle);
    const userId = await resolveUserId(norm);
    if (!userId) return { ok: false, error: '无法解析账号 ID' };
    const result = await runNativeAction('block', userId);
    if (result.ok) {
      blockedHandlesState.add(norm);
    }
    return result;
  }

  async function unblockUserByHandle(handle) {
    const norm = normalizeHandleFn(handle);
    const userId = await resolveUserId(norm);
    if (!userId) return { ok: false, error: '无法解析账号 ID' };
    const result = await runNativeAction('unblock', userId);
    if (result.ok) {
      blockedHandlesState.delete(norm);
    }
    return result;
  }

  function addToWhitelist(handle) {
    const norm = normalizeHandleFn(handle);
    if (!norm) return;
    chrome.storage.sync.get(['whitelist'], (data) => {
      const current = Array.isArray(data.whitelist) ? data.whitelist : [];
      if (!current.includes(norm)) {
        const next = [...current, norm];
        chrome.storage.sync.set({ whitelist: next }, () => {
          currentSettings.whitelist = next;
          resetProcessedMarks();
          scheduleScan(50);
        });
      }
    });
  }

  function isStatusPage() {
    return /\/(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(window.location.href);
  }

  function getOpHandle() {
    const match = window.location.href.match(/\/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/\d+/i);
    return match ? match[1].toLowerCase() : '';
  }

  function handleUrlChange() {
    const currentUrl = window.location.href.split('?')[0];
    if (currentUrl !== currentThreadUrl) {
      currentThreadUrl = currentUrl;
      threadTextOccurrences.clear();
      threadSimhashTracker.clear();
      clusterExpandedState.clear();
      resetProcessedMarks();

      if (isStatusPage()) {
        scheduleScan(50);
        scheduleScan(300);
        scheduleScan(800);
      }
    }
  }

  function resetProcessedMarks() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => {
      delete el.dataset.xSpamProcessed;
      delete el.dataset.xSpamEvaluation;
      delete el.dataset.xSpam;
      delete el.dataset.xSpamReason;
      delete el.dataset.xSpamText;
      delete el.dataset.xSpamAuthor;
      el.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
    });
  }

  function restoreAll() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => {
      delete el.dataset.xSpam;
      el.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
    });
  }

  function getAuthorInfo(tweetElement) {
    const userNameEl = tweetElement.querySelector('div[data-testid="User-Name"]');
    if (!userNameEl) return { handle: '', displayName: '' };

    let handle = '';
    let displayName = '';

    const userLink = userNameEl.querySelector('a[href^="/"]');
    if (userLink) {
      const href = userLink.getAttribute('href') || '';
      const match = href.match(/^\/([a-zA-Z0-9_]+)/);
      if (match) handle = match[1];
      displayName = userLink.textContent || '';
    }

    return { handle, displayName };
  }

  function getTweetLinks(tweetElement) {
    const links = [];
    tweetElement.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('http')) {
        try {
          const urlObj = new URL(href);
          links.push({ href, hostname: urlObj.hostname });
        } catch {
          links.push({ href });
        }
      }
    });
    return links;
  }

  function scanTimeline() {
    if (isScanning || !currentSettings.enabled) return;
    if (!isStatusPage()) return; // Never touch non-post pages (Home, Profiles, etc.)

    isScanning = true;

    try {
      const opHandle = getOpHandle();

      // Find all tweet articles on the page
      const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if (allTweets.length === 0) return;

      // The FIRST tweet is ALWAYS the focal main post
      const mainTweet = allTweets[0];
      mainTweet.dataset.xSpamProcessed = 'true';
      delete mainTweet.dataset.xSpam;
      delete mainTweet.dataset.xSpamEvaluation;
      mainTweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());

      // If only 1 tweet exists, no replies loaded yet
      if (allTweets.length <= 1) return;

      const replyTweets = allTweets.slice(1);

      // 1. Evaluate each reply tweet
      for (const tweet of replyTweets) {
        const { handle: authorHandle, displayName: authorDisplayName } = getAuthorInfo(tweet);

        // OP Protection: OP's follow-up thread tweets are 100% exempt
        if (opHandle && authorHandle.toLowerCase() === opHandle) {
          tweet.dataset.xSpamProcessed = 'true';
          tweet.dataset.xSpamEvaluation = 'false';
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          continue;
        }

        if (tweet.dataset.xSpamProcessed !== 'true') {
          tweet.dataset.xSpamProcessed = 'true';

          const tweetTextEl = tweet.querySelector('div[data-testid="tweetText"]');
          const text = tweetTextEl ? (tweetTextEl.innerText || tweetTextEl.textContent || '') : '';
          const links = getTweetLinks(tweet);

          const checkResult = evaluateSpamFn({
            text,
            authorHandle,
            displayName: authorDisplayName,
            links,
            settings: currentSettings,
            duplicateTracker: threadTextOccurrences,
            simhashTracker: threadSimhashTracker
          });

          tweet.dataset.xSpamEvaluation = checkResult.isSpam ? 'true' : 'false';
          tweet.dataset.xSpamReason = checkResult.reason || '';
          tweet.dataset.xSpamText = text;
          tweet.dataset.xSpamAuthor = authorHandle;

          if (checkResult.isSpam) {
            chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
              if (chrome.runtime.lastError) { /* ignore */ }
            });
          }
        }
      }

      // 2. Build clusters of consecutive spam replies
      const clusters = [];
      let currentCluster = [];

      for (const tweet of replyTweets) {
        if (tweet.dataset.xSpamEvaluation === 'true') {
          currentCluster.push(tweet);
        } else {
          if (currentCluster.length > 0) {
            clusters.push(currentCluster);
            currentCluster = [];
          }
          // Clean tweet: remove any residual spam markings
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
        }
      }
      if (currentCluster.length > 0) {
        clusters.push(currentCluster);
      }

      // 3. Apply styles and in-tweet banners
      for (const cluster of clusters) {
        const leadTweet = cluster[0];
        const count = cluster.length;
        const followers = cluster.slice(1);

        const sampleReasons = Array.from(new Set(cluster.map(t => t.dataset.xSpamReason).filter(Boolean))).slice(0, 3).join(', ');
        const clusterKey = cluster.map(t => t.dataset.xSpamText?.slice(0, 10) || '').join('|');
        const isExpanded = clusterExpandedState.get(clusterKey) === true;

        // Distinct authors in this cluster
        const authors = Array.from(new Set(cluster.map(t => t.dataset.xSpamAuthor).filter(Boolean)));
        const primaryAuthor = authors[0] || '';
        const isSingleAuthor = authors.length === 1;
        const isBlocked = authors.every(a => blockedHandlesState.has(normalizeHandleFn(a)));

        if (currentSettings.hideMode === 'hide') {
          // Hard hide
          for (const tweet of cluster) {
            tweet.dataset.xSpam = 'hide';
            tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          }
        } else {
          // Collapse mode:
          leadTweet.dataset.xSpam = isExpanded ? 'expanded' : 'lead';

          // Ensure in-tweet banner exists inside lead tweet
          let banner = leadTweet.querySelector('.x-spam-inner-banner');
          if (!banner) {
            banner = document.createElement('div');
            banner.className = 'x-spam-inner-banner';
            leadTweet.insertBefore(banner, leadTweet.firstChild);
          }

          banner.className = 'x-spam-inner-banner' + (isExpanded ? ' is-expanded' : '');
          const reasonDesc = sampleReasons ? ` · (${escapeHtml(sampleReasons)}${sampleReasons ? ' 等' : ''})` : '';

          const blockBtnText = isBlocked
            ? '✓ 已拉黑 · 撤销'
            : (isSingleAuthor ? `🚫 原生拉黑 @${escapeHtml(primaryAuthor)}` : `🚫 一键拉黑 (${authors.length}人)`);

          banner.innerHTML = `
            <div class="x-spam-inner-left">
              <span class="x-spam-inner-tag">🛡️ 已折叠 ${count} 条垃圾评论</span>
              <span class="x-spam-inner-info" title="${escapeHtml(sampleReasons)}">${reasonDesc}</span>
            </div>
            <div class="x-spam-inner-actions">
              <button class="x-spam-inner-btn x-spam-btn-block ${isBlocked ? 'is-blocked' : ''}" type="button">${blockBtnText}</button>
              ${isSingleAuthor ? `<button class="x-spam-inner-btn x-spam-btn-white" type="button" title="信任该作者并加入白名单">加白</button>` : ''}
              <button class="x-spam-inner-btn x-spam-btn-expand" type="button">${isExpanded ? `收起 (${count})` : `展开 (${count})`}</button>
            </div>
          `;

          // Button click handlers
          const expandBtn = banner.querySelector('.x-spam-btn-expand');
          if (expandBtn) {
            expandBtn.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              const nextState = !isExpanded;
              clusterExpandedState.set(clusterKey, nextState);
              scheduleScan(10);
            };
          }

          const blockBtn = banner.querySelector('.x-spam-btn-block');
          if (blockBtn) {
            blockBtn.onclick = async (e) => {
              e.stopPropagation();
              e.preventDefault();
              blockBtn.disabled = true;
              blockBtn.textContent = '处理中...';

              if (isBlocked) {
                // Unblock
                for (const a of authors) {
                  await unblockUserByHandle(a);
                }
              } else {
                // Block
                for (const a of authors) {
                  await blockUserByHandle(a);
                }
              }
              scheduleScan(10);
            };
          }

          const whiteBtn = banner.querySelector('.x-spam-btn-white');
          if (whiteBtn && primaryAuthor) {
            whiteBtn.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              addToWhitelist(primaryAuthor);
            };
          }

          // Follower tweets get 'follower' or 'expanded'
          for (const follower of followers) {
            follower.dataset.xSpam = isExpanded ? 'expanded' : 'follower';
            follower.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          }
        }
      }

    } finally {
      isScanning = false;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function scheduleScan(delay = 100) {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(scanTimeline, delay);
  }

  // Hook SPA History API navigation
  (function hookHistory() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      handleUrlChange();
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      handleUrlChange();
      return result;
    };

    window.addEventListener('popstate', () => {
      handleUrlChange();
    });
  })();

  // Periodic polling fallback for SPA URL changes
  setInterval(handleUrlChange, 250);

  // Observe DOM additions (tweets dynamically injected by SPA scroll/hydration)
  const observer = new MutationObserver((mutations) => {
    let hasRelevantNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasRelevantNodes = true;
        break;
      }
    }
    if (hasRelevantNodes) {
      scheduleScan(120);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  handleUrlChange();
})();
