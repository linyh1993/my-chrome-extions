/** @file 路由与帖子页判定（以当前 URL 为准） */
const XcfRoute = (() => {
  const S = () => XcfContent;

  function postThreadIdFromUrl() {
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function isOnPostThreadUrl() {
    return Boolean(postThreadIdFromUrl());
  }

  function pageThreadId() {
    return postThreadIdFromUrl() || (S().adapter?.statusIdFromUrl?.() ?? null);
  }

  function refreshAdapter() {
    S().adapter = XcfRegistry.getForHost(location.hostname);
    S().context = S().adapter ? S().adapter.detectContext() : null;
    window.__xcfAdapter = S().adapter || null;
    return S().adapter;
  }

  function isPostThreadActive() {
    if (!S().settings?.enabled || !isOnPostThreadUrl()) return false;
    const adapter = S().adapter || refreshAdapter();
    return Boolean(adapter?.isContextEnabled?.(XCF.CONTEXT.POST_THREAD, S().settings));
  }

  function hookHistory(onChange) {
    const fire = () => setTimeout(onChange, 0);
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

  function onRouteChange() {
    if (location.href === S().lastHref) return;
    S().lastHref = location.href;
    XcfScan.onRouteChange();
  }

  return {
    postThreadIdFromUrl,
    isOnPostThreadUrl,
    pageThreadId,
    refreshAdapter,
    isPostThreadActive,
    hookHistory,
    onRouteChange
  };
})();
