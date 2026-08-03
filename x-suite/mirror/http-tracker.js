/** @file GraphQL request tracking from CDP Network events. */
const MirrorHttpTracker = (() => {
  const trackedRequests = new Map();

  function clearTab(tabId) {
    for (const [requestId, data] of trackedRequests.entries()) {
      if (data.tabId === tabId) trackedRequests.delete(requestId);
    }
  }

  function updateMirrorUrl(mirrorUrl) {
    for (const tracked of trackedRequests.values()) {
      tracked.mirrorUrl = mirrorUrl;
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
    if (!shouldTrackRequest(request.url, ctx.site)) return;

    // Response body is only available later at loadingFinished.
    trackedRequests.set(requestId, {
      tabId,
      mirrorUrl: ctx.mirrorUrl,
      siteId: ctx.site.id,
      jsonResponsesOnly: !!ctx.site.jsonResponsesOnly,
      request,
      response: null
    });
  }

  function trackResponse(params) {
    const trackedData = trackedRequests.get(params.requestId);
    if (!trackedData) return;

    if (trackedData.jsonResponsesOnly && !isJsonResponse(params.response)) {
      trackedRequests.delete(params.requestId);
      return;
    }
    trackedData.response = params.response;
  }

  function pullAndForwardBody(tabId, requestId) {
    if (!trackedRequests.has(requestId)) return;

    // CDP response bodies are pulled on demand, then immediately released.
    chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }, (bodyInfo) => {
      if (chrome.runtime.lastError) {
        trackedRequests.delete(requestId);
        return;
      }

      const trackedData = trackedRequests.get(requestId);
      if (trackedData?.request && trackedData.response) {
        MirrorHttpRelay.post(trackedData.tabId, trackedData.mirrorUrl, {
          siteId: trackedData.siteId,
          request: trackedData.request,
          response: trackedData.response,
          responseBody: bodyInfo.body
        });
      }
      trackedRequests.delete(requestId);
    });
  }

  return { clearTab, handleEvent, updateMirrorUrl };
})();
