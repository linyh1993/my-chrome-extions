/**
 * @file 网络请求追踪器 (CDP Network Tracker)
 * 监听 CDP Network 域事件，按 requestId 关联请求、响应头与 Response Body，
 * 并将其封装为标准信封投递至本地服务。
 */
const NetworkTracker = (() => {
  const trackedRequests = new Map();

  function clearTab(tabId) {
    for (const [requestId, data] of trackedRequests.entries()) {
      if (data.tabId === tabId) {
        trackedRequests.delete(requestId);
      }
    }
  }

  function handleEvent(tabId, method, params, ctx) {
    switch (method) {
      case 'Network.requestWillBeSent':
        trackRequest(tabId, params, ctx);
        return true;
      case 'Network.responseReceived':
        trackResponse(params);
        return true;
      case 'Network.loadingFinished':
        pullAndForwardBody(tabId, params.requestId);
        return true;
      case 'Network.loadingFailed':
        trackedRequests.delete(params.requestId);
        return true;
      default:
        return false;
    }
  }

  function trackRequest(tabId, params, ctx) {
    const { requestId, request } = params;
    if (!SitesRegistry.shouldTrackRequest(request.url, ctx.site)) return;

    trackedRequests.set(requestId, {
      tabId,
      endpointUrl: ctx.endpointUrl,
      site: ctx.site,
      sourceUrl: ctx.sourceUrl,
      request,
      response: null,
      startedAt: Date.now()
    });
  }

  function trackResponse(params) {
    const tracked = trackedRequests.get(params.requestId);
    if (!tracked) return;

    if (tracked.site?.network?.jsonOnly && !SitesRegistry.isJsonResponse(params.response)) {
      trackedRequests.delete(params.requestId);
      return;
    }
    tracked.response = params.response;
  }

  async function pullAndForwardBody(tabId, requestId) {
    const tracked = trackedRequests.get(requestId);
    if (!tracked) return;

    const bodyResult = await DebuggerSession.getResponseBody(tabId, requestId);
    trackedRequests.delete(requestId);

    if (!tracked.request || !tracked.response) return;

    let responseJson = null;
    if (bodyResult.ok && bodyResult.body) {
      try {
        responseJson = JSON.parse(bodyResult.body);
      } catch {
        responseJson = null;
      }
    }

    const envelope = RelayProtocol.createEnvelope({
      siteId: tracked.site.id,
      siteLabel: tracked.site.label,
      channel: RelayProtocol.CHANNELS.NETWORK_HTTP,
      action: 'network_response',
      sourceUrl: tracked.sourceUrl || tracked.request.url,
      payload: {
        request: {
          url: tracked.request.url,
          method: tracked.request.method,
          headers: tracked.request.headers,
          postData: tracked.request.postData || null
        },
        response: {
          status: tracked.response.status,
          statusText: tracked.response.statusText,
          mimeType: tracked.response.mimeType,
          headers: tracked.response.headers
        },
        body: bodyResult.body || '',
        json: responseJson,
        base64Encoded: bodyResult.base64Encoded || false
      },
      metadata: {
        tabId,
        durationMs: Date.now() - tracked.startedAt
      }
    });

    HttpRelay.postEnvelope(tracked.endpointUrl, envelope);
  }

  return {
    clearTab,
    handleEvent
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NetworkTracker;
}
