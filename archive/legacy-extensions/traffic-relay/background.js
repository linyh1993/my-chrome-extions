// background.js
importScripts('sites-config.js');

console.log('后台服务已启动，已加载站点:', SITES.map((s) => s.id).join(', '));

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

const attachedTabs = new Set();
const tabSiteConfig = new Map();
const debuggerVersion = '1.3';
const trackedRequests = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (request.command) {
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
        const storedSite = tabSiteConfig.get(activeTab.id);
        sendResponse({
          tabId: activeTab.id,
          hostname,
          isAttached: attachedTabs.has(activeTab.id),
          site: storedSite || site
        });
      });
      return true;

    case 'TOGGLE_DEBUGGER_ACTIVE_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTabId = tabs[0]?.id;
        if (!activeTabId) return;
        if (attachedTabs.has(activeTabId)) {
          detachDebugger(activeTabId);
        } else {
          attachDebugger(activeTabId);
        }
      });
      return true;
  }

  if (!tabId) {
    console.warn('收到的消息没有 tabId:', request.command);
    return true;
  }

  console.log(`[Tab ${tabId}] 收到命令:`, request.command);

  switch (request.command) {
    case 'TOGGLE_DEBUGGER':
      if (attachedTabs.has(tabId)) {
        detachDebugger(tabId);
      } else {
        attachDebugger(tabId);
      }
      break;

    case 'INIT_AND_ATTACH':
      if (!attachedTabs.has(tabId)) {
        console.log(`[Tab ${tabId}] 收到初始化请求，开始附加调试器。`);
        attachDebugger(tabId);
      } else {
        console.log(`[Tab ${tabId}] 调试器已附加，同步 UI。`);
        const site = tabSiteConfig.get(tabId);
        updatePageStatus(tabId, true, site);
      }
      break;

    case 'GET_STATUS':
      sendResponse({ isAttached: attachedTabs.has(tabId) });
      break;
  }

  return true;
});

function resolveSiteForTab(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) {
      console.error(`[Tab ${tabId}] 无法获取标签页 URL:`, chrome.runtime.lastError?.message);
      callback(null);
      return;
    }
    const site = getSiteByUrl(tab.url);
    if (!site) {
      console.warn(`[Tab ${tabId}] 当前页面不在已配置站点列表中:`, tab.url);
    }
    callback(site);
  });
}

function attachDebugger(tabId) {
  resolveSiteForTab(tabId, (site) => {
    if (!site) {
      updatePageStatus(tabId, false);
      return;
    }

    tabSiteConfig.set(tabId, site);
    console.log(`[Tab ${tabId}] 站点: ${site.label} (${site.id})，正在附加调试器...`);

    chrome.debugger.attach({ tabId }, debuggerVersion, () => {
      if (chrome.runtime.lastError) {
        console.error(`[Tab ${tabId}] 附加调试器失败:`, chrome.runtime.lastError.message);
        tabSiteConfig.delete(tabId);
        updatePageStatus(tabId, false);
        return;
      }
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
        if (chrome.runtime.lastError) {
          console.error(`[Tab ${tabId}] 无法开启 Network 监听:`, chrome.runtime.lastError.message);
          detachDebugger(tabId);
        } else {
          console.log(`[Tab ${tabId}] Network 监听已开启 (${site.label})。`);
          attachedTabs.add(tabId);
          updatePageStatus(tabId, true, site);
        }
      });
    });
  });
}

function detachDebugger(tabId) {
  console.log(`[Tab ${tabId}] 正在分离调试器...`);
  chrome.debugger.detach({ tabId }, () => {
    if (chrome.runtime.lastError) {
      console.error(`[Tab ${tabId}] 分离调试器时出错:`, chrome.runtime.lastError.message);
    }
    attachedTabs.delete(tabId);
    tabSiteConfig.delete(tabId);

    let cleanedCount = 0;
    for (const [requestId, data] of trackedRequests.entries()) {
      if (data.tabId === tabId) {
        trackedRequests.delete(requestId);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`[Tab ${tabId}] 清理了 ${cleanedCount} 个残余追踪请求。`);
    }
    updatePageStatus(tabId, false);
  });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!attachedTabs.has(tabId)) return;

  const site = tabSiteConfig.get(tabId);
  if (!site) return;

  switch (method) {
    case 'Network.requestWillBeSent': {
      const { requestId, request } = params;
      if (!shouldTrackRequest(request.url, site)) break;

      trackedRequests.set(requestId, {
        tabId,
        siteId: site.id,
        mirrorUrl: site.mirrorUrl,
        jsonResponsesOnly: !!site.jsonResponsesOnly,
        request,
        response: null,
        responseBody: null
      });
      console.log(`[${requestId}] [Tab ${tabId}] [${site.id}] 候选追踪: ${request.method} ${request.url}`);
      break;
    }

    case 'Network.responseReceived': {
      const { requestId, response } = params;
      const trackedData = trackedRequests.get(requestId);
      if (!trackedData) break;

      if (trackedData.jsonResponsesOnly && !isJsonResponse(response)) {
        trackedRequests.delete(requestId);
        console.log(
          `[${requestId}] [Tab ${tabId}] [${site.id}] 非 JSON 响应 (${getResponseMimeType(response) || 'unknown'})，已跳过`
        );
        break;
      }

      trackedData.response = response;
      console.log(
        `[${requestId}] [Tab ${tabId}] [${site.id}] JSON 响应: ${response.status} ${response.mimeType}`
      );
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
            console.warn(`[${requestId}] [Tab ${tabId}] 无法获取响应体:`, chrome.runtime.lastError.message);
            trackedRequests.delete(requestId);
            return;
          }

          const trackedData = trackedRequests.get(requestId);
          if (!trackedData) return;

          if (trackedData.request && trackedData.response) {
            trackedData.responseBody = bodyInfo.body;
            forwardFullTraffic(trackedData);
          } else {
            console.warn(`[${requestId}] [Tab ${tabId}] 数据不完整，已跳过发送。`);
          }
          trackedRequests.delete(requestId);
        }
      );
      break;
    }
  }
});

async function forwardFullTraffic(trafficData) {
  const payload = {
    siteId: trafficData.siteId,
    request: trafficData.request,
    response: trafficData.response,
    responseBody: trafficData.responseBody
  };

  try {
    console.log(
      `[Tab ${trafficData.tabId}] [${trafficData.siteId}] 发送到本地: ${payload.request.method} ${payload.request.url}`
    );
    const response = await fetch(trafficData.mirrorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log(`[Tab ${trafficData.tabId}] [${trafficData.siteId}] 流量已镜像到本地。`);
    } else {
      console.error(
        `[Tab ${trafficData.tabId}] 本地接口错误:`,
        response.status,
        response.statusText
      );
    }
  } catch (error) {
    console.error(`[Tab ${trafficData.tabId}] 请求本地接口失败:`, error.message);
  }
}

function updatePageStatus(tabId, isAttached, site = null) {
  const payload = {
    command: 'UPDATE_STATUS',
    status: isAttached,
    siteLabel: site?.label ?? null,
    siteId: site?.id ?? null
  };

  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime.lastError) {
      // 页面重载或内容脚本未就绪时属正常情况
    }
  });

  chrome.runtime.sendMessage(payload).catch(() => {
    // 侧边栏未打开时无接收方，属正常
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.has(tabId)) {
    console.log(`[Tab ${tabId}] 标签页关闭，自动分离调试器。`);
    detachDebugger(tabId);
  }
});
