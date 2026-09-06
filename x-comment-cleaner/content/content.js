/**
 * X Spam Reply Cleaner - Content Script (DOM & UI Controller)
 */

(function () {
  'use strict';

  const rulesEngine = globalThis.XCleanerRules || {};
  const xAdapter = globalThis.XActionAdapter || {};
  const evaluateSpamFn = rulesEngine.evaluateReplySpam || (() => ({ isSpam: false }));
  const normalizeHandleFn = rulesEngine.normalizeHandle || ((h) => (h || '').replace(/^@+/, '').toLowerCase());

  let currentSettings = {
    enabled: true,
    hideMode: 'collapse',
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
  const blockedHandlesState = new Set();   // handles blocked in current session
  const clusterExpandedState = new Map();  // clusterKey -> boolean
  let isScanning = false;
  let scanDebounceTimer = null;

  // 1. Storage & Settings Sync
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) return;
    currentSettings = { ...currentSettings, ...stored };
    scheduleScan(50);
    scheduleScan(300);
  });

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

  // 2. SPA Route Detection
  function isStatusPage() {
    return /\/(?:twitter\.com|x\.com)\/(?:[^/]+|i)\/status\/\d+/i.test(window.location.href);
  }

  function getOpHandle() {
    const match = window.location.href.match(/\/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/\d+/i);
    return (match && match[1] !== 'i') ? match[1].toLowerCase() : '';
  }

  function handleUrlChange() {
    const currentUrl = window.location.href.split('?')[0];
    if (currentUrl !== currentThreadUrl) {
      currentThreadUrl = currentUrl;
      threadTextOccurrences.clear();
      threadSimhashTracker.clear();
      clusterExpandedState.clear();
      resetProcessedMarks();
    }

    if (isStatusPage()) {
      scheduleScan(50);
      scheduleScan(250);
      scheduleScan(750);
      scheduleScan(1500);
    }
  }

  function resetProcessedMarks() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => {
      delete el.dataset.xSpamProcessed;
      delete el.dataset.xSpamEvaluation;
      delete el.dataset.xSpam;
      delete el.dataset.xSpamReason;
      delete el.dataset.xSpamText;
      delete el.dataset.xSpamLastText;
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

  // 3. DOM Metadata Extraction
  function getAuthorInfo(tweetElement) {
    const userNameEl = tweetElement.querySelector('div[data-testid="User-Name"]');
    if (!userNameEl) return { handle: '', displayName: '' };

    let handle = '';
    let displayName = '';

    const userLinks = Array.from(userNameEl.querySelectorAll('a[href^="/"]'));
    for (const link of userLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/^\/([a-zA-Z0-9_]+)$/);
      if (match && match[1] !== 'home' && match[1] !== 'explore') {
        handle = match[1];
        displayName = link.innerText || link.textContent || '';
        break;
      }
    }

    // Fallback if link not found
    if (!handle && userLinks.length > 0) {
      const match = (userLinks[0].getAttribute('href') || '').match(/^\/([a-zA-Z0-9_]+)/);
      if (match) handle = match[1];
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

  // 4. Timeline Evaluation & Clustering
  function scanTimeline() {
    if (isScanning || !currentSettings.enabled) return;
    if (!isStatusPage()) return; // Only process reply sections in tweet status threads

    isScanning = true;

    try {
      const opHandle = getOpHandle();
      const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if (allTweets.length === 0) return;

      // The FIRST tweet in a thread view is the focal OP post
      const mainTweet = allTweets[0];
      mainTweet.dataset.xSpamProcessed = 'true';
      delete mainTweet.dataset.xSpam;
      delete mainTweet.dataset.xSpamEvaluation;
      mainTweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());

      if (allTweets.length <= 1) return;
      const replyTweets = allTweets.slice(1);

      // Evaluate replies
      for (const tweet of replyTweets) {
        const { handle: authorHandle, displayName: authorDisplayName } = getAuthorInfo(tweet);

        // OP Protection (Thread author is exempt)
        if (opHandle && authorHandle.toLowerCase() === opHandle) {
          tweet.dataset.xSpamProcessed = 'true';
          tweet.dataset.xSpamEvaluation = 'false';
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          continue;
        }

        const tweetTextEl = tweet.querySelector('div[data-testid="tweetText"]');
        const text = tweetTextEl ? (tweetTextEl.innerText || tweetTextEl.textContent || '').trim() : '';

        // Only evaluate if text has rendered or if we haven't processed with this text yet
        const lastEvaluatedText = tweet.dataset.xSpamLastText;
        if (tweet.dataset.xSpamProcessed !== 'true' || lastEvaluatedText !== text) {
          if (!text && !authorHandle) {
            // Still loading/hydrating DOM, don't mark permanently processed yet
            continue;
          }

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

          tweet.dataset.xSpamProcessed = 'true';
          tweet.dataset.xSpamLastText = text;
          tweet.dataset.xSpamEvaluation = checkResult.isSpam ? 'true' : 'false';
          tweet.dataset.xSpamReason = checkResult.reason || '';
          tweet.dataset.xSpamAuthor = authorHandle;

          if (checkResult.isSpam && !lastEvaluatedText) {
            chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
              if (chrome.runtime.lastError) { /* ignore */ }
            });
          }
        }
      }

      // Group consecutive spam into clusters
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
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
        }
      }
      if (currentCluster.length > 0) {
        clusters.push(currentCluster);
      }

      // 5. Render Banner UI for Clusters
      for (const cluster of clusters) {
        const leadTweet = cluster[0];
        const count = cluster.length;
        const followers = cluster.slice(1);

        const sampleReasons = Array.from(new Set(cluster.map(t => t.dataset.xSpamReason).filter(Boolean))).slice(0, 3).join(', ');
        const clusterKey = cluster.map(t => (t.dataset.xSpamLastText || '').slice(0, 10)).join('|');
        const isExpanded = clusterExpandedState.get(clusterKey) === true;

        const authors = Array.from(new Set(cluster.map(t => t.dataset.xSpamAuthor).filter(Boolean)));
        const primaryAuthor = authors[0] || '';
        const isSingleAuthor = authors.length === 1;
        const isBlocked = authors.length > 0 && authors.every(a => blockedHandlesState.has(normalizeHandleFn(a)));

        if (currentSettings.hideMode === 'hide') {
          for (const tweet of cluster) {
            tweet.dataset.xSpam = 'hide';
            tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          }
        } else {
          leadTweet.dataset.xSpam = isExpanded ? 'expanded' : 'lead';

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

          // Button Actions
          const expandBtn = banner.querySelector('.x-spam-btn-expand');
          if (expandBtn) {
            expandBtn.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              clusterExpandedState.set(clusterKey, !isExpanded);
              scheduleScan(10);
            };
          }

          const blockBtn = banner.querySelector('.x-spam-btn-block');
          if (blockBtn && typeof xAdapter.blockUser === 'function') {
            blockBtn.onclick = async (e) => {
              e.stopPropagation();
              e.preventDefault();
              blockBtn.disabled = true;
              blockBtn.textContent = '处理中...';

              if (isBlocked) {
                for (const a of authors) {
                  const res = await xAdapter.unblockUser(a);
                  if (res.ok) blockedHandlesState.delete(normalizeHandleFn(a));
                }
              } else {
                for (const a of authors) {
                  const res = await xAdapter.blockUser(a);
                  if (res.ok) blockedHandlesState.add(normalizeHandleFn(a));
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

  // 6. SPA Navigation Hooks & MutationObserver
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

    window.addEventListener('popstate', handleUrlChange);
  })();

  setInterval(handleUrlChange, 250);

  const observer = new MutationObserver((mutations) => {
    let hasAddedNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasAddedNodes = true;
        break;
      }
    }
    if (hasAddedNodes) {
      scheduleScan(100);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  handleUrlChange();
})();
