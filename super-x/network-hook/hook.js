/**
 * SuperX Network Hook
 * 注入在 MAIN world，对 X 平台的 GraphQL API 进行安全无损的监听与广播，
 * 并支持会话凭证捕获与安全 API 代理调用（如 ListAddMember）。
 */
(function installSuperXHook() {
  if (window.__superXHookInstalled) return;
  window.__superXHookInstalled = true;

  const SOURCE = "superx-network-hook";
  const GRAPHQL_REGEX = /\/i\/api\/graphql\/([^/?]+)\/([^/?]+)/i;
  const ADD_LIST_MEMBER_ENDPOINT = "https://x.com/i/api/graphql/EQ9KOQeashjfWnwFvcSSpg/ListAddMember";

  // 捕获的会话上下文凭证
  const session = {
    authorization: "",
    csrf: "",
    transaction: "",
    activeUser: "yes",
    authType: "OAuth2Session"
  };

  function getCsrfFromCookie() {
    return document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] || "";
  }

  function inspectHeaders(headers) {
    if (!headers) return;
    try {
      const entries = headers instanceof Headers ? Array.from(headers.entries()) :
                      Array.isArray(headers) ? headers : Object.entries(headers);
      for (const [key, value] of entries) {
        const name = String(key).toLowerCase();
        if (name === "authorization" && value) session.authorization = String(value);
        if (name === "x-csrf-token" && value) session.csrf = String(value);
        if (name === "x-client-transaction-id" && value) session.transaction = String(value);
        if (name === "x-twitter-active-user" && value) session.activeUser = String(value);
        if (name === "x-twitter-auth-type" && value) session.authType = String(value);
      }
    } catch (_) {}
    if (!session.csrf) {
      session.csrf = getCsrfFromCookie();
    }
  }

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
    const input = args[0];
    const init = args[1];

    if (input instanceof Request) {
      inspectHeaders(input.headers);
    }
    if (init && init.headers) {
      inspectHeaders(init.headers);
    }

    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof input === "string" ? input : (input && input.url ? input.url : "");
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
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._superx_url = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const key = String(name).toLowerCase();
    if (key === "authorization") session.authorization = String(value);
    if (key === "x-csrf-token") session.csrf = String(value);
    if (key === "x-client-transaction-id") session.transaction = String(value);
    return origSetHeader.apply(this, arguments);
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
    if (!session.csrf) {
      session.csrf = getCsrfFromCookie();
    }
    return origSend.apply(this, arguments);
  };

  // 3. 执行 ListAddMember API 请求代理
  async function executeAddListMember({ requestId, listId, userId }) {
    const csrf = session.csrf || getCsrfFromCookie();
    const headers = {
      accept: "*/*",
      "content-type": "application/json",
      "x-csrf-token": decodeURIComponent(csrf),
      "x-twitter-active-user": session.activeUser || "yes",
      "x-twitter-auth-type": session.authType || "OAuth2Session"
    };
    if (session.authorization) headers.authorization = session.authorization;
    if (session.transaction) headers["x-client-transaction-id"] = session.transaction;

    const body = {
      variables: { listId: String(listId), userId: String(userId) },
      features: {
        graphql_timeline_v2_bookmark_timeline: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_backsplash_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        longform_notetweets_rich_text_read_enabled: true
      }
    };

    try {
      const response = await fetch(ADD_LIST_MEMBER_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body)
      });
      const raw = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (_) {}

      const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
      const errorMessages = errors.map(e => String(e?.message || "")).filter(Boolean);
      const errorText = errorMessages.join(" ").toLowerCase();

      const listData = parsed?.data?.list;
      const hasListData = Boolean(listData && typeof listData === "object" && (listData.id || listData.id_str || listData.member_count != null));
      const auxiliaryOnly = errors.length > 0 && errors.every(e => {
        const path = Array.isArray(e?.path) ? e.path.join(".") : "";
        return path.includes("default_banner_media");
      });

      let kind = "failed";
      if (response.ok && hasListData && (errors.length === 0 || auxiliaryOnly)) kind = "succeeded";
      else if (response.ok && /already[\s_-]*(a\s+)?member|already\s+in\s+(the\s+)?list|duplicate/.test(errorText)) kind = "already_member";
      else if (response.ok && parsed?.data && !errors.length) kind = "succeeded";

      const retryable = response.status === 400 || response.status === 403 || response.status === 429 || response.status >= 500;

      window.postMessage({
        source: SOURCE,
        type: "SUPERX_ADD_LIST_MEMBER_RESULT",
        requestId,
        ok: kind === "succeeded" || kind === "already_member",
        resultKind: kind,
        status: response.status,
        retryable,
        message: errorMessages[0] || (kind === "failed" ? raw.slice(0, 200) : "")
      }, "*");
    } catch (err) {
      window.postMessage({
        source: SOURCE,
        type: "SUPERX_ADD_LIST_MEMBER_RESULT",
        requestId,
        ok: false,
        resultKind: "failed",
        status: 0,
        retryable: true,
        message: err?.message || "网络请求失败"
      }, "*");
    }
  }

  // 4. 监听来自 content script 的代理指令
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === "superx-content" && event.data.type === "SUPERX_ADD_LIST_MEMBER") {
      executeAddListMember(event.data);
    }
  });

  console.log("[SuperX NetworkHook] Installed successfully in MAIN world.");
})();
