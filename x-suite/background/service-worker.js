/** @file Background service worker for X traffic mirroring. */
importScripts(
  '../shared/mirror-settings.js',
  '../mirror/sites-config.js',
  '../mirror/debugger-bg.js'
);

console.log('X Traffic Mirror service worker started.');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ [MirrorSettings.STORAGE_KEY]: null }, (data) => {
    if (!data[MirrorSettings.STORAGE_KEY]) {
      chrome.storage.sync.set({
        [MirrorSettings.STORAGE_KEY]: MirrorSettings.DEFAULTS
      });
    }
  });
  MirrorBg.initOnInstalled();
});

chrome.runtime.onStartup.addListener(() => {
  MirrorBg.restoreEnabledMirrors();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.domain === 'mirror') {
    return MirrorBg.handleMessage(msg, sender, sendResponse);
  }
  return false;
});
