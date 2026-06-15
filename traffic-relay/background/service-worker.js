importScripts('../shared/config.js', '../shared/filters.js');

console.log('流量复刻 service worker 已启动');

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

const attachedTabs = new Set();
const tabContext = new Map();
const debuggerVersion = '1.3';
const trackedRequests = new Map();
const trackedWebSockets = new Map();

function resolveTabContext(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) {
      console.error(`[Tab ${tabId}] 无法获取 URL:`, chrome.runtime.lastError?.message);
      callback(null);
      return;
    }
    const page = parseHttpPage(tab.url);
    if (!page) {
      console.warn(`[Tab ${tabId}] 非 HTTP(S) 页面:`, tab.url);
      callback(null);
      return;
    }
    RelayConfig.load((config) => {
      const site = RelayConfig.findSiteByHostname(page.hostname, config);
      if (!site) {
        console.warn(`[Tab ${tabId}] 未匹配已配置站点:`, page.hostname);
        callback(null);
        return;
      }
      callback({
        hostname: page.hostname,
        site,
        mirrorUrl: config.mirrorUrl
      });
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (request.command) {
    case 'GET_ACTIVE_TAB_STATUS':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) {
          sendResponse({ tabId: null, hostname: null, site: null, isAttached: false, config: null });
          return;
        }
        RelayConfig.load((config) => {
          const page = parseHttpPage(activeTab.url || '');
          const site = page ? RelayConfig.findSiteByHostname(page.hostname, config) : null;
          sendResponse({
            tabId: activeTab.id,
            hostname: page?.hostname || '',
            site,
            isAttached: attachedTabs.has(activeTab.id),
            config
          });
        });
      });
      return true;

    case 'TOGGLE_DEBUGGER_ACTIVE_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTabId = tabs[0]?.id;
        if (!activeTabId) return;
        if (attachedTabs.has(activeTabId)) detachDebugger(activeTabId);
        else attachDebugger(activeTabId);
      });
      return true;
  }

  if (!tabId) {
    console.warn('收到的消息没有 tabId:', request.command);
    return true;
  }

  switch (request.command) {
    case 'TOGGLE_DEBUGGER':
      if (attachedTabs.has(tabId)) detachDebugger(tabId);
      else attachDebugger(tabId);
      break;

    case 'INIT_AND_ATTACH':
      if (!attachedTabs.has(tabId)) attachDebugger(tabId);
      else updatePageStatus(tabId, true, tabContext.get(tabId));
      break;

    case 'GET_STATUS':
      sendResponse({ isAttached: attachedTabs.has(tabId) });
      break;
  }

  return true;
});

function attachDebugger(tabId) {
  resolveTabContext(tabId, (ctx) => {
    if (!ctx) {
      updatePageStatus(tabId, false);
      return;
    }

    tabContext.set(tabId, ctx);
    console.log(`[Tab ${tabId}] ${ctx.site.label} (${ctx.hostname})，正在附加调试器...`);

    chrome.debugger.attach({ tabId }, debuggerVersion, () => {
      if (chrome.runtime.lastError) {
        console.error(`[Tab ${tabId}] 附加失败:`, chrome.runtime.lastError.message);
        tabContext.delete(tabId);
        updatePageStatus(tabId, false);
        return;
      }
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
        if (chrome.runtime.lastError) {
          console.error(`[Tab ${tabId}] Network.enable 失败:`, chrome.runtime.lastError.message);
          detachDebugger(tabId);
        } else {
          attachedTabs.add(tabId);
          updatePageStatus(tabId, true, ctx);
        }
      });
    });
  });
}

