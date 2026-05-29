/** @file Service worker：存储、右键菜单、设置广播 */
const STORAGE_KEY = 'xcf_settings';

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: 'fold',
  contexts: { post_thread: true, timeline: false, article: false, search: false },
  rules: { blocklist: true, emoji_spam: true, display_name_keywords: true },
  blocklist: [],
  whitelist: [],
  displayNameKeywords: [
    '同城',
    '上门',
    '破处',
    '免费线下',
    '纯曰',
    '约炮',
    '兼职'
  ]
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ [STORAGE_KEY]: null }, (data) => {
    if (!data[STORAGE_KEY]) {
      chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    }
  });

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'xcf-block-from-page',
      title: '将当前页作者加入屏蔽（实验）',
      contexts: ['page'],
      documentUrlPatterns: [
        '*://x.com/*',
        '*://twitter.com/*'
      ]
    });
  });
});

function normalizeHandle(handle) {
  return String(handle || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

async function getSettings() {
  const data = await chrome.storage.sync.get({ [STORAGE_KEY]: {} });
  const defaults = DEFAULT_SETTINGS;
  const raw = data[STORAGE_KEY] || {};
  return {
    ...defaults,
    ...raw,
    contexts: { ...defaults.contexts, ...(raw.contexts || {}) },
    rules: { ...defaults.rules, ...(raw.rules || {}) }
  };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partial,
    contexts: { ...current.contexts, ...(partial.contexts || {}) },
    rules: { ...current.rules, ...(partial.rules || {}) }
  };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

async function blockHandle(handle) {
  const h = normalizeHandle(handle);
  if (!h) return getSettings();
  const settings = await getSettings();
  const blocklist = [...new Set([...(settings.blocklist || []).map(normalizeHandle), h])];
  const whitelist = (settings.whitelist || [])
    .map(normalizeHandle)
    .filter((x) => x !== h);
  return saveSettings({ blocklist, whitelist });
}

async function whitelistHandle(handle) {
  const h = normalizeHandle(handle);
  if (!h) return getSettings();
  const settings = await getSettings();
  const whitelist = [...new Set([...(settings.whitelist || []).map(normalizeHandle), h])];
  const blocklist = (settings.blocklist || [])
    .map(normalizeHandle)
    .filter((x) => x !== h);
  return saveSettings({ whitelist, blocklist });
}

function broadcastSettingsChanged() {
  chrome.tabs.query({ url: ['*://x.com/*', '*://twitter.com/*'] }, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs
        .sendMessage(tab.id, { type: 'settingsChanged' })
        .catch(() => {});
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) broadcastSettingsChanged();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'getSettings':
        sendResponse(await getSettings());
        break;
      case 'saveSettings':
        sendResponse(await saveSettings(msg.partial || {}));
        broadcastSettingsChanged();
        break;
      case 'blockHandle':
        sendResponse(await blockHandle(msg.handle));
        broadcastSettingsChanged();
        break;
      case 'whitelistHandle':
        sendResponse(await whitelistHandle(msg.handle));
        broadcastSettingsChanged();
        break;
      default:
        sendResponse(null);
    }
  })();
  return true;
});

chrome.contextMenus.onClicked.addListener((_info, _tab) => {
  // 预留：可从 URL 解析作者；v1 以评论条内按钮为主
});
