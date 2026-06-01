const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

async function openOptionsMain(sectionId) {
  await chrome.storage.session.set({ [XCF.SESSION.OPTIONS_MAIN]: sectionId });
  chrome.runtime.openOptionsPage();
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tid = tab?.url?.match(/\/status\/(\d+)/)?.[1];
    if (tid) {
      await chrome.storage.session.set({ [XCF.SESSION.OPTIONS_THREAD]: tid });
    }
  } catch {
    /* ignore */
  }
  await openOptionsMain('library');
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
