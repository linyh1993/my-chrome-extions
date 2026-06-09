const $ = (id) => document.getElementById(id);
const READ_PREVIEW_SESSION_KEY = 'xsuite_read_preview_thread';

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

async function getActiveThreadId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.match(/\/status\/(\d+)/)?.[1] || null;
  } catch {
    return null;
  }
}

async function openOptionsMain(sectionId) {
  await chrome.storage.session.set({ [XCF.SESSION.OPTIONS_MAIN]: sectionId });
  chrome.runtime.openOptionsPage();
}

async function openReadPreviewPage() {
  const threadId = await getActiveThreadId();
  if (threadId) {
    await chrome.storage.session.set({ [READ_PREVIEW_SESSION_KEY]: threadId });
  }
  const path = threadId
    ? `ui/read-preview/read-preview.html#thread/${threadId}`
    : 'ui/read-preview/read-preview.html#all';
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

async function loadUi() {
  const s = await send(XCF.MSG.GET_SETTINGS);
  if (!s) return;

  $('enabled').checked = s.enabled !== false;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
}

$('enabled').addEventListener('change', () => {
  send(XCF.MSG.SAVE_SETTINGS, { partial: { enabled: $('enabled').checked } });
});

$('open_filter_settings').addEventListener('click', async () => {
  await openOptionsMain('filter-settings');
  window.close();
});

$('open_library').addEventListener('click', async () => {
  try {
    const threadId = await getActiveThreadId();
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

$('open_mirror_panel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId != null && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
  window.close();
});

loadUi();
