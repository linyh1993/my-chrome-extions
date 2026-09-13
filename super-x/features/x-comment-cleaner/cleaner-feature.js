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
  const isEnglishLanguageFn = rulesEngine.isEnglishLanguage || (({ text = '', lang = '' } = {}) => {
    const normLang = (lang || '').toLowerCase().trim();
    const cjkChars = (text.match(/[\p{Script=Han}\u4e00-\u9fa5]/gu) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    if (normLang.startsWith('en')) {
      return cjkChars === 0 || (latinChars > 15 && cjkChars <= 5);
    }
    if (cjkChars === 0 && latinChars >= 8) return true;
    if (latinChars >= 20 && cjkChars <= 2 && (latinChars / (latinChars + cjkChars)) > 0.8) return true;
    return false;
  });

  const DEFAULT_SETTINGS = rulesEngine.DEFAULT_CLEANER_SETTINGS || {
    enabled: true,
    hideMode: 'collapse',
    autoBlock: false,
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
    skipEnglish: true,
    blockedCount: 0
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentThreadUrl = '';
  let isCurrentThreadEnglish = false;
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

  function getTweetTextAndLang(tweet) {
    const tweetTextEl = tweet.querySelector('div[data-testid="tweetText"]');
    const text = tweetTextEl ? (tweetTextEl.innerText || tweetTextEl.textContent || '').trim() : '';
    const lang = (tweetTextEl ? tweetTextEl.getAttribute('lang') : '') || tweet.querySelector('[lang]')?.getAttribute('lang') || '';
    return { text, lang };
  }

  function checkTweetTranslation(tweet) {
    if (!tweet) return { isTranslated: false, isForeign: false, isEnglish: false, sourceLang: '' };

    const buttons = Array.from(tweet.querySelectorAll('button, div[role="button"], a[role="link"], span'));
    let hasShowOriginalBtn = false;
    let hasTranslatePromptBtn = false;

    for (const el of buttons) {
      const txt = (el.innerText || el.textContent || '').trim();
      if (/^(?:显示原文|Show original)$/i.test(txt)) {
        hasShowOriginalBtn = true;
      }
      if (/^(?:翻译帖子|Translate post|Translate Tweet)$/i.test(txt)) {
        hasTranslatePromptBtn = true;
      }
    }

    const fullText = tweet.innerText || tweet.textContent || '';
    const matchCn = fullText.match(/翻译自\s*([^\s·\n\r，。！]+)/);
    const matchEn = fullText.match(/Translated from\s*([^\s·\n\r,.]+)/i);
    const sourceLang = matchCn ? matchCn[1].trim() : (matchEn ? matchEn[1].trim() : '');

    const isChineseSource = /^(?:中文|汉语|Chinese|zh|zh-cn|zh-tw)$/i.test(sourceLang);
    const isEnglishSource = /^(?:英语|英文|English|en)$/i.test(sourceLang);

    if (hasShowOriginalBtn || (!!sourceLang && /显示原文|Show original/i.test(fullText))) {
      return {
        isTranslated: true,
        sourceLang,
        isEnglish: isEnglishSource,
        isForeign: !isChineseSource
      };
    }

    if (hasTranslatePromptBtn) {
      return {
        isTranslated: false,
        sourceLang,
        isEnglish: isEnglishSource,
        isForeign: true
      };
    }

    return {
      isTranslated: false,
      sourceLang,
      isEnglish: isEnglishSource,
      isForeign: false
    };
  }

  function isPostForeignOrEnglish(tweet) {
    if (!tweet) return false;

    // 1. 优先检查 X 原生自动翻译状态 (避免自动翻译将英文/外文转为中文后误判为中文帖)
    const translation = checkTweetTranslation(tweet);
    if (translation.isForeign || translation.isEnglish) {
      return true;
    }

    // 2. 语言特征检测
    const { text, lang } = getTweetTextAndLang(tweet);
    if (isEnglishLanguageFn({ text, lang })) {
      return true;
    }

    return false;
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

  function recordBlockedAccount(handle, reason) {
    chrome.storage.local.get(['blockedAccountsCache'], (data) => {
      const list = Array.isArray(data.blockedAccountsCache) ? data.blockedAccountsCache : [];
      const norm = normalizeHandleFn(handle);
      if (!list.some(item => (typeof item === 'string' ? item : item.handle) === norm)) {
        list.push({ handle: norm, reason: reason || '自动拉黑', timestamp: Date.now() });
        chrome.storage.local.set({ blockedAccountsCache: list.slice(-1000) });
      }
    });
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

        if (res && (res.ok || res.alreadyBlocked)) {
          blockedHandlesState.add(norm);
          console.log(`[SuperX Cleaner] ✓ 已成功通过接口拉黑账号 @${norm}${res.alreadyBlocked ? ' (之前已黑)' : ''}`);
          recordBlockedAccount(norm, task.reason);
          if (!res.alreadyBlocked) {
            chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
              if (chrome.runtime.lastError) {}
            });
          }
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
        const targetLeadSpam = isExpanded ? 'expanded' : 'lead';
        if (leadTweet.dataset.xSpam !== targetLeadSpam) {
          leadTweet.dataset.xSpam = targetLeadSpam;
        }

        let banner = leadTweet.querySelector('.x-spam-inner-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.className = 'x-spam-inner-banner';
          leadTweet.insertBefore(banner, leadTweet.firstChild);
        }

        const targetBannerClass = 'x-spam-inner-banner' + (isExpanded ? ' is-expanded' : '');
        if (banner.className !== targetBannerClass) {
          banner.className = targetBannerClass;
        }

        const reasonDesc = sampleReasons ? ` · (${escapeHtml(sampleReasons)}${sampleReasons ? ' 等' : ''})` : '';

        const blockBtnText = isBlocked
          ? '✓ 已拉黑 · 撤销'
          : (isQueued
            ? '⏳ 防封排队拉黑中...'
            : (isSingleAuthor ? `🚫 原生拉黑 @${escapeHtml(primaryAuthor)}` : `🚫 一键拉黑 (${authors.length}人)`));

        const renderSignature = `${count}|${isExpanded}|${isBlocked}|${isQueued}|${sampleReasons}|${blockBtnText}`;

        // 若当前处于异步操作中或渲染签名未变，跳过 DOM 重建，彻底消除闪烁
        if (!banner.dataset.isBusy && banner.dataset.renderSignature !== renderSignature) {
          banner.dataset.renderSignature = renderSignature;
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
              const nextExp = clusterExpandedState.get(clusterKey) !== true;
              clusterExpandedState.set(clusterKey, nextExp);
              renderClusters(allTweets);
            };
          }

          const blockBtn = banner.querySelector('.x-spam-btn-block');
          if (blockBtn && typeof xAdapter.blockUser === 'function') {
            blockBtn.onclick = async (e) => {
              e.stopPropagation();
              e.preventDefault();
              banner.dataset.isBusy = 'true';
              blockBtn.disabled = true;
              blockBtn.textContent = '处理中...';

              try {
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
                    if (res && (res.ok || res.alreadyBlocked || res.userUnavailable)) {
                      const normA = normalizeHandleFn(a);
                      blockedHandlesState.add(normA);
                      manuallyUnblockedHandles.delete(normA);
                      recordBlockedAccount(normA, res.userUnavailable ? '已失效/注销死号' : '手动拉黑');
                    }
                  }
                }
              } finally {
                delete banner.dataset.isBusy;
                renderClusters(allTweets);
              }
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
        }

        for (const follower of followers) {
          const targetFollowerSpam = isExpanded ? 'expanded' : 'follower';
          if (follower.dataset.xSpam !== targetFollowerSpam) {
            follower.dataset.xSpam = targetFollowerSpam;
          }
          const followerBanners = follower.querySelectorAll('.x-spam-inner-banner');
          if (followerBanners.length > 0) {
            followerBanners.forEach(b => b.remove());
          }
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

      // 监听配置与拉黑缓存热更新
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes['superx:feature:x-comment-cleaner:config']) {
            const newConfig = changes['superx:feature:x-comment-cleaner:config'].newValue;
            if (newConfig) {
              currentSettings = { ...DEFAULT_SETTINGS, ...newConfig, enabled: true };
              console.log("[SuperX Cleaner] Hot reloaded settings:", currentSettings);
              if (window.__SuperX__ && window.__SuperX__.DOMObserver) {
                window.__SuperX__.DOMObserver.scheduleScan(30);
              }
            }
          }
          if (changes.blockedAccountsCache) {
            const list = Array.isArray(changes.blockedAccountsCache.newValue) ? changes.blockedAccountsCache.newValue : [];
            for (const item of list) {
              const h = typeof item === 'string' ? item : item.handle;
              if (h) blockedHandlesState.add(normalizeHandleFn(h));
            }
          }
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
        isCurrentThreadEnglish = false;
        threadTextOccurrences.clear();
        threadSimhashTracker.clear();
        clusterExpandedState.clear();
        console.log("[SuperX Cleaner] Route changed to:", currentThreadUrl);
      }
    },

    onDOMNodes(allTweets) {
      if (!active || !currentSettings.enabled) return;
      if (!isStatusPage()) return;
      if (!allTweets || allTweets.length === 0) return;

      const opHandle = getOpHandle();
      const statusMatch = window.location.pathname.match(/\/status\/(\d+)/);
      const targetStatusId = statusMatch ? statusMatch[1] : null;

      // 1. 定位主帖 (OP Tweet) 并检测是否为英文帖子
      let opTweet = null;
      if (targetStatusId) {
        for (const tweet of allTweets) {
          if (getTweetId(tweet) === targetStatusId) {
            opTweet = tweet;
            break;
          }
        }
      }
      if (!opTweet && window.scrollY < 300) {
        opTweet = allTweets[0];
      }

      if (opTweet) {
        opTweet.dataset.xSpamProcessed = 'true';
        opTweet.dataset.xSpamIsOp = 'true';
        delete opTweet.dataset.xSpam;
        opTweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());

        if (!isCurrentThreadEnglish && currentSettings.skipEnglish !== false) {
          if (isPostForeignOrEnglish(opTweet)) {
            isCurrentThreadEnglish = true;
            console.log('[SuperX Cleaner] 识别到当前主帖为英文/外文翻译帖子，跳过该帖下的垃圾评论清理');
          }
        }
      }

      // 2. 对于英文/外文翻译帖子，不触发内容清理，并清理所有现存垃圾标记
      if (isCurrentThreadEnglish && currentSettings.skipEnglish !== false) {
        for (const tweet of allTweets) {
          if (tweet.dataset.xSpam || tweet.dataset.xSpamEvaluation === 'true') {
            delete tweet.dataset.xSpam;
            delete tweet.dataset.xSpamEvaluation;
            delete tweet.dataset.xSpamReason;
            tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
          }
        }
        return;
      }

      const replyTweets = [];
      for (let i = 0; i < allTweets.length; i++) {
        const tweet = allTweets[i];
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

        const { text, lang } = getTweetTextAndLang(tweet);
        const tweetId = getTweetId(tweet);
        const lastEvaluatedText = tweet.dataset.xSpamLastText;
        const isNewOrChanged = tweet.dataset.xSpamProcessed !== 'true' || lastEvaluatedText !== text;

        if (isNewOrChanged) {
          if (!text && !authorHandle) continue;

          // 单条回复若是英文内容或外文自动翻译内容，也不触发垃圾清理
          if (currentSettings.skipEnglish !== false && isPostForeignOrEnglish(tweet)) {
            tweet.dataset.xSpamProcessed = 'true';
            tweet.dataset.xSpamTweetId = tweetId || '';
            tweet.dataset.xSpamLastText = text;
            tweet.dataset.xSpamEvaluation = 'false';
            delete tweet.dataset.xSpam;
            tweet.querySelectorAll('.x-spam-inner-banner').forEach(b => b.remove());
            continue;
          }

          const links = getTweetLinks(tweet);
          const checkResult = evaluateSpamFn({
            text,
            lang,
            rawText: tweet.innerText || tweet.textContent || '',
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

  // 社区黑名单挂机批量拉黑运行器
  const communityBatchState = {
    running: false,
    paused: false,
    total: 0,
    current: 0,
    successCount: 0,
    alreadyBlockedCount: 0,
    failCount: 0,
    statusText: '就绪',
    lastHandle: ''
  };

  async function updateBatchProgressStorage() {
    try {
      await chrome.storage.local.set({
        superx_community_block_progress: {
          running: communityBatchState.running,
          paused: communityBatchState.paused,
          total: communityBatchState.total,
          current: communityBatchState.current,
          successCount: communityBatchState.successCount,
          alreadyBlockedCount: communityBatchState.alreadyBlockedCount,
          failCount: communityBatchState.failCount,
          statusText: communityBatchState.statusText,
          lastHandle: communityBatchState.lastHandle,
          updatedAt: Date.now()
        }
      });
    } catch (e) {}
  }

  async function startCommunityBatchBlock(allHandles) {
    if (communityBatchState.running) {
      if (communityBatchState.paused) {
        communityBatchState.paused = false;
        communityBatchState.statusText = '挂机拉黑中...';
        await updateBatchProgressStorage();
      }
      return;
    }

    // 1. 获取最新本地已拉黑缓存，做严格去重，避免重复请求 X 接口
    const storageData = await new Promise(r => chrome.storage.local.get(['blockedAccountsCache'], r));
    const cachedList = Array.isArray(storageData.blockedAccountsCache) ? storageData.blockedAccountsCache : [];
    for (const item of cachedList) {
      const h = typeof item === 'string' ? item : item.handle;
      if (h) blockedHandlesState.add(normalizeHandleFn(h));
    }

    const initialTotal = allHandles.length;
    // 过滤出未被拉黑的 handle
    const pendingList = [];
    let alreadyFilteredCount = 0;
    for (const raw of allHandles) {
      const norm = normalizeHandleFn(raw);
      if (!norm) continue;
      if (blockedHandlesState.has(norm)) {
        alreadyFilteredCount++;
      } else {
        pendingList.push(norm);
      }
    }

    communityBatchState.running = true;
    communityBatchState.paused = false;
    communityBatchState.total = initialTotal;
    communityBatchState.current = alreadyFilteredCount;
    communityBatchState.alreadyBlockedCount = alreadyFilteredCount;
    communityBatchState.successCount = 0;
    communityBatchState.failCount = 0;
    communityBatchState.statusText = `挂机拉黑中 (已本地跳过 ${alreadyFilteredCount} 个已拉黑账号)...`;
    await updateBatchProgressStorage();

    console.log(`[SuperX Cleaner] 启动社区黑名单挂机拉黑: 总量 ${initialTotal}，本地已拉黑/跳过 ${alreadyFilteredCount}，待处理 ${pendingList.length}`);

    // 开始异步流控执行
    (async () => {
      for (let i = 0; i < pendingList.length; i++) {
        if (!communityBatchState.running) break;

        while (communityBatchState.paused) {
          communityBatchState.statusText = '已暂停挂机拉黑';
          await updateBatchProgressStorage();
          await sleep(1000);
          if (!communityBatchState.running) break;
        }
        if (!communityBatchState.running) break;

        const handle = pendingList[i];
        communityBatchState.lastHandle = handle;

        // 二次双重检查是否已在集合中
        if (blockedHandlesState.has(handle) || manuallyUnblockedHandles.has(handle)) {
          communityBatchState.alreadyBlockedCount++;
          communityBatchState.current++;
          await updateBatchProgressStorage();
          continue;
        }

        communityBatchState.statusText = `正在拉黑 @${handle} (${communityBatchState.current + 1}/${communityBatchState.total})...`;
        await updateBatchProgressStorage();

        try {
          const res = await xAdapter.blockUser(handle);
          if (res && (res.ok || res.alreadyBlocked || res.userUnavailable)) {
            blockedHandlesState.add(handle);
            if (res.userUnavailable) {
              communityBatchState.alreadyBlockedCount++;
              recordBlockedAccount(handle, '已失效/注销死号');
              console.log(`[SuperX Cleaner] @${handle} 账号已注销/不存在 (code 50)，登记本地并跳过`);
            } else if (res.alreadyBlocked) {
              communityBatchState.alreadyBlockedCount++;
              recordBlockedAccount(handle, 'FeedSieve 社区黑名单');
              console.log(`[SuperX Cleaner] @${handle} 官方返回已在黑名单中，登记本地并跳过`);
            } else {
              communityBatchState.successCount++;
              recordBlockedAccount(handle, 'FeedSieve 社区黑名单');
              console.log(`[SuperX Cleaner] ✓ 成功拉黑 @${handle}`);
              chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
                if (chrome.runtime.lastError) {}
              });
            }
          } else if (res && res.status === 429) {
            console.warn(`[SuperX Cleaner] ⚠️ 触发 X 官方频率限制 (HTTP 429)！进入 60 秒安全冷却期`);
            communityBatchState.statusText = `触发 X 官方限流(429)，安全冷却 60 秒后自动恢复...`;
            await updateBatchProgressStorage();
            await sleep(60000);
            i--; // 重试当前账号
            continue;
          } else {
            communityBatchState.failCount++;
            console.warn(`[SuperX Cleaner] 拉黑 @${handle} 失败:`, res?.error);
          }
        } catch (e) {
          communityBatchState.failCount++;
          console.error(`[SuperX Cleaner] 批量拉黑网络异常 @${handle}:`, e);
        }

        communityBatchState.current++;
        communityBatchState.statusText = `已处理 ${communityBatchState.current}/${communityBatchState.total} (成功 ${communityBatchState.successCount}, 已黑 ${communityBatchState.alreadyBlockedCount}, 失败 ${communityBatchState.failCount})`;
        await updateBatchProgressStorage();

        // 随机延迟 2500ms ~ 4500ms，防封防刷
        const delay = 2500 + Math.floor(Math.random() * 2000);
        await sleep(delay);
      }

      communityBatchState.running = false;
      communityBatchState.paused = false;
      communityBatchState.statusText = `挂机完成！总计 ${communityBatchState.total}，本次新拉黑 ${communityBatchState.successCount}，已拉黑跳过 ${communityBatchState.alreadyBlockedCount}，失败 ${communityBatchState.failCount}`;
      await updateBatchProgressStorage();
      console.log(`[SuperX Cleaner] 社区黑名单挂机拉黑任务结束:`, communityBatchState);
    })();
  }

  function pauseCommunityBatchBlock() {
    if (communityBatchState.running) {
      communityBatchState.paused = true;
      communityBatchState.statusText = '已暂停挂机拉黑';
      updateBatchProgressStorage();
    }
  }

  function resumeCommunityBatchBlock() {
    if (communityBatchState.running && communityBatchState.paused) {
      communityBatchState.paused = false;
      communityBatchState.statusText = '恢复挂机拉黑中...';
      updateBatchProgressStorage();
    }
  }

  function stopCommunityBatchBlock() {
    communityBatchState.running = false;
    communityBatchState.paused = false;
    communityBatchState.statusText = '已重置 / 停止';
    updateBatchProgressStorage();
  }

  // 接收来自侧边栏的社区黑名单批量拉黑与控制指令
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'START_COMMUNITY_BATCH_BLOCK') {
      const handles = Array.isArray(msg.handles) ? msg.handles : [];
      startCommunityBatchBlock(handles);
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === 'PAUSE_COMMUNITY_BATCH_BLOCK') {
      pauseCommunityBatchBlock();
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === 'RESUME_COMMUNITY_BATCH_BLOCK') {
      resumeCommunityBatchBlock();
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === 'STOP_COMMUNITY_BATCH_BLOCK') {
      stopCommunityBatchBlock();
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === 'GET_COMMUNITY_BATCH_STATUS') {
      sendResponse({ success: true, state: communityBatchState });
      return true;
    }

    if (msg.type === 'ENQUEUE_COMMUNITY_BATCH_BLOCK' && Array.isArray(msg.handles)) {
      startCommunityBatchBlock(msg.handles);
      sendResponse({ success: true, count: msg.handles.length });
      return true;
    }
  });

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
