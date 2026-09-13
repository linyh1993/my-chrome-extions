/**
 * SuperX Feature - X Comment Cleaner (垃圾评论拦截助手)
 * 封装自 x-comment-cleaner，适配 SuperX 模块化契约
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
  let isScanning = false;
  let active = true;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      const leadTweet = cluster[0];
      const count = cluster.length;
      const followers = cluster.slice(1);
      const sampleReasons = Array.from(new Set(cluster.map(t => t.dataset.xSpamReason).filter(Boolean))).slice(0, 3).join(', ');
      const leadTweetId = getTweetId(leadTweet);
      const clusterKey = leadTweetId
        ? `cluster_${leadTweetId}`
        : `cluster_${(leadTweet.dataset.xSpamAuthor || '')}_${(leadTweet.dataset.xSpamLastText || '').slice(0, 20)}`;
      const isExpanded = clusterExpandedState.get(clusterKey) === true;

      for (const f of followers) {
        if (isExpanded) {
          f.dataset.xSpam = 'expanded';
        } else {
          f.dataset.xSpam = 'follower';
        }
        f.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
      }

      if (isExpanded) {
        leadTweet.dataset.xSpam = 'expanded';
      } else {
        leadTweet.dataset.xSpam = currentSettings.hideMode === 'remove' ? 'hidden' : 'lead';
      }

      let banner = leadTweet.querySelector('.x-spam-inner-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'x-spam-inner-banner';
        leadTweet.prepend(banner);
      }

      banner.innerHTML = `
        <div class="x-spam-banner-left">
          <span class="x-spam-shield-icon">🛡️</span>
          <span class="x-spam-banner-text">
            ${count > 1 ? `已智能折叠 <strong>${count}</strong> 条垃圾评论` : `已智能折叠 <strong>1</strong> 条引流/垃圾评论`}
            ${sampleReasons ? `<span class="x-spam-banner-reason">(${sampleReasons})</span>` : ''}
          </span>
        </div>
        <div class="x-spam-banner-actions">
          <button type="button" class="x-spam-action-btn x-spam-toggle-btn">${isExpanded ? '收起' : '查看'}</button>
          <button type="button" class="x-spam-action-btn x-spam-block-btn">拉黑</button>
        </div>
      `;

      const toggleBtn = banner.querySelector('.x-spam-toggle-btn');
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        clusterExpandedState.set(clusterKey, !isExpanded);
        renderClusters(allTweets);
      };

      const blockBtn = banner.querySelector('.x-spam-block-btn');
      blockBtn.onclick = (e) => {
        e.stopPropagation();
        for (const t of cluster) {
          const h = t.dataset.xSpamAuthor;
          if (h) triggerAutoBlock(h, '用户手动拉黑');
        }
        blockBtn.textContent = '已提交拉黑';
        blockBtn.disabled = true;
      };
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
        currentSettings = await context.storage.getConfig("x-comment-cleaner", DEFAULT_SETTINGS);
      }
    },

    async enable() {
      active = true;
    },

    async disable() {
      active = false;
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

          if (checkResult.isSpam && authorHandle) {
            triggerAutoBlock(authorHandle, checkResult.reason || '');
          }
        }
      }

      renderClusters(replyTweets);
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
