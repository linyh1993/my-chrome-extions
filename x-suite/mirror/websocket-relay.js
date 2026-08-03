/** @file WebSocket CDP event tracking and payload shaping. */
const MirrorWebSocketRelay = (() => {
  const trackedWebSockets = new Map();

  function clearTab(tabId) {
    for (const [requestId, data] of trackedWebSockets.entries()) {
      if (data.tabId === tabId) trackedWebSockets.delete(requestId);
    }
  }

  function updateMirrorUrl(mirrorUrl) {
    for (const tracked of trackedWebSockets.values()) {
      tracked.mirrorUrl = mirrorUrl;
    }
  }

  function ensureSocket(tabId, requestId, url, ctx) {
    if (trackedWebSockets.has(requestId)) {
      const current = trackedWebSockets.get(requestId);
      if (url && !current.url) current.url = url;
      return current;
    }

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
      handshake: { request: null, response: null },
      sentSeq: 0,
      receivedSeq: 0
    };
    trackedWebSockets.set(requestId, next);
    return next;
  }

  async function forward(socketData, eventType, extra = {}) {
    await MirrorHttpRelay.post(socketData.tabId, socketData.mirrorUrl, {
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

  function normalizeFrame(frame, direction, sequence) {
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

  function handleEvent(tabId, method, params, ctx) {
    switch (method) {
      case 'Network.webSocketCreated': {
        const socketData = ensureSocket(tabId, params.requestId, params.url, ctx);
        if (socketData) forward(socketData, 'created');
        return true;
      }
      case 'Network.webSocketWillSendHandshakeRequest': {
        const socketData = ensureSocket(tabId, params.requestId, params.request?.url, ctx);
        if (!socketData) return true;
        socketData.handshake.request = {
          timestamp: params.timestamp ?? null,
          wallTime: params.wallTime ?? null,
          headers: params.request?.headers || {}
        };
        forward(socketData, 'handshake-request', {
          handshake: { request: socketData.handshake.request }
        });
        return true;
      }
      case 'Network.webSocketHandshakeResponseReceived': {
        const socketData = ensureSocket(tabId, params.requestId, params.response?.url, ctx);
        if (!socketData) return true;
        socketData.handshake.response = {
          timestamp: params.timestamp ?? null,
          status: params.response?.status ?? null,
          statusText: params.response?.statusText ?? null,
          headers: params.response?.headers || {},
          headersText: params.response?.headersText ?? null
        };
        forward(socketData, 'handshake-response', {
          handshake: { response: socketData.handshake.response }
        });
        return true;
      }
      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived': {
        const socketData = ensureSocket(tabId, params.requestId, null, ctx);
        if (!socketData) return true;
        const direction = method === 'Network.webSocketFrameSent' ? 'sent' : 'received';
        if (direction === 'sent') socketData.sentSeq += 1;
        else socketData.receivedSeq += 1;
        forward(socketData, 'frame', {
          frame: normalizeFrame(
            params.response,
            direction,
            direction === 'sent' ? socketData.sentSeq : socketData.receivedSeq
          ),
          timestamp: params.timestamp ?? null
        });
        return true;
      }
      case 'Network.webSocketFrameError': {
        const socketData = ensureSocket(tabId, params.requestId, null, ctx);
        if (socketData) {
          forward(socketData, 'frame-error', {
            timestamp: params.timestamp ?? null,
            errorMessage: params.errorMessage
          });
        }
        return true;
      }
      case 'Network.webSocketClosed': {
        const socketData = ensureSocket(tabId, params.requestId, null, ctx);
        if (socketData) {
          forward(socketData, 'closed', {
            timestamp: params.timestamp ?? null,
            closedAt: new Date().toISOString()
          });
          trackedWebSockets.delete(params.requestId);
        }
        return true;
      }
      default:
        return false;
    }
  }

  return { clearTab, handleEvent, updateMirrorUrl };
})();
