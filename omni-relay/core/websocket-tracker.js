/**
 * @file WebSocket 流量追踪器 (CDP WebSocket Tracker)
 * 监听并跟踪各平台的 WebSocket / WSS 连接生命周期及双向数据帧（Text/Binary）。
 */
const WebSocketTracker = (() => {
  const trackedSockets = new Map();

  function clearTab(tabId) {
    for (const [requestId, data] of trackedSockets.entries()) {
      if (data.tabId === tabId) {
        trackedSockets.delete(requestId);
      }
    }
  }

  function handleEvent(tabId, method, params, ctx) {
    switch (method) {
      case 'Network.webSocketCreated':
        onCreated(tabId, params, ctx);
        return true;
      case 'Network.webSocketWillSendHandshakeRequest':
        onHandshakeRequest(params);
        return true;
      case 'Network.webSocketHandshakeResponseReceived':
        onHandshakeResponse(params);
        return true;
      case 'Network.webSocketFrameSent':
        onFrame(tabId, params, 'sent', ctx);
        return true;
      case 'Network.webSocketFrameReceived':
        onFrame(tabId, params, 'received', ctx);
        return true;
      case 'Network.webSocketClosed':
        onClosed(tabId, params, ctx);
        return true;
      default:
        return false;
    }
  }

  function onCreated(tabId, params, ctx) {
    const { requestId, url } = params;
    if (!SitesRegistry.shouldTrackWebSocket(url, ctx.site)) return;

    trackedSockets.set(requestId, {
      tabId,
      endpointUrl: ctx.endpointUrl,
      site: ctx.site,
      url,
      openedAt: new Date().toISOString(),
      handshake: { request: null, response: null }
    });
  }

  function onHandshakeRequest(params) {
    const sock = trackedSockets.get(params.requestId);
    if (!sock) return;
    sock.handshake.request = params.request;
  }

  function onHandshakeResponse(params) {
    const sock = trackedSockets.get(params.requestId);
    if (!sock) return;
    sock.handshake.response = params.response;
  }

  function onFrame(tabId, params, direction, ctx) {
    const sock = trackedSockets.get(params.requestId);
    if (!sock) return;

    const frameData = params.response?.payloadData || '';
    let frameJson = null;
    try {
      frameJson = JSON.parse(frameData);
    } catch {
      frameJson = null;
    }

    const envelope = RelayProtocol.createEnvelope({
      siteId: sock.site.id,
      siteLabel: sock.site.label,
      channel: RelayProtocol.CHANNELS.NETWORK_WS,
      action: 'ws_frame',
      sourceUrl: ctx.sourceUrl || sock.url,
      payload: {
        direction,
        wsUrl: sock.url,
        opcode: params.response?.opcode,
        data: frameData,
        json: frameJson
      },
      metadata: {
        tabId,
        requestId: params.requestId
      }
    });

    HttpRelay.postEnvelope(sock.endpointUrl, envelope);
  }

  function onClosed(tabId, params, ctx) {
    const sock = trackedSockets.get(params.requestId);
    if (!sock) return;

    const envelope = RelayProtocol.createEnvelope({
      siteId: sock.site.id,
      siteLabel: sock.site.label,
      channel: RelayProtocol.CHANNELS.NETWORK_WS,
      action: 'ws_closed',
      sourceUrl: ctx.sourceUrl || sock.url,
      payload: {
        wsUrl: sock.url,
        timestamp: params.timestamp
      },
      metadata: { tabId, requestId: params.requestId }
    });

    HttpRelay.postEnvelope(sock.endpointUrl, envelope);
    trackedSockets.delete(params.requestId);
  }

  return {
    clearTab,
    handleEvent
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketTracker;
}
