/** @file Mirror debugger + Network relay logic for the service worker. */
const MirrorBg = (() => {
  const attachedTabs = new Set();
  const tabMirrorCtx = new Map();
  const trackedRequests = new Map();
  const trackedWebSockets = new Map();
  const debuggerVersion = '1.3';

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

  function ensureTabMirror(tabId) {
    if (!tabId || attachedTabs.has(tabId)) return;
    MirrorSettings.load().then((cfg) => {
      if (!isMirrorEnabled(cfg)) return;
      resolveSiteForTab(tabId, (site) => {
        if (site) attachDebugger(tabId, cfg, site);
      });
    });
  }

  function restoreEnabledMirrors() {
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

  function tabMirrorState(tabId, sendResponse) {
    MirrorSettings.load().then((cfg) => {
      const mirrorEnabled = isMirrorEnabled(cfg);
      if (!tabId) {
        sendResponse?.({ mirrorEnabled, isAttached: false, siteLabel: null });
        return;
      }
      resolveSiteForTab(tabId, (site) => {
        sendResponse?.({
          mirrorEnabled,
          isAttached: attachedTabs.has(tabId),
          siteLabel: site?.label ?? null
        });
      });
    });
  }

  function enableMirrorOnTab(tabId, sendResponse) {
    ensureDebuggerPermission().then((granted) => {
      if (!granted) {
        updatePageStatus(tabId, false);
        sendResponse?.({
          ok: false,
          isAttached: false,
          permissionDenied: true
        });
        return;
      }

      MirrorSettings.load().then((cfg) => {
        if (!isMirrorEnabled(cfg)) {
          sendResponse?.({ ok: true, isAttached: false, mirrorEnabled: false });
          return;
        }

        if (!attachedTabs.has(tabId)) {
          attachDebugger(tabId, cfg);
        } else {
          const ctx = tabMirrorCtx.get(tabId);
          if (ctx) ctx.mirrorUrl = cfg.mirrorUrl || ctx.mirrorUrl;
          updatePageStatus(tabId, true, ctx?.site || null);
        }

        sendResponse?.({
          ok: true,
          isAttached: attachedTabs.has(tabId) || granted
        });
      });
    });
  }

  function resolveSiteForTab(tabId, callback) {
    if (!tabId) {
      callback(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.url) {
        callback(null);
        return;
      }
      callback(getSiteByUrl(tab.url));
    });
  }

  function updatePageStatus(tabId, isAttached, site = null) {
    MirrorSettings.load().then((cfg) => {
      const payload = {
        domain: 'mirror',
        action: 'UPDATE_STATUS',
        status: isAttached,
        mirrorEnabled: isMirrorEnabled(cfg),
        siteLabel: site?.label ?? null,
        siteId: site?.id ?? null
      };

      chrome.tabs.sendMessage(tabId, payload, () => {
        if (chrome.runtime.lastError) {
          /* content not ready */
        }
      });

      chrome.runtime.sendMessage(payload).catch(() => {
        /* side panel not open */
      });
    });
  }

  function attachDebugger(tabId, cfg, resolvedSite = null) {
    const attachSite = (site) => {
      if (!site) {
        updatePageStatus(tabId, false);
        return;
      }

      const ctx = createMirrorCtx(site, cfg);
      tabMirrorCtx.set(tabId, ctx);
      console.log(`[mirror Tab ${tabId}] attach debugger (${site.label})...`);

      chrome.debugger.attach({ tabId }, debuggerVersion, () => {
        if (chrome.runtime.lastError) {
          console.error(`[mirror Tab ${tabId}] attach failed:`, chrome.runtime.lastError.message);
          tabMirrorCtx.delete(tabId);
          updatePageStatus(tabId, false);
          return;
        }

        chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
          if (chrome.runtime.lastError) {
            console.error(
              `[mirror Tab ${tabId}] Network.enable failed:`,
              chrome.runtime.lastError.message
            );
            detachDebugger(tabId);
            return;
          }
          attachedTabs.add(tabId);
          updatePageStatus(tabId, true, site);
        });
      });
    };

    if (resolvedSite) {
      attachSite(resolvedSite);
      return;
    }

    resolveSiteForTab(tabId, attachSite);
  }

  function clearTabState(tabId) {
    attachedTabs.delete(tabId);
    tabMirrorCtx.delete(tabId);

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
      updatePageStatus(tabId, false);
      return;
    }

    const finish = () => {
      clearTabState(tabId);
      updatePageStatus(tabId, false);
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
    updatePageStatus(tabId, false);
  });

  async function postMirrorPayload(tabId, mirrorUrl, payload) {
    try {
      const response = await fetch(mirrorUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error(`[mirror Tab ${tabId}] local endpoint:`, response.status, response.statusText);
      }
    } catch (error) {
      console.error(`[mirror Tab ${tabId}] local request failed:`, error.message);
    }
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
    if (trackedWebSockets.has(requestId)) {
      const current = trackedWebSockets.get(requestId);
      if (url && !current.url) current.url = url;
      return current;
    }

    const ctx = tabMirrorCtx.get(tabId);
    if (!ctx?.site) return null;

    if (!shouldTrackWebSocket(url || '', ctx.site)) return null;

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

      case 'Network.webSocketCreated': {
        const socketData = ensureWebSocketData(tabId, params.requestId, params.url);
        if (!socketData) break;
        forwardWebSocketEvent(socketData, 'created');
        break;
      }

      case 'Network.webSocketWillSendHandshakeRequest': {
        const socketData = ensureWebSocketData(tabId, params.requestId);
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
        const socketData = ensureWebSocketData(tabId, params.requestId);
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
    if (!getSiteByUrl(tab.url)) return;
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
    for (const ctx of tabMirrorCtx.values()) {
      ctx.mirrorUrl = nextCfg.mirrorUrl;
    }
    for (const tracked of trackedRequests.values()) {
      tracked.mirrorUrl = nextCfg.mirrorUrl;
    }
    for (const tracked of trackedWebSockets.values()) {
      tracked.mirrorUrl = nextCfg.mirrorUrl;
    }
  });

  function handleMessage(msg, sender, sendResponse) {
    const tabId = sender.tab?.id;

    switch (msg.action) {
      case 'HAS_DEBUGGER_PERMISSION':
        hasDebuggerPermission().then((granted) => {
          sendResponse({ granted });
        });
        return true;

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
          Promise.all([hasDebuggerPermission(), MirrorSettings.load()]).then(
            ([hasDebugger, cfg]) => {
              sendResponse({
                tabId: activeTab.id,
                hostname,
                isAttached: attachedTabs.has(activeTab.id),
                mirrorEnabled: isMirrorEnabled(cfg),
                site: tabMirrorCtx.get(activeTab.id)?.site || site,
                hasDebuggerPermission: hasDebugger
              });
            }
          );
        });
        return true;

      case 'GET_TAB_MIRROR_STATE':
        tabMirrorState(tabId, sendResponse);
        return true;

      case 'ENSURE_TAB_MIRROR':
        if (tabId) ensureTabMirror(tabId);
        tabMirrorState(tabId, sendResponse);
        return true;

      case 'SET_MIRROR_ENABLED':
        if (!tabId) {
          sendResponse({ ok: false, isAttached: false });
          return true;
        }
        persistMirrorEnabled(msg.enabled).then(() => {
          if (!msg.enabled) {
            detachDebugger(tabId);
            sendResponse({ ok: true, isAttached: false, mirrorEnabled: false });
            return;
          }
          enableMirrorOnTab(tabId, (res) => {
            sendResponse?.({ ...res, mirrorEnabled: true });
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
            enableMirrorOnTab(activeTabId, (res) => {
              sendResponse?.({ ...res, mirrorEnabled: true });
            });
          });
        });
        return true;

      case 'TOGGLE_DEBUGGER_ACTIVE_TAB':
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTabId = tabs[0]?.id;
          if (!activeTabId) return;
          if (attachedTabs.has(activeTabId)) detachDebugger(activeTabId);
          else enableMirrorOnTab(activeTabId);
        });
        return true;

      case 'GET_STATUS':
        sendResponse({ isAttached: tabId ? attachedTabs.has(tabId) : false });
        return true;

      case 'SYNC_STATUS':
        if (tabId) {
          MirrorSettings.load().then((cfg) => {
            if (isMirrorEnabled(cfg)) ensureTabMirror(tabId);
            updatePageStatus(tabId, attachedTabs.has(tabId), tabMirrorCtx.get(tabId)?.site || null);
          });
        }
        return true;

      case 'TOGGLE_DEBUGGER':
        if (!tabId) return true;
        if (attachedTabs.has(tabId)) detachDebugger(tabId);
        else enableMirrorOnTab(tabId);
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
