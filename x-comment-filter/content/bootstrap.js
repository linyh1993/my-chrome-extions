/** @file Content 入口：路由感知 + 扫描调度 */
(() => {
  let settings = null;
  let adapter = null;
  let context = null;
  let scanTimer = null;
  let scrollTimer = null;
  let scrollCaptureTimer = null;
  let afterScrollScanTimer = null;
  let lastHref = location.href;
  let pauseObserver = false;
  let storageEcho = 0;
  let isScrolling = false;
  let captureIo = null;
  let hydratePromise = null;
  let collectScrollDone = false;
  let collectScrollRunning = false;
  let extensionDead = false;
  let contextTornDown = false;
  let domObserver = null;

  function isExtensionAlive() {
    if (extensionDead) return false;
    try {
      if (!chrome.runtime?.id) {
        extensionDead = true;
        return false;
      }
      return true;
    } catch {
      extensionDead = true;
      teardownExtensionContext();
      return false;
    }
  }

  function teardownExtensionContext() {
    if (contextTornDown) return;
    contextTornDown = true;
    extensionDead = true;
    pauseObserver = true;
    teardownCaptureObserver();
    domObserver?.disconnect();
    domObserver = null;
    clearTimeout(scanTimer);
    clearTimeout(scrollTimer);
    clearTimeout(scrollCaptureTimer);
    clearTimeout(afterScrollScanTimer);
    scanTimer = null;
    scrollTimer = null;
    scrollCaptureTimer = null;
    afterScrollScanTimer = null;
  }

  function safeSessionSet(items) {
    if (!isExtensionAlive()) return;
    try {
      chrome.storage.session.set(items, () => {
        void chrome.runtime?.lastError;
      });
    } catch {
      teardownExtensionContext();
    }
  }

  /** 滚动后 DOM 复用会丢 dataset，用推文 id 记住状态 */
  const overrideTweetIds = new Set();
  const loggedArchiveKeys = new Set();
  const loggedThreadRoots = new Set();
  const TEXT_RETRY_MS = [120, 280, 520, 900];

  const foldHandlers = () => ({
    onShow: (article) => {
      rememberOverride(article);
      XcfFold.unfoldArticle(article);
    },
    onBlock: blockHandle,
    onWhitelist: whitelistHandle
  });

  function sendMessage(msg) {
    if (!isExtensionAlive()) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            if (/invalidated|context/i.test(String(chrome.runtime.lastError.message || ''))) {
              teardownExtensionContext();
            }
            resolve(null);
          } else {
            resolve(res);
          }
        });
      } catch {
        teardownExtensionContext();
        resolve(null);
      }
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

  function captureKey(article, meta) {
    const tid = getTweetId(article);
    if (tid) return `tw:${tid}`;
    const m = meta || (adapter?.extractMeta ? adapter.extractMeta(article) : null);
    if (!m) return '';
    return archiveLogKey(article, m);
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

  function buildArchiveEntry(article, meta, extra = {}) {
    const threadId = pageThreadId() || '';
    const pageId = pageThreadId() || '';
    const tid = getTweetId(article) || '';
    const metrics = adapter?.extractMetrics ? adapter.extractMetrics(article) : null;
    const tweetAt = adapter?.extractTweetTime
      ? adapter.extractTweetTime(article)
      : null;
    return {
      at: Date.now(),
      tweetAt: tweetAt || undefined,
      handle: meta.handle,
      displayName: meta.displayName,
      text: meta.text,
      tweetId: tid && pageId && tid !== pageId ? tid : '',
      threadId,
      pageUrl: location.href,
      metrics: metrics || undefined,
      ...extra
    };
  }

  function logNoise(article, meta, match) {
    if (!match) return;
    const key = captureKey(article, meta);
    if (!key) return;
    loggedArchiveKeys.add(key);
    sendMessage({
      type: XCF.MSG.LOG_FILTERED,
      entry: buildArchiveEntry(article, meta, {
        kind: XCF.COMMENT_KIND.NOISE,
        ruleId: match.ruleId,
        reason: match.label || match.reason,
        matchedKeyword: match.matchedKeyword || '',
        source: 'auto_noise'
      })
    });
  }

  function logSignal(article, meta) {
    const key = captureKey(article, meta);
    if (!key || loggedArchiveKeys.has(key)) return;
    loggedArchiveKeys.add(key);
    sendMessage({
      type: XCF.MSG.LOG_FILTERED,
      entry: buildArchiveEntry(article, meta, {
        kind: XCF.COMMENT_KIND.SIGNAL,
        ruleId: '',
        reason: '',
        matchedKeyword: '',
        source: 'auto_signal'
      })
    });
  }

  function commitArchiveRow(article, meta, fn, attempt = 0) {
    if (!article?.isConnected) return;
    const key = captureKey(article, meta);
    if (!key || loggedArchiveKeys.has(key)) return;

    const hasText = Boolean((meta.text || '').trim());
    const run = (m) => {
      const k = captureKey(article, m);
      if (!k || loggedArchiveKeys.has(k)) return;
      fn(article, m);
    };

    if (hasText) {
      run(meta);
      return;
    }

    if (attempt >= TEXT_RETRY_MS.length) {
      if (meta.handle) run(meta);
      return;
    }

    setTimeout(() => {
      if (!article.isConnected) return;
      if (!resolveAdapterAndContext()) return;
      const again = adapter.extractMeta(article);
      if ((again.text || '').trim()) {
        run(again);
        return;
      }
      commitArchiveRow(article, again, fn, attempt + 1);
    }, TEXT_RETRY_MS[attempt]);
  }

  async function hydrateLoggedKeys() {
    if (!resolveAdapterAndContext()) return;
    const threadId = pageThreadId();
    if (!threadId) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = sendMessage({
      type: XCF.MSG.GET_THREAD_CAPTURE_KEYS,
      threadId
    }).then((res) => {
      for (const key of res?.keys || []) loggedArchiveKeys.add(key);
    }).finally(() => {
      hydratePromise = null;
    });
    return hydratePromise;
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
    if (!threadId || loggedThreadRoots.has(threadId)) return;
    const root = adapter.getThreadRootArticle();
    if (!root) return;
    const meta = adapter.extractMeta(root);
    const metrics = adapter?.extractMetrics ? adapter.extractMetrics(root) : null;
    const text = (meta.text || '').trim();
    if (!text) return;
    loggedThreadRoots.add(threadId);
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

  function publishActiveThread() {
    const threadId = pageThreadId();
    if (!threadId) return;
    safeSessionSet({ [XCF.SESSION.ACTIVE_THREAD]: threadId });
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
    teardownCaptureObserver();
    XcfFold.resetPageState();
    overrideTweetIds.clear();
    loggedArchiveKeys.clear();
    loggedThreadRoots.clear();
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
    const logKey = captureKey(article, meta);
    if (!loggedArchiveKeys.has(logKey) && article.dataset.xcfLogKey !== logKey) {
      commitArchiveRow(article, meta, (a, m) => {
        article.dataset.xcfLogKey = captureKey(a, m);
        logNoise(a, m, match);
      });
    } else if (!article.dataset.xcfLogKey) {
      article.dataset.xcfLogKey = logKey;
    }

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

  function processArticle(article) {
    if (!adapter || !settings?.enabled) return;
    if (adapter.isMainPost(article, context)) {
      article.dataset.xcfMainPost = '1';
      article.dataset.xcfProcessed = '1';
      delete article.dataset.xcfPendingText;
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }
    delete article.dataset.xcfMainPost;

    if (isOverridden(article)) {
      article.dataset.xcfProcessed = '1';
      delete article.dataset.xcfPendingText;
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }

    const meta = adapter.extractMeta(article);
    if (
      !meta.handle &&
      !meta.text &&
      !meta.inProbableSpam &&
      !meta.profileBlob
    ) {
      return;
    }

    const { kind, match } = XcfFilterEngine.classify(meta, settings);

    if (kind === XCF.COMMENT_KIND.NOISE && match) {
      if (
        typeof XcfRules?.needsTextForRule === 'function' &&
        XcfRules.needsTextForRule(match.ruleId) &&
        !(meta.text || '').trim()
      ) {
        article.dataset.xcfPendingText = '1';
        return;
      }
      delete article.dataset.xcfPendingText;
      article.dataset.xcfProcessed = '1';
      if (article.dataset.xcfSignalLogged && !article.dataset.xcfFolded) {
        delete article.dataset.xcfSignalLogged;
      }
      foldArticleIfMatch(article, meta, match);
      return;
    }

    delete article.dataset.xcfPendingText;
    article.dataset.xcfProcessed = '1';
    commitArchiveRow(article, meta, (a, m) => {
      article.dataset.xcfLogKey = captureKey(a, m);
      article.dataset.xcfSignalLogged = '1';
      logSignal(a, m);
    });
  }

  function ensureCaptureObserver() {
    if (captureIo) return;
    captureIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio <= 0) continue;
          processArticle(entry.target);
        }
      },
      { root: null, rootMargin: '240px 0px 320px 0px', threshold: 0.01 }
    );
  }

  function observeArticlesForCapture() {
    if (!resolveAdapterAndContext() || !settings?.enabled) return;
    ensureCaptureObserver();
    for (const article of adapter.findArticles()) {
      if (article.dataset.xcfCaptureObserved) continue;
      article.dataset.xcfCaptureObserved = '1';
      captureIo.observe(article);
      processArticle(article);
    }
  }

  function teardownCaptureObserver() {
    if (captureIo) {
      captureIo.disconnect();
      captureIo = null;
    }
  }

  function refoldAllNoise() {
    if (!resolveAdapterAndContext() || !settings?.enabled) return;
    overrideTweetIds.clear();
    for (const article of adapter.findArticles()) {
      delete article.dataset.xcfOverride;
      delete article.dataset.xcfFolded;
      delete article.dataset.xcfProcessed;
      delete article.dataset.xcfSignalLogged;
      delete article.dataset.xcfCaptureObserved;
      article.classList.remove('xcf-hidden-article');
      const row = XcfFold.getTweetRow?.(article);
      row?.classList?.remove('xcf-hidden-article');
      processArticle(article);
    }
    XcfFold.cleanupOrphanBars();
    XcfFold.recountFolded();
    XcfFold.refreshSummary();
    refreshPanel();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 不刷新页面：自动展开折叠区 + 分段滚动，让虚拟列表把回复挂进 DOM 再抓取 */
  async function scrollCollectThread() {
    if (collectScrollRunning || collectScrollDone) return;
    if (!resolveAdapterAndContext() || !settings?.enabled) return;
    if (context !== XCF.CONTEXT.POST_THREAD) return;

    collectScrollRunning = true;
    try {
      adapter.expandCollapsedSections?.();
      await delay(400);

      const scrollEl = document.scrollingElement || document.documentElement;
      const step = Math.max(360, Math.floor(window.innerHeight * 0.5));
      let y = 0;
      let stable = 0;
      const maxPasses = 48;

      for (let pass = 0; pass < maxPasses; pass++) {
        adapter.expandCollapsedSections?.();
        scrollEl.scrollTop = y;
        capturePass();
        await delay(280);
        scan();

        const maxY = Math.max(0, scrollEl.scrollHeight - window.innerHeight);
        if (y >= maxY - 8) {
          stable += 1;
          if (stable >= 2) break;
        } else {
          stable = 0;
        }
        y = Math.min(y + step, maxY + 1);
      }

      scrollEl.scrollTop = 0;
      adapter.expandCollapsedSections?.();
      await delay(300);
      scan();
      capturePass();
      collectScrollDone = true;
    } finally {
      collectScrollRunning = false;
    }
  }

  function scan() {
    if (!isExtensionAlive()) return;
    if (!resolveAdapterAndContext()) return;
    if (!settings?.enabled) return;

    settings = XcfSettings.normalizeSettings(settings || XcfSettings.DEFAULTS);
    window.__xcfSettings = settings;

    pauseObserver = true;
    adapter?.invalidatePageCache?.();
    adapter.expandCollapsedSections?.();
    XcfFold.cleanupOrphanBars();
    maybeLogThreadRoot();
    publishActiveThread();

    for (const article of adapter.findArticles()) {
      if (!adapter.isMainPost(article, context) && !isOverridden(article)) {
        delete article.dataset.xcfProcessed;
        delete article.dataset.xcfSignalLogged;
      }
      processArticle(article);
    }
    observeArticlesForCapture();

    XcfFold.recountFolded();
    XcfFold.refreshSummary();
    refreshPanel();
    setTimeout(() => {
      pauseObserver = false;
    }, 80);
  }

  function capturePass() {
    if (!resolveAdapterAndContext() || !settings?.enabled) return;
    observeArticlesForCapture();
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
    const delay = force ? 60 : isScrolling ? 180 : 320;
    scanTimer = setTimeout(() => scan(), delay);
  }

  function scheduleAfterScrollScans() {
    clearTimeout(afterScrollScanTimer);
    afterScrollScanTimer = setTimeout(() => {
      scan();
      setTimeout(() => capturePass(), 500);
    }, 120);
  }

  function onRouteMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    adapter?.invalidatePageCache?.();
    teardownCaptureObserver();
    overrideTweetIds.clear();
    loggedArchiveKeys.clear();
    loggedThreadRoots.clear();
    collectScrollDone = false;
    collectScrollRunning = false;
    XcfFold.resetPageState();
    hydrateLoggedKeys().finally(() => {
      scheduleScan(true);
      setTimeout(() => scrollCollectThread(), 1200);
    });
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
      clearTimeout(scrollCaptureTimer);
      scrollCaptureTimer = setTimeout(() => {
        scrollCaptureTimer = null;
        capturePass();
      }, 140);
      scrollTimer = setTimeout(() => {
        isScrolling = false;
        scheduleAfterScrollScans();
      }, 280);
    };
    window.addEventListener('scroll', markScrolling, { passive: true, capture: true });
  }

  function observeDom() {
    const target =
      document.querySelector('[data-testid="primaryColumn"]') || document.body;
    domObserver = new MutationObserver((mutations) => {
      if (!isExtensionAlive()) {
        teardownExtensionContext();
        return;
      }
      if (pauseObserver || mutationFromUs(mutations)) return;
      scheduleScan(false);
      capturePass();
    });
    domObserver.observe(target, { childList: true, subtree: true });
  }

  function mergeSettingsFromStorage(raw) {
    settings = XcfSettings.normalizeSettings(raw || {});
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
    window.__xcfRefoldAllNoise = refoldAllNoise;
    await hydrateLoggedKeys();
    if (settings.enabled !== false) {
      scheduleScan(true);
      setTimeout(() => scrollCollectThread(), 1200);
    } else disableFiltering();

    if (!isExtensionAlive()) return;

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionAlive()) return;
        if (area !== 'sync' || !changes[XcfSettings.STORAGE_KEY]) return;
        if (storageEcho > 0) return;
        mergeSettingsFromStorage(changes[XcfSettings.STORAGE_KEY].newValue);
        if (settings.enabled === false) disableFiltering();
        else scheduleScan(false);
        refreshPanel();
      });

      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!isExtensionAlive()) return false;
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
    } catch {
      teardownExtensionContext();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
