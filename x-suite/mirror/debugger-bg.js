/** @file Mirror debugger + Network relay logic for the service worker. */
const MirrorBg = (() => {
  // Tab-level runtime state. Service worker may restart, so every map is cache only.
  const attachedTabs = new Set();
  const attachingTabs = new Map();
  const tabMirrorCtx = new Map();
  const trackedRequests = new Map();
  const trackedWebSockets = new Map();
  const deliveryStateByTab = new Map();
  const debuggerVersion = '1.3';
  const postTimeoutMs = 5000;
  const postRetryDelayMs = 500;
  const postAttempts = 2;

  function hasDebuggerPermission() {
    return new Promise((resolve) => {
      if (!chrome.permissions?.contains) {
        resolve(true);
        return;
      }
      chrome.permissions.contains({ permissions: ['debugger'] }, resolve);
    });
  }

  function requestDebuggerPermission() {
    return new Promise((resolve) => {
      if (!chrome.permissions?.request) {
        resolve(false);
        return;
      }
      chrome.permissions.request({ permissions: ['debugger'] }, (granted) => {
        resolve(Boolean(granted) && !chrome.runtime.lastError);
      });
    });
  }

  async function ensureDebuggerPermission() {
    if (await hasDebuggerPermission()) return true;
    return requestDebuggerPermission();
  }

  function isMirrorEnabled(cfg) {
    return cfg?.enabled !== false;
  }

  function createMirrorCtx(site, cfg) {
    return {
      site,
      mirrorUrl: cfg?.mirrorUrl || MirrorSettings.DEFAULTS.mirrorUrl
    };
  }

  function getSiteUrlPatterns() {
    const patterns = new Set();
    for (const site of SITES) {
      for (const pattern of site.urlPatterns || []) patterns.add(pattern);
    }
    return [...patterns];
  }

  function persistMirrorEnabled(enabled) {
    return MirrorSettings.save({ enabled: Boolean(enabled) });
  }

  async function ensureTabMirror(tabId) {
    if (!tabId || attachedTabs.has(tabId)) {
      return { ok: true, isAttached: attachedTabs.has(tabId) };
    }
    if (attachingTabs.has(tabId)) return attachingTabs.get(tabId);

    // One attach attempt per tab. Concurrent callers share the same Promise.
    const attachTask = (async () => {
      const cfg = await MirrorSettings.load();
      if (!isMirrorEnabled(cfg)) return { ok: true, isAttached: false, mirrorEnabled: false };

      const site = await resolveSiteForTab(tabId);
      if (!site) {
        return { ok: false, isAttached: false, error: 'unsupported_site' };
      }

      return attachDebugger(tabId, cfg, site);
    })().finally(() => {
      attachingTabs.delete(tabId);
    });

    attachingTabs.set(tabId, attachTask);
    return attachTask;
  }

  function restoreEnabledMirrors() {
    // Reconcile after startup/config changes; already-attached tabs are skipped by ensureTabMirror.
    MirrorSettings.load().then((cfg) => {
      if (!isMirrorEnabled(cfg)) return;
      chrome.tabs.query(
        {
          url: [
            '*://x.com/*',
            '*://*.x.com/*',
            '*://twitter.com/*',
            '*://*.twitter.com/*'
          ]
        },
        (tabs) => {
          for (const tab of tabs) {
            if (tab.id) ensureTabMirror(tab.id);
          }
        }
      );
    });
  }

  async function enableMirrorOnTab(tabId, sendResponse) {
    const granted = await ensureDebuggerPermission();
    if (!granted) {
      sendResponse?.({
        ok: false,
        isAttached: false,
        permissionDenied: true
      });
      return;
    }

    sendResponse?.({ ...(await ensureTabMirror(tabId)), mirrorEnabled: true });
  }

  function resolveSiteForTab(tabId) {
    return new Promise((resolve) => {
      if (!tabId) {
        resolve(null);
        return;
      }
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab?.url) {
          resolve(null);
          return;
        }
        resolve(getSiteByUrl(tab.url));
      });
    });
  }

  function buildTabStatus(tabId, cfg, site = null) {
    return {
      tabId,
      delivery: deliveryStateByTab.get(tabId) || null,
      isAttached: attachedTabs.has(tabId),
      isAttaching: attachingTabs.has(tabId),
      mirrorEnabled: isMirrorEnabled(cfg),
      site: tabMirrorCtx.get(tabId)?.site || site,
      siteLabel: site?.label ?? null
    };
  }

  function attachDebugger(tabId, cfg, resolvedSite = null) {
    return new Promise((resolve) => {
      const attachSite = (site) => {
        if (!site) {
          resolve({ ok: false, isAttached: false, error: 'unsupported_site' });
          return;
        }

        const ctx = createMirrorCtx(site, cfg);
        tabMirrorCtx.set(tabId, ctx);
        console.log(`[mirror Tab ${tabId}] attach debugger (${site.label})...`);

        chrome.debugger.attach({ tabId }, debuggerVersion, () => {
          if (chrome.runtime.lastError) {
            console.error(`[mirror Tab ${tabId}] attach failed:`, chrome.runtime.lastError.message);
            tabMirrorCtx.delete(tabId);
            resolve({
              ok: false,
              isAttached: false,
              error: chrome.runtime.lastError.message || 'attach_failed'
            });
            return;
          }

          chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError.message || 'network_enable_failed';
              console.error(`[mirror Tab ${tabId}] Network.enable failed:`, error);
              detachDebugger(tabId);
              resolve({ ok: false, isAttached: false, error });
              return;
            }

            // Attach completion is async; verify config and URL again before marking active.
            Promise.all([MirrorSettings.load(), resolveSiteForTab(tabId)]).then(
              ([nextCfg, currentSite]) => {
                if (!isMirrorEnabled(nextCfg) || currentSite?.id !== site.id) {
                  detachDebugger(tabId);
                  resolve({ ok: true, isAttached: false, mirrorEnabled: isMirrorEnabled(nextCfg) });
                  return;
                }
                ctx.mirrorUrl = nextCfg.mirrorUrl || ctx.mirrorUrl;
                attachedTabs.add(tabId);
                resolve({ ok: true, isAttached: true, site });
              }
            );
          });
        });
      };

      if (resolvedSite) {
        attachSite(resolvedSite);
        return;
      }

      resolveSiteForTab(tabId).then(attachSite);
    });
  }

  function clearTabState(tabId) {
    // Detach, close, and navigation cleanup all converge here.
    attachedTabs.delete(tabId);
    attachingTabs.delete(tabId);
    tabMirrorCtx.delete(tabId);
    deliveryStateByTab.delete(tabId);

    for (const [requestId, data] of trackedRequests.entries()) {
      if (data.tabId === tabId) trackedRequests.delete(requestId);
    }
    for (const [requestId, data] of trackedWebSockets.entries()) {
      if (data.tabId === tabId) trackedWebSockets.delete(requestId);
    }
  }

  function detachDebugger(tabId) {
    if (!attachedTabs.has(tabId)) {
      clearTabState(tabId);
      return;
    }

    const finish = () => {
      clearTabState(tabId);
    };

    chrome.debugger.sendCommand({ tabId }, 'Network.disable', {}, () => {
      chrome.debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) {
          console.warn(`[mirror Tab ${tabId}] detach:`, chrome.runtime.lastError.message);
        }
        finish();
      });
    });
  }

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source.tabId;
    if (!tabId) return;
    clearTabState(tabId);
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function rememberDelivery(tabId, patch) {
    deliveryStateByTab.set(tabId, { at: Date.now(), ...patch });
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), postTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function postMirrorPayload(tabId, mirrorUrl, payload) {
    const body = JSON.stringify(payload);
    let lastError = null;

    // Keep delivery bounded: small retry, no unbounded queue inside the service worker.
    for (let attempt = 1; attempt <= postAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(mirrorUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        });

        if (response.ok) {
          rememberDelivery(tabId, { ok: true, status: response.status });
          return true;
        }

        lastError = `HTTP ${response.status} ${response.statusText}`.trim();
      } catch (error) {
        lastError = error?.name === 'AbortError' ? 'timeout' : error?.message || String(error);
      }

      if (attempt < postAttempts) await sleep(postRetryDelayMs);
    }

    rememberDelivery(tabId, { ok: false, error: lastError || 'post_failed' });
    console.error(`[mirror Tab ${tabId}] local delivery failed:`, lastError);
    return false;
  }

  async function forwardFullTraffic(trafficData) {
    await postMirrorPayload(trafficData.tabId, trafficData.mirrorUrl, {
      siteId: trafficData.siteId,
      request: trafficData.request,
      response: trafficData.response,
      responseBody: trafficData.responseBody
    });
  }

  async function forwardWebSocketEvent(socketData, eventType, extra = {}) {
    await postMirrorPayload(socketData.tabId, socketData.mirrorUrl, {
      relayKind: 'websocket',
      eventType,
      siteId: socketData.siteId,
      siteLabel: socketData.siteLabel,
      websocket: {
        requestId: socketData.requestId,
        url: socketData.url,
        openedAt: socketData.openedAt,
        handshake: socketData.handshake,
        sentSeq: socketData.sentSeq,
        receivedSeq: socketData.receivedSeq
      },
      ...extra
    });
  }

  function ensureWebSocketData(tabId, requestId, url = null) {
    // WebSocket follow-up events may omit URL; reuse the socket record created earlier.
    if (trackedWebSockets.has(requestId)) {
      const current = trackedWebSockets.get(requestId);
      if (url && !current.url) current.url = url;
      return current;
    }

    const ctx = tabMirrorCtx.get(tabId);
    if (!ctx?.site) return null;

    if (url && !shouldTrackWebSocket(url, ctx.site)) return null;

    const next = {
      tabId,
      mirrorUrl: ctx.mirrorUrl,
      siteId: ctx.site.id,
      siteLabel: ctx.site.label,
      requestId,
      url: url || null,
      openedAt: new Date().toISOString(),
      handshake: {
        request: null,
        response: null
      },
      sentSeq: 0,
      receivedSeq: 0
    };
    trackedWebSockets.set(requestId, next);
    return next;
  }

  function normalizeWebSocketFrame(frame, direction, sequence) {
    const opcode = Number(frame?.opcode);
    const payloadData = frame?.payloadData ?? null;
    const isBinary = opcode === 2;
    const isText = opcode === 1;

    return {
      direction,
      sequence,
      opcode,
      opcodeName: webSocketOpcodeName(opcode),
      payloadEncoding: isBinary ? 'base64' : 'utf8',
      payloadData,
      payloadJson: isText ? tryParseJson(payloadData) : null,
      payloadSize: typeof payloadData === 'string' ? payloadData.length : null
    };
  }

  function webSocketOpcodeName(opcode) {
    switch (opcode) {
      case 0:
        return 'continuation';
      case 1:
        return 'text';
      case 2:
        return 'binary';
      case 8:
        return 'close';
      case 9:
        return 'ping';
      case 10:
        return 'pong';
      default:
        return 'unknown';
    }
  }

  function tryParseJson(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === 'null')) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!attachedTabs.has(tabId)) return;

    const ctx = tabMirrorCtx.get(tabId);
    if (!ctx?.site) return;

    switch (method) {
      case 'Network.requestWillBeSent': {
        // Track only matching requests; response body is available later at loadingFinished.
        const { requestId, request } = params;
        if (!shouldTrackRequest(request.url, ctx.site)) break;

        trackedRequests.set(requestId, {
          tabId,
          mirrorUrl: ctx.mirrorUrl,
          siteId: ctx.site.id,
          jsonResponsesOnly: !!ctx.site.jsonResponsesOnly,
          request,
          response: null,
          responseBody: null
        });
        break;
      }

      case 'Network.responseReceived': {
        const { requestId, response } = params;
        const trackedData = trackedRequests.get(requestId);
        if (!trackedData) break;
        if (trackedData.jsonResponsesOnly && !isJsonResponse(response)) {
          trackedRequests.delete(requestId);
          break;
        }
        trackedData.response = response;
        break;
      }

      case 'Network.loadingFinished': {
        // CDP response bodies are pulled on demand, then immediately released from tracking.
        const { requestId } = params;
        if (!trackedRequests.has(requestId)) break;

        chrome.debugger.sendCommand(
          { tabId },
          'Network.getResponseBody',
          { requestId },
          (bodyInfo) => {
            if (chrome.runtime.lastError) {
              trackedRequests.delete(requestId);
              return;
            }
            const trackedData = trackedRequests.get(requestId);
            if (!trackedData) return;
            if (trackedData.request && trackedData.response) {
              trackedData.responseBody = bodyInfo.body;
              forwardFullTraffic(trackedData);
            }
            trackedRequests.delete(requestId);
          }
        );
        break;
      }

      case 'Network.loadingFailed': {
        trackedRequests.delete(params.requestId);
        break;
      }

      case 'Network.webSocketCreated': {
        const socketData = ensureWebSocketData(tabId, params.requestId, params.url);
        if (!socketData) break;
        forwardWebSocketEvent(socketData, 'created');
        break;
      }

      case 'Network.webSocketWillSendHandshakeRequest': {
        const socketData = ensureWebSocketData(tabId, params.requestId, params.request?.url);
        if (!socketData) break;

        socketData.handshake.request = {
          timestamp: params.timestamp ?? null,
          wallTime: params.wallTime ?? null,
          headers: params.request?.headers || {}
        };
        forwardWebSocketEvent(socketData, 'handshake-request', {
          handshake: { request: socketData.handshake.request }
        });
        break;
      }

      case 'Network.webSocketHandshakeResponseReceived': {
        const socketData = ensureWebSocketData(tabId, params.requestId, params.response?.url);
        if (!socketData) break;

        socketData.handshake.response = {
          timestamp: params.timestamp ?? null,
          status: params.response?.status ?? null,
          statusText: params.response?.statusText ?? null,
          headers: params.response?.headers || {},
          headersText: params.response?.headersText ?? null
        };
        forwardWebSocketEvent(socketData, 'handshake-response', {
          handshake: { response: socketData.handshake.response }
        });
        break;
      }

      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived': {
        const socketData = ensureWebSocketData(tabId, params.requestId);
        if (!socketData) break;

        const direction = method === 'Network.webSocketFrameSent' ? 'sent' : 'received';
        if (direction === 'sent') socketData.sentSeq += 1;
        else socketData.receivedSeq += 1;

        forwardWebSocketEvent(socketData, 'frame', {
          frame: normalizeWebSocketFrame(
            params.response,
            direction,
            direction === 'sent' ? socketData.sentSeq : socketData.receivedSeq
          ),
          timestamp: params.timestamp ?? null
        });
        break;
      }

      case 'Network.webSocketFrameError': {
        const socketData = ensureWebSocketData(tabId, params.requestId);
        if (!socketData) break;

        forwardWebSocketEvent(socketData, 'frame-error', {
          timestamp: params.timestamp ?? null,
          errorMessage: params.errorMessage
        });
        break;
      }

      case 'Network.webSocketClosed': {
        const socketData = ensureWebSocketData(tabId, params.requestId);
        if (!socketData) break;

        forwardWebSocketEvent(socketData, 'closed', {
          timestamp: params.timestamp ?? null,
          closedAt: new Date().toISOString()
        });
        trackedWebSockets.delete(params.requestId);
        break;
      }
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (attachedTabs.has(tabId)) detachDebugger(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab?.url) return;
    // Navigating away from X should release the debugger attachment and cached traffic.
    if (!getSiteByUrl(tab.url)) {
      detachDebugger(tabId);
      return;
    }
    ensureTabMirror(tabId);
  });

  chrome.tabs.onActivated.addListener(() => {
    chrome.tabs.query(
      { active: true, currentWindow: true, url: getSiteUrlPatterns() },
      (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) ensureTabMirror(tabId);
      }
    );
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[MirrorSettings.STORAGE_KEY]) return;
    const nextCfg = MirrorSettings.normalize(changes[MirrorSettings.STORAGE_KEY].newValue);
    // Mirror enabled is global; turning it off stops every active tab.
    if (!isMirrorEnabled(nextCfg)) {
      for (const tabId of [...attachedTabs]) detachDebugger(tabId);
      return;
    }

    for (const ctx of tabMirrorCtx.values()) {
      ctx.mirrorUrl = nextCfg.mirrorUrl;
    }
    for (const tracked of trackedRequests.values()) {
      tracked.mirrorUrl = nextCfg.mirrorUrl;
    }
    for (const tracked of trackedWebSockets.values()) {
      tracked.mirrorUrl = nextCfg.mirrorUrl;
    }
    restoreEnabledMirrors();
  });

  function handleMessage(msg, sender, sendResponse) {
    switch (msg.action) {
      case 'GET_ACTIVE_TAB_STATUS':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (!activeTab?.id) {
            sendResponse({ tabId: null, isAttached: false, site: null });
            return;
          }
          const site = getSiteByUrl(activeTab.url || '');
          let hostname = '';
          try {
            hostname = new URL(activeTab.url || '').hostname;
          } catch {
            /* ignore */
          }
          Promise.all([hasDebuggerPermission(), MirrorSettings.load()]).then(([hasDebugger, cfg]) => {
            // Opening the popup doubles as a lightweight recovery path after worker wakeup.
            if (site && isMirrorEnabled(cfg)) ensureTabMirror(activeTab.id);
            sendResponse({
              ...buildTabStatus(activeTab.id, cfg, site),
              hostname,
              hasDebuggerPermission: hasDebugger
            });
          });
        });
        return true;

      case 'SET_MIRROR_ENABLED_ACTIVE_TAB':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTabId = tabs[0]?.id;
          if (!activeTabId) {
            sendResponse({ ok: false, isAttached: false });
            return;
          }
          persistMirrorEnabled(msg.enabled).then(() => {
            if (!msg.enabled) {
              detachDebugger(activeTabId);
              sendResponse({ ok: true, isAttached: false, mirrorEnabled: false });
              return;
            }
            enableMirrorOnTab(activeTabId, sendResponse);
          });
        });
        return true;

      default:
        return false;
    }
  }

  function initOnInstalled() {
    console.log('[mirror] loaded sites:', SITES.map((site) => site.id).join(', '));
    restoreEnabledMirrors();
  }

  return { handleMessage, initOnInstalled, restoreEnabledMirrors };
})();
