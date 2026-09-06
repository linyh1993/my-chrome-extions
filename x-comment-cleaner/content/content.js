/**
 * X Spam Reply Cleaner - Content Script
 */

(function () {
  'use strict';

  const rulesEngine = globalThis.XCleanerRules || {};
  const defaultDict = rulesEngine.X_SPAM_DICTIONARY || globalThis.X_SPAM_DICTIONARY || [];
  const mergeKeywordsFn = rulesEngine.mergeKeywords || globalThis.mergeKeywords || ((kw) => kw || []);
  const evaluateSpamFn = rulesEngine.evaluateReplySpam || globalThis.evaluateReplySpam || (() => ({ isSpam: false }));

  let currentSettings = {
    enabled: true,
    hideMode: 'collapse', // 'collapse' or 'hide'
    filterKeywords: true,
    filterHomophones: true,
    filterPureNumbers: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: [...defaultDict],
    blockedCount: 0
  };

  let currentThreadUrl = '';
  const threadTextOccurrences = new Map(); // normalizedText -> Set of author handles
  let isScanning = false;
  let scanDebounceTimer = null;

  // Track cluster expand state across DOM re-renders (leadTweetText -> boolean)
  const clusterExpandedState = new Map();

  // Load stored settings and merge with built-in dictionary
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) return;
    const mergedKw = mergeKeywordsFn(stored.keywords, defaultDict);
    currentSettings = {
      ...currentSettings,
      ...stored,
      keywords: mergedKw
    };
    handleUrlChange();
  });

  // Listen for settings change
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let shouldRescan = false;

    for (const [key, change] of Object.entries(changes)) {
      if (key === 'keywords') {
        currentSettings.keywords = mergeKeywordsFn(change.newValue, defaultDict);
        shouldRescan = true;
      } else {
        currentSettings[key] = change.newValue;
        if (key !== 'blockedCount') {
          shouldRescan = true;
        }
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

          const checkResult = evaluateSpamFn({
            text,
            authorHandle,
            displayName: authorDisplayName,
            settings: currentSettings,
            duplicateTracker: threadTextOccurrences
          });

          tweet.dataset.xSpamEvaluation = checkResult.isSpam ? 'true' : 'false';
          tweet.dataset.xSpamReason = checkResult.reason || '';
          tweet.dataset.xSpamText = text;

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

          banner.innerHTML = `
            <div class="x-spam-inner-left">
              <span class="x-spam-inner-tag">🚫 已折叠 ${count} 条垃圾评论</span>
              <span class="x-spam-inner-info" title="${escapeHtml(sampleReasons)}">${reasonDesc}</span>
            </div>
            <button class="x-spam-inner-btn" type="button">${isExpanded ? `重新收起 (${count})` : `展开全部 (${count})`}</button>
          `;

          // Button click handler
          const btn = banner.querySelector('.x-spam-inner-btn');
          btn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const nextState = !isExpanded;
            clusterExpandedState.set(clusterKey, nextState);
            scheduleScan(10);
          };

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
