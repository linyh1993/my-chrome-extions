/** @file Content 入口：路由感知 + 扫描调度 */
(() => {
  let settings = null;
  let adapter = null;
  let context = null;
  let scanTimer = null;
  let scrollTimer = null;
  let lastHref = location.href;
  let pauseObserver = false;
  let storageEcho = 0;
  let isScrolling = false;

  /** 滚动后 DOM 复用会丢 dataset，用推文 id 记住状态 */
  const overrideTweetIds = new Set();
  const loggedArchiveKeys = new Set();
  /** 强制刷新缓存：tweetId -> 最近一次写回时间/快照 */
  const refreshByTweetId = new Map();
  // 仅用于“防抖写回”，不是刷新页面/网络请求。只从当前页面 DOM 读取。
  const UPSERT_MIN_INTERVAL_MS = 1200;

  const foldHandlers = () => ({
    onShow: (article) => {
      rememberOverride(article);
      XcfFold.unfoldArticle(article);
    },
    onBlock: blockHandle,
    onWhitelist: whitelistHandle
  });

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    });
  }

  function getTweetId(article) {
    return adapter?.getTweetId ? adapter.getTweetId(article) : null;
  }

  function rememberOverride(article) {
    const id = getTweetId(article);
    if (id) overrideTweetIds.add(id);
    if (article) {
      article.dataset.xcfOverride = '1';
      article.dataset.xcfProcessed = '1';
    }
  }

  function isOverridden(article) {
    if (article.dataset.xcfOverride) return true;
    const id = getTweetId(article);
    return Boolean(id && overrideTweetIds.has(id));
  }

  function withPausedObserver(fn) {
    pauseObserver = true;
    return Promise.resolve(fn()).finally(() => {
      setTimeout(() => {
        pauseObserver = false;
      }, 150);
    });
  }

  function archiveLogKey(article, meta) {
    if (adapter?.getArchiveKey) return adapter.getArchiveKey(article, meta);
    const tid = getTweetId(article);
    if (tid) return `tw:${tid}`;
    const h = XcfSettings.normalizeHandle(meta.handle);
    const t = (meta.text || '').slice(0, 120);
    return `fb:${h}|${t}`;
  }

  function pageThreadId() {
    return adapter?.statusIdFromUrl ? adapter.statusIdFromUrl() : null;
  }

  function logFiltered(article, meta, match) {
    if (!match) return;
    const key = archiveLogKey(article, meta);
    if (loggedArchiveKeys.has(key)) return;
    loggedArchiveKeys.add(key);
    const metrics = adapter?.extractMetrics ? adapter.extractMetrics(article) : null;
    const threadId = pageThreadId() || '';
    sendMessage({
      type: XCF.MSG.LOG_FILTERED,
      entry: {
        at: Date.now(),
        handle: meta.handle,
        displayName: meta.displayName,
        text: meta.text,
        tweetId: (() => {
          const pageId = pageThreadId() || '';
          const tid = getTweetId(article) || '';
          return tid && pageId && tid !== pageId ? tid : '';
        })(),
        threadId,
        ruleId: match.ruleId,
        reason: match.label || match.reason,
        matchedKeyword: match.matchedKeyword || '',
        pageUrl: location.href,
        source: 'auto_filter',
        metrics: metrics || undefined
      }
    });
  }

  function normPageKey(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch {
      return String(url || '').split('?')[0];
    }
  }

  function maybeLogThreadRoot() {
    if (context !== XCF.CONTEXT.POST_THREAD) return;
    if (!adapter?.getThreadRootArticle || !adapter?.extractMeta) return;
    const threadId = pageThreadId();
    if (!threadId) return;
    const root = adapter.getThreadRootArticle();
    if (!root) return;
    const meta = adapter.extractMeta(root);
    const metrics = adapter?.extractMetrics ? adapter.extractMetrics(root) : null;
    const text = (meta.text || '').trim();
    if (!text) return;
    sendMessage({
      type: XCF.MSG.LOG_THREAD_ROOT,
      entry: {
        at: Date.now(),
        tweetId: threadId,
        handle: meta.handle,
        displayName: meta.displayName,
        text: meta.text,
        pageUrl: normPageKey(location.href),
        metrics: metrics || undefined
      }
    });
  }

  function metricsSig(m) {
    if (!m) return '';
    return [
      m.reply || 0,
      m.repost || 0,
      m.like || 0,
      m.view || 0,
      m.bookmark || 0
    ].join(',');
  }

  /** 已入库条目的 DOM 变更写回（不重复新建记录） */
  function maybeUpsertArchiveFromCurrentDom(article, match) {
    if (!article.dataset.xcfLogKey) return;
    if (adapter?.isMainPost?.(article, context)) return;

    const meta = adapter?.extractMeta ? adapter.extractMeta(article) : null;
    if (!meta) return;

    const cacheKey = archiveLogKey(article, meta);
    const now = Date.now();
    const prev = refreshByTweetId.get(cacheKey);
    if (prev && now - prev.at < UPSERT_MIN_INTERVAL_MS) return;

    const metrics = adapter?.extractMetrics ? adapter.extractMetrics(article) : null;
    const threadId = pageThreadId() || '';
    const pageId = adapter?.statusIdFromUrl?.() || '';
    const tid = getTweetId(article) || '';
    const tweetIdForStore =
      tid && pageId && tid !== pageId ? tid : '';

    const text = (meta.text || '').trim();
    const sig = `${text.slice(0, 200)}|${metricsSig(metrics)}`;
    if (prev && prev.sig === sig) {
      refreshByTweetId.set(cacheKey, { at: now, sig });
      return;
    }

    refreshByTweetId.set(cacheKey, { at: now, sig });
    sendMessage({
      type: XCF.MSG.LOG_FILTERED,
      entry: {
        at: now,
        handle: meta.handle,
        displayName: meta.displayName,
        text: meta.text,
        tweetId: tweetIdForStore,
        threadId,
        ruleId: match.ruleId,
        reason: match.label || match.reason,
        matchedKeyword: match.matchedKeyword || '',
        pageUrl: location.href,
        source: 'auto_upsert',
        metrics: metrics || undefined
      }
    });
  }

  function applySettings(next) {
    if (next) {
      settings = next;
      window.__xcfSettings = settings;
    }
    refreshPanel();
  }

  function refreshPanel() {
    if (typeof XcfPanel === 'undefined') return;
    XcfPanel.update(settings || {}, XcfFold.getStats());
  }

  async function persistSettings(partial) {
    storageEcho += 1;
    try {
      const next = await sendMessage({
        type: XCF.MSG.SAVE_SETTINGS,
        partial
      });
      applySettings(next);
      return next;
    } finally {
      setTimeout(() => {
        storageEcho = Math.max(0, storageEcho - 1);
      }, 200);
    }
  }

  function disableFiltering() {
    pauseObserver = true;
    XcfFold.resetPageState();
    overrideTweetIds.clear();
    loggedArchiveKeys.clear();
    refreshByTweetId.clear();
    setTimeout(() => {
      pauseObserver = false;
      refreshPanel();
    }, 150);
  }

  function foldArticleIfMatch(article, meta, match) {
    if (isOverridden(article)) {
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }
    const row = XcfFold.getTweetRow?.(article);
    const rowHidden = row?.classList?.contains('xcf-hidden-article');
    if (
      article.dataset.xcfFolded &&
      article.classList.contains('xcf-hidden-article') &&
      rowHidden
    ) {
      XcfFold.updateBarReason(article, meta, match);
      return;
    }
    if (article.dataset.xcfFolded) {
      delete article.dataset.xcfFolded;
      article.classList.remove('xcf-hidden-article');
      row?.classList?.remove('xcf-hidden-article');
    }
    const logKey = archiveLogKey(article, meta);
    if (!loggedArchiveKeys.has(logKey) && article.dataset.xcfLogKey !== logKey) {
      const hasText = Boolean((meta.text || '').trim());
      const commitLog = (m) => {
        const key = archiveLogKey(article, m);
        article.dataset.xcfLogKey = key;
        logFiltered(article, m, match);
      };
      if (hasText) {
        commitLog(meta);
      } else {
        setTimeout(() => {
          if (!resolveAdapterAndContext()) return;
          const again = adapter.extractMeta(article);
          if ((again.text || '').trim()) commitLog(again);
        }, 600);
      }
    } else if (!article.dataset.xcfLogKey) {
      article.dataset.xcfLogKey = logKey;
    }

    // 即使已经入库过，只要当前页面 DOM 抓到的正文/指标发生变化，也写回覆盖合并。
    // 不刷新页面，只读取当前 DOM。
    maybeUpsertArchiveFromCurrentDom(article, match);
    XcfFold.fold(article, meta, match, foldHandlers());
  }

  function applyBlockToPage(handle) {
    if (!resolveAdapterAndContext() || !handle) return;
    const h = XcfSettings.normalizeHandle(handle);
    const match = {
      ruleId: 'blocklist',
      reason: '屏蔽账号',
      label: `用户 @${handle}`
    };

    for (const article of adapter.findArticles()) {
      if (adapter.isMainPost(article, context)) continue;
      const meta = adapter.extractMeta(article);
      if (XcfSettings.normalizeHandle(meta.handle) !== h) continue;
      article.dataset.xcfProcessed = '1';
      foldArticleIfMatch(article, meta, match);
    }
  }

  async function blockHandle(handle, article) {
    const meta =
      article && adapter?.extractMeta ? adapter.extractMeta(article) : {};
    await withPausedObserver(async () => {
      storageEcho += 1;
      try {
        const next = await sendMessage({
          type: XCF.MSG.BLOCK_HANDLE,
          handle,
          displayName: meta.displayName,
          text: meta.text,
          pageUrl: location.href
        });
        applySettings(next);
        applyBlockToPage(handle);
      } finally {
        setTimeout(() => {
          storageEcho = Math.max(0, storageEcho - 1);
        }, 200);
      }
    });
  }

  async function whitelistHandle(handle, article) {
    await withPausedObserver(async () => {
      storageEcho += 1;
      try {
        const next = await sendMessage({
          type: XCF.MSG.WHITELIST_HANDLE,
          handle
        });
        applySettings(next);
        if (article) {
          rememberOverride(article);
          XcfFold.unfoldArticle(article);
        }
      } finally {
        setTimeout(() => {
          storageEcho = Math.max(0, storageEcho - 1);
        }, 200);
      }
    });
  }

  function resolveAdapterAndContext() {
    adapter = XcfRegistry.getForHost(location.hostname);
    context = adapter ? adapter.detectContext() : null;
    window.__xcfAdapter = adapter || null;
    return Boolean(
      adapter && context && adapter.isContextEnabled(context, settings)
    );
  }

  function scan() {
    if (!resolveAdapterAndContext()) return;
    if (!settings?.enabled) return;

    pauseObserver = true;
    XcfFold.cleanupOrphanBars();
    maybeLogThreadRoot();

    for (const article of adapter.findArticles()) {
      if (adapter.isMainPost(article, context)) {
        article.dataset.xcfMainPost = '1';
        article.dataset.xcfProcessed = '1';
        if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
        continue;
      }
      delete article.dataset.xcfMainPost;

      if (isOverridden(article)) {
        article.dataset.xcfProcessed = '1';
        if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
        continue;
      }

      const meta = adapter.extractMeta(article);
      if (!meta.handle && !meta.text && !meta.inProbableSpam) continue;

      const match = XcfFilterEngine.evaluate(meta, settings);
      article.dataset.xcfProcessed = '1';

      if (match) {
        foldArticleIfMatch(article, meta, match);
      }
    }

    XcfFold.recountFolded();
    XcfFold.refreshSummary();
    refreshPanel();
    setTimeout(() => {
      pauseObserver = false;
    }, 80);
  }

  function isOwnNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (typeof XcfPanel !== 'undefined' && XcfPanel.isOwnNode(node)) return true;
    return (
      node.classList?.contains('xcf-fold-bar') ||
      node.classList?.contains('xcf-summary') ||
      Boolean(node.closest?.('.xcf-fold-bar, .xcf-summary'))
    );
  }

  function mutationFromUs(mutations) {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE && !isOwnNode(n)) return false;
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE && !isOwnNode(n)) return false;
      }
    }
    return true;
  }

  function scheduleScan(force = false) {
    if (pauseObserver && !force) return;
    clearTimeout(scanTimer);
    const delay = force ? 80 : isScrolling ? 700 : 450;
    scanTimer = setTimeout(() => scan(), delay);
  }

  function onRouteMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    overrideTweetIds.clear();
    loggedArchiveKeys.clear();
    refreshByTweetId.clear();
    XcfFold.resetPageState();
    scheduleScan(true);
  }

  function hookHistory() {
    const fire = () => setTimeout(onRouteMaybeChanged, 0);
    const wrap = (fn) =>
      function (...args) {
        const ret = fn.apply(this, args);
        fire();
        return ret;
      };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', fire);
  }

  function hookScroll() {
    const markScrolling = () => {
      isScrolling = true;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        isScrolling = false;
        scheduleScan(false);
      }, 400);
    };
    window.addEventListener('scroll', markScrolling, { passive: true, capture: true });
  }

  function observeDom() {
    const target =
      document.querySelector('[data-testid="primaryColumn"]') || document.body;
    const obs = new MutationObserver((mutations) => {
      if (pauseObserver || mutationFromUs(mutations)) return;
      scheduleScan(false);
    });
    obs.observe(target, { childList: true, subtree: true });
  }

  function mergeSettingsFromStorage(raw) {
    settings = XcfSettings.merge(XcfSettings.DEFAULTS, raw || {});
    window.__xcfSettings = settings;
  }

  async function init() {
    settings = await XcfSettings.load();
    window.__xcfSettings = settings;

    if (typeof XcfPanel !== 'undefined') {
      XcfPanel.mount({
        onEnabledChange: async (enabled) => {
          await persistSettings({ enabled });
          if (!enabled) disableFiltering();
          else scheduleScan(true);
        },
        onPanelUiChange: (patch) => {
          const panelUi = { ...(settings.panelUi || {}), ...patch };
          persistSettings({ panelUi });
        }
      });
      refreshPanel();
    }

    hookHistory();
    hookScroll();
    observeDom();
    if (settings.enabled !== false) scheduleScan(true);
    else disableFiltering();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[XcfSettings.STORAGE_KEY]) return;
      if (storageEcho > 0) return;
      mergeSettingsFromStorage(changes[XcfSettings.STORAGE_KEY].newValue);
      if (settings.enabled === false) disableFiltering();
      else scheduleScan(false);
      refreshPanel();
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === XCF.MSG.SETTINGS_CHANGED) {
        XcfSettings.load().then((s) => {
          applySettings(s);
          if (s.enabled === false) disableFiltering();
          else scheduleScan(false);
          sendResponse({ ok: true });
        });
        return true;
      }
      if (msg.type === XCF.MSG.GET_PAGE_STATS) {
        sendResponse(XcfFold.getStats());
        return false;
      }
      return false;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
