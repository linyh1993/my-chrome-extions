/**
 * @file Chrome DevTools Protocol 捕获引擎 (CDP Engine)
 * 高内聚管理 Tab 调试器挂载、网络 HTTP 请求/响应体提取与 WebSocket 实时数据帧监听。
 */

import { shouldTrackRequest, shouldTrackWebSocket } from './sites.js';
import { createEnvelope, sendEnvelope } from './relay-client.js';

const DEBUGGER_VERSION = '1.3';

export class CdpEngine {
  constructor() {
    this.attachedTabs = new Set();
    this.attachingTabs = new Map();
    this.tabContexts = new Map(); // tabId -> { site, endpointUrl, sourceUrl }
    this.tabErrors = new Map();    // tabId -> { error, debuggerBusy }
    this.trackedRequests = new Map(); // requestId -> { tabId, site, endpointUrl, sourceUrl, request, response }
    this.trackedSockets = new Map();  // requestId -> { tabId, site, endpointUrl, url }
  }

  isAttached(tabId) {
    return this.attachedTabs.has(tabId);
  }

  isAttaching(tabId) {
    return this.attachingTabs.has(tabId);
  }

  getTabError(tabId) {
    return this.tabErrors.get(tabId) || null;
  }

  async attach(tabId, site, endpointUrl, sourceUrl) {
    if (this.attachedTabs.has(tabId)) return { ok: true, isAttached: true };
    if (this.attachingTabs.has(tabId)) return this.attachingTabs.get(tabId);

    const task = (async () => {
      this.tabErrors.delete(tabId);
      this.tabContexts.set(tabId, { site, endpointUrl, sourceUrl });

      const attachResult = await this._rawAttach(tabId);
      if (!attachResult.ok) {
        this.tabContexts.delete(tabId);
        this.tabErrors.set(tabId, attachResult);
        return attachResult;
      }

      const netResult = await this._sendCommand(tabId, 'Network.enable');
      if (!netResult.ok) {
        await this.detach(tabId);
        this.tabErrors.set(tabId, netResult);
        return netResult;
      }

      this.attachedTabs.add(tabId);
      this.tabErrors.delete(tabId);
      return { ok: true, isAttached: true, site };
    })().finally(() => {
      this.attachingTabs.delete(tabId);
    });

    this.attachingTabs.set(tabId, task);
    return task;
  }

  async detach(tabId) {
    this.attachedTabs.delete(tabId);
    this.attachingTabs.delete(tabId);
    this.tabContexts.delete(tabId);
    this.tabErrors.delete(tabId);
    this._clearTabRequests(tabId);

    try {
      await this._sendCommand(tabId, 'Network.disable');
      await new Promise((resolve) => chrome.debugger.detach({ tabId }, resolve));
    } catch {
      // 忽略已关闭或已分离产生的错误
    }
  }

  updateTabConfig(endpointUrl) {
    for (const ctx of this.tabContexts.values()) {
      ctx.endpointUrl = endpointUrl;
    }
  }

  handleEvent(tabId, method, params) {
    if (!this.attachedTabs.has(tabId)) return;
    const ctx = this.tabContexts.get(tabId);
    if (!ctx) return;

    switch (method) {
      case 'Network.requestWillBeSent':
        if (shouldTrackRequest(params.request.url, ctx.site)) {
          this.trackedRequests.set(params.requestId, {
            tabId,
            site: ctx.site,
            endpointUrl: ctx.endpointUrl,
            sourceUrl: ctx.sourceUrl || params.request.url,
            request: params.request,
            response: null
          });
        }
        break;

      case 'Network.responseReceived': {
        const tracked = this.trackedRequests.get(params.requestId);
        if (tracked) tracked.response = params.response;
        break;
      }

      case 'Network.loadingFinished':
        this._pullAndRelayBody(tabId, params.requestId);
        break;

      case 'Network.loadingFailed':
        this.trackedRequests.delete(params.requestId);
        break;

      case 'Network.webSocketCreated':
        if (shouldTrackWebSocket(params.url, ctx.site)) {
          this.trackedSockets.set(params.requestId, {
            tabId,
            site: ctx.site,
            endpointUrl: ctx.endpointUrl,
            url: params.url
          });
        }
        break;

      case 'Network.webSocketFrameReceived':
      case 'Network.webSocketFrameSent': {
        const sock = this.trackedSockets.get(params.requestId);
        if (sock) {
          const isSent = method.endsWith('Sent');
          const payloadData = params.response?.payloadData || '';
          let payloadJson = null;
          try {
            payloadJson = JSON.parse(payloadData);
          } catch {
            payloadJson = null;
          }

          const envelope = createEnvelope({
            siteId: sock.site.id,
            siteLabel: sock.site.label,
            channel: 'network_ws',
            action: isSent ? 'ws_frame_sent' : 'ws_frame_received',
            sourceUrl: sock.url,
            payload: {
              direction: isSent ? 'sent' : 'received',
              wsUrl: sock.url,
              data: payloadData,
              json: payloadJson
            }
          });
          sendEnvelope(sock.endpointUrl, envelope);
        }
        break;
      }

      case 'Network.webSocketClosed':
        this.trackedSockets.delete(params.requestId);
        break;
    }
  }

  async _pullAndRelayBody(tabId, requestId) {
    const tracked = this.trackedRequests.get(requestId);
    if (!tracked || !tracked.response) {
      this.trackedRequests.delete(requestId);
      return;
    }

    this.trackedRequests.delete(requestId);

    const bodyRes = await this._sendCommand(tabId, 'Network.getResponseBody', { requestId });
    const rawBody = bodyRes.body || '';
    let jsonBody = null;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      jsonBody = null;
    }

    const envelope = createEnvelope({
      siteId: tracked.site.id,
      siteLabel: tracked.site.label,
      channel: 'network_http',
      action: 'network_response',
      sourceUrl: tracked.sourceUrl,
      payload: {
        request: {
          url: tracked.request.url,
          method: tracked.request.method,
          postData: tracked.request.postData || null
        },
        response: {
          status: tracked.response.status,
          mimeType: tracked.response.mimeType,
          headers: tracked.response.headers
        },
        body: rawBody,
        json: jsonBody
      }
    });

    sendEnvelope(tracked.endpointUrl, envelope);
  }

  _clearTabRequests(tabId) {
    for (const [id, item] of this.trackedRequests.entries()) {
      if (item.tabId === tabId) this.trackedRequests.delete(id);
    }
    for (const [id, item] of this.trackedSockets.entries()) {
      if (item.tabId === tabId) this.trackedSockets.delete(id);
    }
  }

  _rawAttach(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.attach({ tabId }, DEBUGGER_VERSION, () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          const isBusy = /another debugger|already attached|debugger.*use|DevTools/i.test(msg);
          resolve({
            ok: false,
            isAttached: false,
            debuggerBusy: isBusy,
            error: isBusy ? 'DevTools 或其他扩展已占用调试器' : msg
          });
          return;
        }
        resolve({ ok: true, isAttached: true });
      });
    });
  }

  _sendCommand(tabId, command, params = {}) {
    return new Promise((resolve) => {
      chrome.debugger.sendCommand({ tabId }, command, params, (result) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, ...(result || {}) });
      });
    });
  }
}
