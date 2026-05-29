/** @file Content 入口：路由感知 + 扫描调度 */
(() => {
  let settings = null;
  let adapter = null;
  let context = null;
  let scanTimer = null;
  let lastHref = location.href;

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    });
  }

  async function blockHandle(handle) {
    await sendMessage({ type: XCF.MSG.BLOCK_HANDLE, handle });
    settings = await XcfSettings.load();
    window.__xcfSettings = settings;
    scheduleScan(true);
  }

  async function whitelistHandle(handle, article) {
    await sendMessage({ type: XCF.MSG.WHITELIST_HANDLE, handle });
    settings = await XcfSettings.load();
    window.__xcfSettings = settings;
    if (article) XcfFold.unfoldArticle(article);
    scheduleScan(true);
  }

  function resolveAdapterAndContext() {
    adapter = XcfRegistry.getForHost(location.hostname);
    context = adapter ? adapter.detectContext() : null;
    return Boolean(
      adapter && context && adapter.isContextEnabled(context, settings)
    );
  }

  function scan(force = false) {
    if (!settings?.enabled || !adapter || !context) return;
    if (!adapter.isContextEnabled(context, settings)) return;

    const articles = adapter.findArticles();
    for (const article of articles) {
      if (article.dataset.xcfProcessed && !force) continue;
      if (adapter.isMainPost(article, context)) {
        article.dataset.xcfProcessed = '1';
        continue;
      }

      const meta = adapter.extractMeta(article);
      if (!meta.handle && !meta.text) continue;

      const match = XcfFilterEngine.evaluate(meta, settings);
      article.dataset.xcfProcessed = '1';

      if (match) {
        XcfFold.fold(article, meta, match, {
          onBlock: blockHandle,
          onWhitelist: whitelistHandle
        });
      }
    }
  }

  function scheduleScan(force = false) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(force), force ? 50 : 280);
  }

  function onRouteMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    XcfFold.resetPageState();
    if (!resolveAdapterAndContext()) return;
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

  function observeDom() {
    const target = document.body;
    if (!target) return;
    const obs = new MutationObserver(() => scheduleScan(false));
    obs.observe(target, { childList: true, subtree: true });
  }

  async function init() {
    settings = await XcfSettings.load();
    window.__xcfSettings = settings;

    if (!resolveAdapterAndContext()) return;

    hookHistory();
    observeDom();
    scheduleScan(true);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[XcfSettings.STORAGE_KEY]) return;
      settings = XcfSettings.merge(
        XcfSettings.DEFAULTS,
        changes[XcfSettings.STORAGE_KEY].newValue || {}
      );
      window.__xcfSettings = settings;
      XcfFold.resetPageState();
      if (resolveAdapterAndContext()) scheduleScan(true);
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === XCF.MSG.SETTINGS_CHANGED) {
        XcfSettings.load().then((s) => {
          settings = s;
          window.__xcfSettings = s;
          XcfFold.resetPageState();
          if (resolveAdapterAndContext()) scheduleScan(true);
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
