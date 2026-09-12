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
    autoBlock: true,
    autoBlockInterval: 3000,
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
  const manuallyUnblockedHandles = new Set(); // handles unblocked by user in current session
  const autoBlockQueue = [];               // Anti-ban rate-limited auto-block FIFO queue
  let isProcessingAutoBlockQueue = false;
  let queueCooldownUntil = 0;              // 429 Rate-limit cooldown timestamp
  const clusterExpandedState = new Map();  // clusterKey -> boolean
  let isScanning = false;
  let scanDebounceTimer = null;

  // Load cached blocked accounts from local storage to sync across tabs
  chrome.storage.local.get(['blockedAccountsCache'], (data) => {
    if (chrome.runtime.lastError) return;
    const list = Array.isArray(data.blockedAccountsCache) ? data.blockedAccountsCache : [];
    for (const item of list) {
      const h = typeof item === 'string' ? item : item.handle;
      if (h) blockedHandlesState.add(normalizeHandleFn(h));
    }
  });

  // Listen for cross-tab blocked accounts cache updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedAccountsCache) {
      const list = Array.isArray(changes.blockedAccountsCache.newValue) ? changes.blockedAccountsCache.newValue : [];
      for (const item of list) {
        const h = typeof item === 'string' ? item : item.handle;
        if (h) blockedHandlesState.add(normalizeHandleFn(h));
      }
      scheduleScan(50);
    }
  });

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

  function getOpTweetId() {
    const match = window.location.href.match(/\/(?:twitter\.com|x\.com)\/(?:[^/]+|i)\/status\/(\d+)/i);
    return match ? match[1] : '';
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
      delete el.dataset.xSpamIsOp;
      delete el.dataset.xSpamTweetId;
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

  function getTweetId(tweetElement, authorHandle) {
    // 优先从 timestamp <time> 父级 <a> 获取推文的永久链接
    const timeLink = tweetElement.querySelector('time')?.closest('a[href*="/status/"]');
    if (timeLink) {
      const match = (timeLink.getAttribute('href') || '').match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    // 如果传入了推文作者 handle，匹配属于该作者的 status 链接
    if (authorHandle) {
      const authorLink = tweetElement.querySelector(`a[href*="/${authorHandle}/status/"]`);
      if (authorLink) {
        const match = (authorLink.getAttribute('href') || '').match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }
    return '';
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

  function recordBlockedAccount(handle, reason = '') {
    const norm = normalizeHandleFn(handle);
    if (!norm) return;
    chrome.storage.local.get(['blockedAccountsCache'], (data) => {
      const list = Array.isArray(data.blockedAccountsCache) ? data.blockedAccountsCache : [];
      if (!list.some(item => (typeof item === 'string' ? item : item.handle) === norm)) {
        list.unshift({ handle: norm, reason, time: Date.now() });
        if (list.length > 500) list.length = 500;
        chrome.storage.local.set({ blockedAccountsCache: list });
      }
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function triggerAutoBlock(handle, reason = '') {
    if (!currentSettings.autoBlock) return;
    const norm = normalizeHandleFn(handle);
    if (!norm) return;

    if (blockedHandlesState.has(norm) || manuallyUnblockedHandles.has(norm)) return;
    if (currentSettings.whitelist && currentSettings.whitelist.includes(norm)) return;
    if (autoBlockQueue.some(task => task.handle === norm)) return;

    autoBlockQueue.push({ handle: norm, reason });
    console.log(`[X Cleaner] 发现垃圾 Bot @${norm}，已推入防封拉黑队列 (待处理: ${autoBlockQueue.length})`);

    processAutoBlockQueue();
  }

  async function processAutoBlockQueue() {
    if (isProcessingAutoBlockQueue) return;
    isProcessingAutoBlockQueue = true;

    try {
      while (autoBlockQueue.length > 0) {
        if (!currentSettings.autoBlock) {
          autoBlockQueue.length = 0;
          break;
        }

        // 检查 429 限流冷却
        if (Date.now() < queueCooldownUntil) {
          const waitMs = queueCooldownUntil - Date.now();
          console.warn(`[X Cleaner] 正在频率限流冷却退避中，等待 ${Math.ceil(waitMs / 1000)} 秒后恢复自动拉黑...`);
          await sleep(Math.min(waitMs, 5000));
          continue;
        }

        const task = autoBlockQueue.shift();
        if (!task) break;

        const norm = task.handle;
        if (blockedHandlesState.has(norm) || manuallyUnblockedHandles.has(norm)) {
          continue;
        }

        console.log(`[X Cleaner] 防封流控：正在向 X 官方接口发送真实拉黑请求: @${norm}...`);
        const res = await xAdapter.blockUser(norm);

        if (res && res.ok) {
          blockedHandlesState.add(norm);
          console.log(`[X Cleaner] ✓ 已成功通过接口拉黑账号 @${norm}`);
          recordBlockedAccount(norm, task.reason);
          scheduleScan(20);
        } else if (res && res.status === 429) {
          console.warn(`[X Cleaner] ⚠️ 触发 X 官方频率限制 (HTTP 429)！为保护账号避免被封，进入 60 秒冷却期，稍后自动重试`);
          queueCooldownUntil = Date.now() + 60000;
          autoBlockQueue.unshift(task); // 放回队列头部重试
          await sleep(5000);
          continue;
        } else {
          console.warn(`[X Cleaner] 接口拉黑 @${norm} 失败:`, res?.error || '未知错误');
        }

        // 防封核心：严格请求频率保护
        // 基础安全间隔（默认 3000ms），加上 500ms~2000ms 随机扰动，模拟人类节奏，避免被 Twitter 风控判定为脚本
        const baseInterval = typeof currentSettings.autoBlockInterval === 'number'
          ? Math.max(currentSettings.autoBlockInterval, 2000)
          : 3000;
        const jitter = Math.floor(Math.random() * 1500) + 500;
        const delay = baseInterval + jitter;

        console.log(`[X Cleaner] 防封流控：安全等待 ${(delay / 1000).toFixed(1)} 秒后再执行下一个拉黑... (剩余队列: ${autoBlockQueue.length})`);
        await sleep(delay);
      }
    } catch (err) {
      console.error('[X Cleaner] 自动拉黑队列处理异常:', err);
    } finally {
      isProcessingAutoBlockQueue = false;
    }
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

      // 1. 分离主推与评论区回复
      const replyTweets = [];
      if (allTweets.length > 0) {
        // 首个推文如果在页面顶端（未深度滚动），通常为当前页面的楼主主推（OP）
        const firstTweet = allTweets[0];
        if (window.scrollY < 300 && !firstTweet.dataset.xSpamProcessed) {
          firstTweet.dataset.xSpamProcessed = 'true';
          firstTweet.dataset.xSpamIsOp = 'true';
          firstTweet.dataset.xSpamEvaluation = 'false';
          delete firstTweet.dataset.xSpam;
          firstTweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
        }

        for (const tweet of allTweets) {
          // 如果已被确认为主推，跳过垃圾评论判定
          if (tweet.dataset.xSpamIsOp === 'true') {
            continue;
          }
          replyTweets.push(tweet);
        }
      }

      // 2. 评定评论区每条回复
      for (const tweet of replyTweets) {
        const { handle: authorHandle, displayName: authorDisplayName } = getAuthorInfo(tweet);

        // OP 保护（帖主本人在评论区的所有互动不视为垃圾评论）
        if (opHandle && authorHandle && authorHandle.toLowerCase() === opHandle) {
          tweet.dataset.xSpamProcessed = 'true';
          tweet.dataset.xSpamEvaluation = 'false';
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          continue;
        }

        const tweetTextEl = tweet.querySelector('div[data-testid="tweetText"]');
        const text = tweetTextEl ? (tweetTextEl.innerText || tweetTextEl.textContent || '').trim() : '';
        const tweetId = getTweetId(tweet, authorHandle);
        const lastTweetId = tweet.dataset.xSpamTweetId;
        const lastAuthor = tweet.dataset.xSpamAuthor;
        const lastEvaluatedText = tweet.dataset.xSpamLastText;

        // 判断推文是否为新载入、DOM回收复用或文本已更新
        const isNewOrChanged = tweet.dataset.xSpamProcessed !== 'true'
          || (tweetId && lastTweetId !== tweetId)
          || (authorHandle && lastAuthor !== authorHandle)
          || lastEvaluatedText !== text;

        if (isNewOrChanged) {
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
          tweet.dataset.xSpamTweetId = tweetId || '';
          tweet.dataset.xSpamLastText = text;
          tweet.dataset.xSpamEvaluation = checkResult.isSpam ? 'true' : 'false';
          tweet.dataset.xSpamReason = checkResult.reason || '';
          tweet.dataset.xSpamAuthor = authorHandle;

          if (checkResult.isSpam && !lastEvaluatedText) {
            chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
              if (chrome.runtime.lastError) { /* ignore */ }
            });
          }

          if (checkResult.isSpam && authorHandle) {
            triggerAutoBlock(authorHandle, checkResult.reason || '');
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
        const leadTweetId = getTweetId(leadTweet);
        const clusterKey = leadTweetId
          ? `cluster_${leadTweetId}`
          : `cluster_${(leadTweet.dataset.xSpamAuthor || '')}_${(leadTweet.dataset.xSpamLastText || '').slice(0, 20)}`;
        const isExpanded = clusterExpandedState.get(clusterKey) === true;

        const authors = Array.from(new Set(cluster.map(t => t.dataset.xSpamAuthor).filter(Boolean)));
        for (const a of authors) {
          const matchingTweet = cluster.find(t => t.dataset.xSpamAuthor === a);
          triggerAutoBlock(a, matchingTweet?.dataset.xSpamReason || '');
        }
        const primaryAuthor = authors[0] || '';
        const isSingleAuthor = authors.length === 1;
        const isBlocked = authors.length > 0 && authors.every(a => blockedHandlesState.has(normalizeHandleFn(a)));
        const isQueued = !isBlocked && authors.length > 0 && authors.some(a => autoBlockQueue.some(t => t.handle === normalizeHandleFn(a)));

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
            : (isQueued
              ? '⏳ 防封排队拉黑中...'
              : (isSingleAuthor ? `🚫 原生拉黑 @${escapeHtml(primaryAuthor)}` : `🚫 一键拉黑 (${authors.length}人)`));

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
                  if (res.ok) {
                    const normA = normalizeHandleFn(a);
                    blockedHandlesState.delete(normA);
                    manuallyUnblockedHandles.add(normA);
                    // 从待拉黑队列中移除
                    const idx = autoBlockQueue.findIndex(t => t.handle === normA);
                    if (idx !== -1) autoBlockQueue.splice(idx, 1);
                  }
                }
              } else {
                for (const a of authors) {
                  const res = await xAdapter.blockUser(a);
                  if (res.ok) {
                    const normA = normalizeHandleFn(a);
                    blockedHandlesState.add(normA);
                    manuallyUnblockedHandles.delete(normA);
                    recordBlockedAccount(normA, '手动点击拉黑');
                  }
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

  // 1. 监听滚动事件：用户下拉/向下滚动时快速触发扫描新刷出的推文
  window.addEventListener('scroll', () => {
    scheduleScan(100);
  }, { passive: true });

  // 2. 定时巡检兜底：每 800ms 扫描一次当前视口及新渲染的 DOM
  setInterval(() => {
    if (isStatusPage()) {
      scheduleScan(100);
    }
  }, 800);

  setInterval(handleUrlChange, 250);

  // 3. MutationObserver 监听节点增删与文本动态更新
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0 || mutation.type === 'characterData') {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      scheduleScan(80);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  handleUrlChange();
})();
