const $ = (id) => document.getElementById(id);
const READ_PREVIEW_SESSION_KEY = 'xsuite_read_preview_thread';
let activeTabContext = { tabId: null, url: '', threadId: null, isXTab: false };
let captureBusy = false;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

async function getActiveTabContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = String(tab?.url || '');
    return {
      tabId: tab?.id ?? null,
      url,
      threadId: url.match(/\/status\/(\d+)/)?.[1] || null,
      isXTab: /(?:^https?:\/\/)?(?:[^/]+\.)?(?:x|twitter)\.com\//.test(url)
    };
  } catch {
    return { tabId: null, url: '', threadId: null, isXTab: false };
  }
}

async function openOptionsMain(sectionId) {
  await chrome.storage.session.set({ [XCF.SESSION.OPTIONS_MAIN]: sectionId });
  chrome.runtime.openOptionsPage();
}

async function openReadPreviewPage() {
  const { threadId } = await getActiveTabContext();
  if (threadId) {
    await chrome.storage.session.set({ [READ_PREVIEW_SESSION_KEY]: threadId });
  }
  const path = threadId
    ? `ui/read-preview/read-preview.html#thread/${threadId}`
    : 'ui/read-preview/read-preview.html#all';
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

function setCaptureStatus(text, tone = '') {
  const el = $('capture_status');
  if (!el) return;
  el.textContent = text || '';
  el.className = tone ? `foot popup-status is-${tone}` : 'foot popup-status';
}

function syncCaptureButton() {
  const button = $('capture_current_thread');
  if (!button) return;
  const enabled = $('enabled')?.checked !== false;
  const ready = enabled && Boolean(activeTabContext.tabId && activeTabContext.threadId);
  button.disabled = captureBusy || !ready;
}

function sendRecaptureToTab(tabId, threadId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: XCF.MSG.RECAPTURE_THREAD_ON_PAGE, threadId },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, error: error.message || String(error) });
          return;
        }
        resolve(response || { ok: false, error: 'empty_response' });
      }
    );
  });
}

async function loadUi() {
  const s = await send(XCF.MSG.GET_SETTINGS);
  if (!s) return;

  $('enabled').checked = s.enabled !== false;
  activeTabContext = await getActiveTabContext();
  syncCaptureButton();

  try {
    const tab = activeTabContext.tabId ? { id: activeTabContext.tabId, url: activeTabContext.url } : null;
    if (tab?.id && /x\.com|twitter\.com/.test(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, { type: XCF.MSG.GET_PAGE_STATS }, (stats) => {
        if (stats?.foldedCount > 0) {
          $('page_stats').textContent = `当前页已折叠 ${stats.foldedCount} 条`;
        } else {
          $('page_stats').textContent = '';
        }
      });
    }
  } catch {
    /* ignore */
  }

  if (!activeTabContext.isXTab) {
    setCaptureStatus('请先切到 X 帖子页。', 'error');
  } else if (!activeTabContext.threadId) {
    setCaptureStatus('当前标签页不是帖子详情页。', 'error');
  } else if ($('enabled').checked === false) {
    setCaptureStatus('请先开启评论过滤后再抓取。', 'error');
  } else {
    setCaptureStatus(`将重新抓取帖子 ${activeTabContext.threadId}。`);
  }
}

$('enabled').addEventListener('change', () => {
  send(XCF.MSG.SAVE_SETTINGS, { partial: { enabled: $('enabled').checked } });
  syncCaptureButton();
  if (!$('enabled').checked) {
    setCaptureStatus('请先开启评论过滤后再抓取。', 'error');
  } else if (activeTabContext.threadId) {
    setCaptureStatus(`将重新抓取帖子 ${activeTabContext.threadId}。`);
  }
});

$('open_filter_settings').addEventListener('click', async () => {
  await openOptionsMain('filter-settings');
  window.close();
});

$('open_library').addEventListener('click', async () => {
  try {
    const { threadId } = await getActiveTabContext();
    if (threadId) {
      await chrome.storage.session.set({ [XCF.SESSION.OPTIONS_THREAD]: threadId });
    }
  } catch {
    /* ignore */
  }
  await openOptionsMain('library');
  window.close();
});

$('open_read_preview').addEventListener('click', async () => {
  await openReadPreviewPage();
  window.close();
});

$('capture_current_thread').addEventListener('click', async () => {
  if (captureBusy) return;
  activeTabContext = await getActiveTabContext();
  syncCaptureButton();
  if (!activeTabContext.tabId || !activeTabContext.threadId) {
    setCaptureStatus('当前标签页不是帖子详情页。', 'error');
    return;
  }
  if (!$('enabled').checked) {
    setCaptureStatus('请先开启评论过滤后再抓取。', 'error');
    return;
  }

  captureBusy = true;
  syncCaptureButton();
  setCaptureStatus(`正在重新抓取帖子 ${activeTabContext.threadId}…`, 'success');

  try {
    const result = await sendRecaptureToTab(activeTabContext.tabId, activeTabContext.threadId);
    if (!result?.ok) {
      const reason = String(result?.reason || result?.error || '');
      if (reason === 'thread_mismatch') {
        setCaptureStatus('页面路由已变化，请回到目标帖子后重试。', 'error');
      } else if (reason === 'inactive') {
        setCaptureStatus('当前页面未处于可抓取状态。', 'error');
      } else {
        setCaptureStatus('抓取未启动，请刷新帖子页后重试。', 'error');
      }
      return;
    }

    setCaptureStatus('已触发完整抓取，请保持帖子页打开几秒等待采集完成。', 'success');
  } finally {
    captureBusy = false;
    syncCaptureButton();
  }
});

$('open_mirror_panel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId != null && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
  window.close();
});

loadUi();
