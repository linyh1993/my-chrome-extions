/** @file DOM 扫描、滚动采集与 MutationObserver */
const XcfScan = (() => {
  const S = () => XcfContent;

  function clearTimers() {
    clearTimeout(S().scanTimer);
    clearTimeout(S().scrollTimer);
    clearTimeout(S().scrollCaptureTimer);
    clearTimeout(S().afterScrollScanTimer);
    S().scanTimer = null;
    S().scrollTimer = null;
    S().scrollCaptureTimer = null;
    S().afterScrollScanTimer = null;
    S().isScrolling = false;
  }

  function abortScrollCollect() {
    S().collectScrollRunning = false;
    S().collectScrollDone = false;
    if (S().collectScrollTimerId) {
      clearTimeout(S().collectScrollTimerId);
      S().collectScrollTimerId = null;
    }
  }

  function setPageScrollTop(scrollEl, y) {
    if (!XcfRoute.isOnPostThreadUrl()) return false;
    S().suppressScrollEvents += 1;
    try {
      scrollEl.scrollTop = y;
    } finally {
      requestAnimationFrame(() => {
        S().suppressScrollEvents = Math.max(0, S().suppressScrollEvents - 1);
      });
    }
    return true;
  }

  function ensureCaptureObserver() {
    if (S().captureIo) return;
    S().captureIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio <= 0) continue;
          XcfProcessor.processArticle(entry.target);
        }
      },
      { root: null, rootMargin: '240px 0px 320px 0px', threshold: 0.01 }
    );
  }

  function observeArticlesForCapture() {
    if (!XcfRoute.isPostThreadActive()) return;
    ensureCaptureObserver();
    for (const article of S().adapter.findArticles()) {
      if (article.dataset.xcfCaptureObserved) continue;
      article.dataset.xcfCaptureObserved = '1';
      S().captureIo.observe(article);
      XcfProcessor.processArticle(article);
    }
  }

  function teardownCaptureObserver() {
    S().captureIo?.disconnect();
    S().captureIo = null;
  }

  function capturePass() {
    if (XcfRoute.isPostThreadActive()) observeArticlesForCapture();
  }

  async function runScan() {
    if (!XcfRuntime.isAlive() || !XcfRoute.isPostThreadActive()) return;

    await XcfSettings.ensureSpamKeywords();
    XcfRoute.refreshAdapter();
    S().settings = XcfSettings.normalizeSettings(S().settings || XcfSettings.DEFAULTS);
    window.__xcfSettings = S().settings;

    S().pauseObserver = true;
    S().adapter?.invalidatePageCache?.();
    S().adapter.expandCollapsedSections?.();
    XcfFold.cleanupOrphanBars();
    XcfArchiveLog.maybeLogThreadRoot();
    XcfArchiveLog.publishActiveThread();

    const { adapter, context } = S();
    for (const article of adapter.findArticles()) {
      if (!adapter.isMainPost(article, context) && !XcfProcessor.isOverridden(article)) {
        delete article.dataset.xcfProcessed;
        delete article.dataset.xcfSignalLogged;
      }
      XcfProcessor.processArticle(article);
    }
    observeArticlesForCapture();

    XcfFold.recountFolded();
    XcfFold.refreshSummary();
    XcfBootstrap.refreshPanel();
    setTimeout(() => {
      S().pauseObserver = false;
    }, 80);
  }

  function scan() {
    void runScan();
  }

  function scheduleScan(force = false) {
    if (!XcfRoute.isPostThreadActive()) return;
    if (S().pauseObserver && !force) return;
    clearTimeout(S().scanTimer);
    const delay = force ? 60 : S().isScrolling ? 180 : 320;
    S().scanTimer = setTimeout(() => scan(), delay);
  }

  function scheduleAfterScrollScans() {
    if (!XcfRoute.isPostThreadActive()) return;
    clearTimeout(S().afterScrollScanTimer);
    S().afterScrollScanTimer = setTimeout(() => {
      scan();
      setTimeout(() => capturePass(), 500);
    }, 120);
  }

  function scheduleScrollCollectIfNeeded(delayMs = 1200) {
    if (S().collectScrollTimerId) {
      clearTimeout(S().collectScrollTimerId);
      S().collectScrollTimerId = null;
    }
    if (!S().settings?.enabled || !XcfRoute.isOnPostThreadUrl()) return;
    S().collectScrollTimerId = setTimeout(() => {
      S().collectScrollTimerId = null;
      if (!XcfRoute.isOnPostThreadUrl()) return;
      scrollCollectThread();
    }, delayMs);
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function scrollCollectThread() {
    if (S().collectScrollRunning || S().collectScrollDone) return;
    if (!S().settings?.enabled || !XcfRoute.isOnPostThreadUrl()) return;

    S().collectScrollRunning = true;
    try {
      S().adapter.expandCollapsedSections?.();
      await delay(400);
      if (!XcfRoute.isOnPostThreadUrl()) return;

      const scrollEl = document.scrollingElement || document.documentElement;
      const step = Math.max(360, Math.floor(window.innerHeight * 0.5));
      let y = 0;
      let stable = 0;

      for (let pass = 0; pass < 48; pass++) {
        if (!XcfRoute.isOnPostThreadUrl()) return;

        S().adapter.expandCollapsedSections?.();
        if (!setPageScrollTop(scrollEl, y)) return;
        capturePass();
        await delay(280);
        if (!XcfRoute.isOnPostThreadUrl()) return;
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

      if (!XcfRoute.isOnPostThreadUrl()) return;
      if (!setPageScrollTop(scrollEl, 0)) return;
      S().adapter.expandCollapsedSections?.();
      await delay(300);
      if (!XcfRoute.isOnPostThreadUrl()) return;
      scan();
      capturePass();
      S().collectScrollDone = true;
    } finally {
      S().collectScrollRunning = false;
    }
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

  function hookScroll() {
    const markScrolling = () => {
      if (S().suppressScrollEvents > 0) return;
      if (!XcfRoute.isOnPostThreadUrl()) return;
      S().isScrolling = true;
      clearTimeout(S().scrollTimer);
      clearTimeout(S().scrollCaptureTimer);
      S().scrollCaptureTimer = setTimeout(() => {
        S().scrollCaptureTimer = null;
        capturePass();
      }, 140);
      S().scrollTimer = setTimeout(() => {
        S().isScrolling = false;
        scheduleAfterScrollScans();
      }, 280);
    };
    window.addEventListener('scroll', markScrolling, { passive: true, capture: true });
  }

  function observeDom() {
    const target =
      document.querySelector('[data-testid="primaryColumn"]') || document.body;
    S().domObserver = new MutationObserver((mutations) => {
      if (!XcfRuntime.isAlive()) {
        XcfRuntime.teardown();
        return;
      }
      if (S().pauseObserver || mutationFromUs(mutations)) return;
      if (!XcfRoute.isPostThreadActive()) return;
      scheduleScan(false);
      capturePass();
    });
    S().domObserver.observe(target, { childList: true, subtree: true });
  }

  function onRouteChange() {
    abortScrollCollect();
    clearTimers();
    S().adapter?.invalidatePageCache?.();
    teardownCaptureObserver();
    S().overrideTweetIds.clear();
    S().loggedArchiveKeys.clear();
    S().loggedThreadRoots.clear();
    XcfFold.resetPageState();

    if (!XcfRoute.isPostThreadActive()) {
      XcfBootstrap.refreshPanel();
      return;
    }

    XcfArchiveLog.hydrateKeys().finally(() => {
      if (!XcfRoute.isPostThreadActive()) return;
      scheduleScan(true);
      scheduleScrollCollectIfNeeded(1200);
    });
  }

  return {
    clearTimers,
    abortScrollCollect,
    teardownCaptureObserver,
    scan,
    scheduleScan,
    scheduleScrollCollectIfNeeded,
    hookScroll,
    observeDom,
    onRouteChange
  };
})();