function detachDebugger(tabId) {
  chrome.debugger.detach({ tabId }, () => {
    attachedTabs.delete(tabId);
    tabContext.delete(tabId);
    for (const [requestId, data] of trackedRequests.entries()) {
      if (data.tabId === tabId) trackedRequests.delete(requestId);
    }
    for (const [requestId, data] of trackedWebSockets.entries()) {
      if (data.tabId === tabId) trackedWebSockets.delete(requestId);
    }
    updatePageStatus(tabId, false);
  });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!attachedTabs.has(tabId)) return;

  const ctx = tabContext.get(tabId);
  if (!ctx) return;

  switch (method) {
    case 'Network.requestWillBeSent': {
      const { requestId, request } = params;
      if (!shouldTrackRequest(request.url, request.method, ctx.site)) break;

      trackedRequests.set(requestId, {
        tabId,
        siteId: ctx.site.id,
        siteLabel: ctx.site.label,
        mirrorUrl: ctx.mirrorUrl,
        request,
        response: null,
        responseBody: null
      });
      console.log(`[${requestId}] [${ctx.site.id}] ${request.method} ${request.url}`);
      break;
    }

    case 'Network.responseReceived': {
      const { requestId, response } = params;
      const tracked = trackedRequests.get(requestId);
      if (!tracked) break;

      if (!isJsonResponse(response)) {
        trackedRequests.delete(requestId);
        break;
      }
      tracked.response = response;
      break;
    }

    case 'Network.loadingFinished': {
      const { requestId } = params;
      if (!trackedRequests.has(requestId)) break;

      chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }, (bodyInfo) => {
        if (chrome.runtime.lastError) {
          trackedRequests.delete(requestId);
          return;
        }
        const tracked = trackedRequests.get(requestId);
        if (!tracked?.request || !tracked.response) {
          trackedRequests.delete(requestId);
          return;
        }
        tracked.responseBody = bodyInfo.body;
        forwardTraffic(tracked);
        trackedRequests.delete(requestId);
      });
      break;
    }

    case 'Network.webSocketCreated': {
      const { requestId, url } = params;
      if (!shouldTrackWebSocket(url, ctx.site)) break;

      trackedWebSockets.set(requestId, {
        tabId,
        siteId: ctx.site.id,
        siteLabel: ctx.site.label,
        mirrorUrl: ctx.mirrorUrl,
        page: { hostname: ctx.hostname },
        requestId,
        url,
        openedAt: new Date().toISOString(),
        handshake: {
          request: null,
          response: null
        },
        sentSeq: 0,
        receivedSeq: 0
      });
      forwardWebSocketEvent(trackedWebSockets.get(requestId), 'created');
      break;
    }

    case 'Network.webSocketWillSendHandshakeRequest': {
      const tracked = trackedWebSockets.get(params.requestId);
      if (!tracked) break;

      tracked.handshake.request = {
        timestamp: params.timestamp ?? null,
        wallTime: params.wallTime ?? null,
        headers: params.request?.headers || {}
      };
      forwardWebSocketEvent(tracked, 'handshake-request', {
        handshake: { request: tracked.handshake.request }
      });
      break;
    }

    case 'Network.webSocketHandshakeResponseReceived': {
      const tracked = trackedWebSockets.get(params.requestId);
      if (!tracked) break;

      tracked.handshake.response = {
        timestamp: params.timestamp ?? null,
        status: params.response?.status ?? null,
        statusText: params.response?.statusText ?? null,
        headers: params.response?.headers || {},
        headersText: params.response?.headersText ?? null
      };
      forwardWebSocketEvent(tracked, 'handshake-response', {
        handshake: { response: tracked.handshake.response }
      });
      break;
    }

    case 'Network.webSocketFrameSent':
    case 'Network.webSocketFrameReceived': {
      const tracked = trackedWebSockets.get(params.requestId);
      if (!tracked) break;

      const direction = method === 'Network.webSocketFrameSent' ? 'sent' : 'received';
      if (direction === 'sent') tracked.sentSeq += 1;
      else tracked.receivedSeq += 1;

      forwardWebSocketEvent(tracked, 'frame', {
        frame: normalizeWebSocketFrame(
          params.response,
          direction,
          direction === 'sent' ? tracked.sentSeq : tracked.receivedSeq
        ),
        timestamp: params.timestamp ?? null
      });
      break;
    }

    case 'Network.webSocketFrameError': {
      const tracked = trackedWebSockets.get(params.requestId);
      if (!tracked) break;

      forwardWebSocketEvent(tracked, 'frame-error', {
        timestamp: params.timestamp ?? null,
        errorMessage: params.errorMessage
      });
      break;
    }

    case 'Network.webSocketClosed': {
      const tracked = trackedWebSockets.get(params.requestId);
      if (!tracked) break;

      forwardWebSocketEvent(tracked, 'closed', {
        timestamp: params.timestamp ?? null,
        closedAt: new Date().toISOString()
      });
      trackedWebSockets.delete(params.requestId);
      break;
    }
  }
});

async function forwardTraffic(tracked) {
  const payload = {
    siteId: tracked.siteId,
    siteLabel: tracked.siteLabel,
    request: tracked.request,
    response: tracked.response,
    responseBody: tracked.responseBody
  };

  await postMirrorPayload(tracked.mirrorUrl, tracked.tabId, payload);
}

async function forwardWebSocketEvent(tracked, eventType, extra = {}) {
  const payload = {
    relayKind: 'websocket',
    eventType,
    siteId: tracked.siteId,
    siteLabel: tracked.siteLabel,
    page: tracked.page,
    websocket: {
      requestId: tracked.requestId,
      url: tracked.url,
      openedAt: tracked.openedAt,
      handshake: tracked.handshake,
      sentSeq: tracked.sentSeq,
      receivedSeq: tracked.receivedSeq
    },
    ...extra
  };

  await postMirrorPayload(tracked.mirrorUrl, tracked.tabId, payload);
}

async function postMirrorPayload(mirrorUrl, tabId, payload) {
  try {
    const response = await fetch(mirrorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error(`[Tab ${tabId}] 本地接口 ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`[Tab ${tabId}] 转发失败:`, error.message);
  }
}

function updatePageStatus(tabId, isAttached, ctx = null) {
  const payload = {
    command: 'UPDATE_STATUS',
    status: isAttached,
    siteLabel: ctx?.site?.label ?? null,
    siteId: ctx?.site?.id ?? null,
    hostname: ctx?.hostname ?? null
  };

  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime.lastError) { /* 页面未就绪 */ }
  });
  chrome.runtime.sendMessage(payload).catch(() => { /* 侧边栏未打开 */ });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.has(tabId)) detachDebugger(tabId);
});

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
