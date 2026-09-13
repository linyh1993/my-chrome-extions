/**
 * SuperX Feature - X Comment Cleaner (垃圾评论拦截助手)
 * 完整迁移自 x-comment-cleaner，适配 SuperX 模块化微内核契约
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  const rulesEngine = globalThis.XCleanerRules || {};
  const xAdapter = globalThis.XActionAdapter || {};
  const evaluateSpamFn = rulesEngine.evaluateReplySpam || (() => ({ isSpam: false }));
  const normalizeHandleFn = rulesEngine.normalizeHandle || ((h) => (h || '').replace(/^@+/, '').toLowerCase());

  const DEFAULT_SETTINGS = rulesEngine.DEFAULT_CLEANER_SETTINGS || {
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

  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentThreadUrl = '';
  const threadTextOccurrences = new Map();
  const threadSimhashTracker = new Map();
  const blockedHandlesState = new Set();
  const manuallyUnblockedHandles = new Set();
  const autoBlockQueue = [];
  let isProcessingAutoBlockQueue = false;
  let queueCooldownUntil = 0;
  const clusterExpandedState = new Map();
  let active = true;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isStatusPage() {
    return /\/[^/]+\/status\/\d+/.test(window.location.pathname);
  }

  function getOpHandle() {
    const match = window.location.pathname.match(/^\/([^/]+)\/status\/\d+/);
    return match ? match[1].toLowerCase() : null;
  }

  function getTweetId(tweet) {
    const link = tweet.querySelector('a[href*="/status/"]');
    if (!link) return null;
    const m = link.getAttribute('href').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function getAuthorInfo(tweet) {
    const userNameNode = tweet.querySelector('div[data-testid="User-Name"]');
    if (!userNameNode) return { handle: '', displayName: '' };

    const links = Array.from(userNameNode.querySelectorAll('a[href^="/"]'));
    let handle = '';
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (/^\/[a-zA-Z0-9_]+$/.test(href)) {
        handle = href.replace('/', '');
        break;
      }
    }

    const firstLine = userNameNode.querySelector('span');
    const displayName = firstLine ? (firstLine.innerText || firstLine.textContent || '').trim() : '';
    return { handle, displayName };
  }

  function getTweetLinks(tweet) {
    const links = [];
    tweet.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const text = (a.innerText || a.textContent || '').trim();
      links.push({ href, text });
    });
    return links;
  }

  function addToWhitelist(handle) {
    const norm = normalizeHandleFn(handle);
    if (!norm) return;
    if (!Array.isArray(currentSettings.whitelist)) currentSettings.whitelist = [];
    if (!currentSettings.whitelist.includes(norm)) {
      currentSettings.whitelist.push(norm);
      if (window.__SuperX__ && window.__SuperX__.Storage) {
        window.__SuperX__.Storage.setConfig("x-comment-cleaner", currentSettings);
      }
      console.log(`[SuperX Cleaner] 已将 @${norm} 加入白名单`);
      if (window.__SuperX__.DOMObserver) {
        window.__SuperX__.DOMObserver.scheduleScan(10);
      }
    }
  }

  async function triggerAutoBlock(handle, reason) {
    if (!currentSettings.autoBlock) return;
    const norm = normalizeHandleFn(handle);
    if (!norm) return;

    const opHandle = getOpHandle();
    if (opHandle && norm === opHandle) return;

    if (Array.isArray(currentSettings.whitelist)) {
      const isWhite = currentSettings.whitelist.some(w => normalizeHandleFn(w) === norm);
      if (isWhite) return;
    }

    if (blockedHandlesState.has(norm) || manuallyUnblockedHandles.has(norm)) return;
    if (autoBlockQueue.some(item => item.handle === norm)) return;

    autoBlockQueue.push({ handle: norm, reason });
    processAutoBlockQueue();
  }

  async function processAutoBlockQueue() {
    if (isProcessingAutoBlockQueue) return;
    isProcessingAutoBlockQueue = true;

    try {
      while (autoBlockQueue.length > 0) {
        if (!active || !currentSettings.autoBlock) {
          autoBlockQueue.length = 0;
          break;
        }

        const now = Date.now();
        if (now < queueCooldownUntil) {
          await sleep(Math.min(queueCooldownUntil - now, 5000));
          continue;
        }

        const task = autoBlockQueue.shift();
        if (!task) continue;

        const norm = task.handle;
        if (blockedHandlesState.has(norm) || manuallyUnblockedHandles.has(norm)) continue;

        console.log(`[SuperX Cleaner] 防封流控：正在向 X 官方接口发送真实拉黑请求: @${norm}...`);
        const res = await xAdapter.blockUser(norm);

        if (res && res.ok) {
          blockedHandlesState.add(norm);
          console.log(`[SuperX Cleaner] ✓ 已成功通过接口拉黑账号 @${norm}`);
          chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
            if (chrome.runtime.lastError) {}
          });
        } else if (res && res.status === 429) {
          console.warn(`[SuperX Cleaner] ⚠️ 触发 X 官方频率限制 (HTTP 429)！进入 60 秒冷却期`);
          queueCooldownUntil = Date.now() + 60000;
          autoBlockQueue.unshift(task);
          await sleep(5000);
          continue;
        }

        const baseInterval = typeof currentSettings.autoBlockInterval === 'number'
          ? Math.max(currentSettings.autoBlockInterval, 2000)
          : 3000;
        const delay = baseInterval + Math.floor(Math.random() * 1500) + 500;
        await sleep(delay);
      }
    } catch (err) {
      console.error('[SuperX Cleaner] 自动拉黑队列处理异常:', err);
    } finally {
      isProcessingAutoBlockQueue = false;
    }
  }

  function renderClusters(allTweets) {
    const clusters = [];
    let currentCluster = [];

    for (const tweet of allTweets) {
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

    for (const cluster of clusters) {
      const count = cluster.length;
      const leadTweet = cluster[0];
      const followers = cluster.slice(1);
      const sampleReasons = Array.from(new Set(cluster.map(t => t.dataset.xSpamReason).filter(Boolean))).slice(0, 3).join(', ');
      const leadTweetId = getTweetId(leadTweet);
      const clusterKey = leadTweetId
        ? `cluster_${leadTweetId}`
        : `cluster_${(leadTweet.dataset.xSpamAuthor || '')}_${(leadTweet.dataset.xSpamLastText || '').slice(0, 20)}`;
      const isExpanded = clusterExpandedState.get(clusterKey) === true;

      const authors = Array.from(new Set(cluster.map(t => t.dataset.xSpamAuthor).filter(Boolean)));
      const primaryAuthor = authors[0] || '';
      const isSingleAuthor = authors.length === 1;
      const isBlocked = authors.length > 0 && authors.every(a => blockedHandlesState.has(normalizeHandleFn(a)));
      const isQueued = !isBlocked && authors.length > 0 && authors.some(a => autoBlockQueue.some(t => t.handle === normalizeHandleFn(a)));

      if (currentSettings.hideMode === 'remove' || currentSettings.hideMode === 'hide') {
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

        const expandBtn = banner.querySelector('.x-spam-btn-expand');
        if (expandBtn) {
          expandBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            clusterExpandedState.set(clusterKey, !isExpanded);
            renderClusters(allTweets);
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
                }
              }
            }
            renderClusters(allTweets);
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
  }

  const FeatureInstance = {
    id: "x-comment-cleaner",
    name: "X 垃圾评论净化",
    description: "64位 SimHash 话术识别与 8 大分类词库，智能折叠黄推、引流号与诈骗 Bot",
    version: "2.0.0",
    defaultEnabled: true,

    async init(context) {
      if (context.storage) {
        const saved = await context.storage.getConfig("x-comment-cleaner", DEFAULT_SETTINGS);
        currentSettings = { ...DEFAULT_SETTINGS, ...saved, enabled: true };
      }

      // 加载拉黑缓存
      chrome.storage.local.get(['blockedAccountsCache'], (data) => {
        if (chrome.runtime.lastError) return;
        const list = Array.isArray(data.blockedAccountsCache) ? data.blockedAccountsCache : [];
        for (const item of list) {
          const h = typeof item === 'string' ? item : item.handle;
          if (h) blockedHandlesState.add(normalizeHandleFn(h));
        }
      });

      console.log("[SuperX Cleaner] Initialized successfully. Settings:", currentSettings);
    },

    async enable() {
      active = true;
      console.log("[SuperX Cleaner] Enabled.");
      if (window.__SuperX__.DOMObserver) {
        window.__SuperX__.DOMObserver.scheduleScan(50);
      }
    },

    async disable() {
      active = false;
      console.log("[SuperX Cleaner] Disabled. Clearing spam datasets.");
      document.querySelectorAll('article[data-testid="tweet"]').forEach((tweet) => {
        delete tweet.dataset.xSpam;
        delete tweet.dataset.xSpamProcessed;
        delete tweet.dataset.xSpamEvaluation;
        tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
      });
    },

    onRouteChange(newUrl, prevUrl) {
      if (window.location.pathname !== currentThreadUrl) {
        currentThreadUrl = window.location.pathname;
        threadTextOccurrences.clear();
        threadSimhashTracker.clear();
        clusterExpandedState.clear();
        console.log("[SuperX Cleaner] Route changed to:", currentThreadUrl);
      }
    },

    onDOMNodes(allTweets) {
      if (!active || !currentSettings.enabled) return;
      if (!isStatusPage()) return;

      const opHandle = getOpHandle();
      const replyTweets = [];

      for (let i = 0; i < allTweets.length; i++) {
        const tweet = allTweets[i];
        if (i === 0 && window.scrollY < 300 && !tweet.dataset.xSpamProcessed) {
          tweet.dataset.xSpamProcessed = 'true';
          tweet.dataset.xSpamIsOp = 'true';
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
        }
        if (tweet.dataset.xSpamIsOp !== 'true') {
          replyTweets.push(tweet);
        }
      }

      for (const tweet of replyTweets) {
        const { handle: authorHandle, displayName: authorDisplayName } = getAuthorInfo(tweet);

        if (opHandle && authorHandle && authorHandle.toLowerCase() === opHandle) {
          tweet.dataset.xSpamProcessed = 'true';
          tweet.dataset.xSpamEvaluation = 'false';
          delete tweet.dataset.xSpam;
          tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          continue;
        }

        const tweetTextEl = tweet.querySelector('div[data-testid="tweetText"]');
        const text = tweetTextEl ? (tweetTextEl.innerText || tweetTextEl.textContent || '').trim() : '';
        const tweetId = getTweetId(tweet);
        const lastEvaluatedText = tweet.dataset.xSpamLastText;
        const isNewOrChanged = tweet.dataset.xSpamProcessed !== 'true' || lastEvaluatedText !== text;

        if (isNewOrChanged) {
          if (!text && !authorHandle) continue;

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

          if (checkResult.isSpam) {
            console.log(`[SuperX Cleaner] 🚨 拦截到垃圾评论: @${authorHandle} 原因: [${checkResult.reason}] 内容: "${text.slice(0, 30)}..."`);
            chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
              if (chrome.runtime.lastError) {}
            });
            if (authorHandle) {
              triggerAutoBlock(authorHandle, checkResult.reason || '');
            }
          }
        }
      }

      renderClusters(replyTweets);
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
