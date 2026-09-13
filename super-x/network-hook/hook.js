/**
 * SuperX Network Hook
 * 注入在 MAIN world，对 X 平台的 GraphQL API 进行安全无损的监听与广播
 */
(function installSuperXHook() {
  if (window.__superXHookInstalled) return;
  window.__superXHookInstalled = true;

  const SOURCE = "superx-network-hook";
  const GRAPHQL_REGEX = /\/i\/api\/graphql\/([^/?]+)\/([^/?]+)/i;

  function postData(endpoint, data) {
    try {
      window.postMessage({
        source: SOURCE,
        endpoint,
        data
      }, "*");
    } catch (e) {
      // 避免某些大数据克隆错误
    }
  }

  // 1. Hook window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");
      if (url && GRAPHQL_REGEX.test(url)) {
        const match = url.match(GRAPHQL_REGEX);
        const endpoint = match ? match[2] : "unknown";
        
        // 异步克隆响应流，绝不阻塞原网页使用
        response.clone().json().then((json) => {
          postData(endpoint, json);
        }).catch(() => {});
      }
    } catch (err) {
      // 忽略拦截错误，保证宿主页面正常运行
    }
    return response;
  };

  // 2. Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._superx_url = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    if (this._superx_url && GRAPHQL_REGEX.test(this._superx_url)) {
      const url = this._superx_url;
      const match = url.match(GRAPHQL_REGEX);
      const endpoint = match ? match[2] : "unknown";

      this.addEventListener("load", function() {
        try {
          if (this.responseText) {
            const data = JSON.parse(this.responseText);
            postData(endpoint, data);
          }
        } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  console.log("[SuperX NetworkHook] Installed successfully in MAIN world.");
})();
