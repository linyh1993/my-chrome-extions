/** @file Service worker：存储与设置变更通知 */
importScripts(
  'shared/constants.js',
  'shared/settings.js',
  'shared/archive.js'
);

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ [XcfSettings.STORAGE_KEY]: null }, (data) => {
    if (!data[XcfSettings.STORAGE_KEY]) {
      chrome.storage.sync.set({ [XcfSettings.STORAGE_KEY]: XcfSettings.DEFAULTS });
    }
  });
  XcfArchive.compact();
});

chrome.runtime.onStartup.addListener(() => {
  XcfArchive.compact();
});

function normalizeHandle(handle) {
  return XcfSettings.normalizeHandle(handle);
}

function notifyTabsSettings() {
  chrome.tabs.query({ url: ['*://x.com/*', '*://twitter.com/*'] }, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs
        .sendMessage(tab.id, { type: XCF.MSG.SETTINGS_CHANGED })
        .catch(() => {});
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case XCF.MSG.GET_SETTINGS:
        sendResponse(await XcfSettings.load());
        break;
      case XCF.MSG.SAVE_SETTINGS: {
        const settings = await XcfSettings.save(msg.partial || {});
        notifyTabsSettings();
        sendResponse(settings);
        break;
      }
      case XCF.MSG.BLOCK_HANDLE: {
        const h = normalizeHandle(msg.handle);
        if (!h) {
          sendResponse(await XcfSettings.load());
          break;
        }
        const cur = await XcfSettings.load();
        const blocklist = [...new Set([...(cur.blocklist || []).map(normalizeHandle), h])];
        const whitelist = (cur.whitelist || []).map(normalizeHandle).filter((x) => x !== h);
        await XcfSettings.save({ blocklist, whitelist });
        await XcfArchive.append({
          at: Date.now(),
          handle: h,
          displayName: msg.displayName || '',
          text: msg.text || '',
          ruleId: 'blocklist',
          reason: '手动屏蔽',
          pageUrl: msg.pageUrl || '',
          source: 'manual_block'
        });
        sendResponse(await XcfSettings.load());
        break;
      }
      case XCF.MSG.UNBLOCK_HANDLE: {
        const h = normalizeHandle(msg.handle);
        const cur = await XcfSettings.load();
        const blocklist = (cur.blocklist || [])
          .map(normalizeHandle)
          .filter((x) => x !== h);
        sendResponse(await XcfSettings.save({ blocklist }));
        break;
      }
      case XCF.MSG.WHITELIST_HANDLE: {
        const h = normalizeHandle(msg.handle);
        if (!h) {
          sendResponse(await XcfSettings.load());
          break;
        }
        const cur = await XcfSettings.load();
        const whitelist = [...new Set([...(cur.whitelist || []).map(normalizeHandle), h])];
        const blocklist = (cur.blocklist || []).map(normalizeHandle).filter((x) => x !== h);
        sendResponse(await XcfSettings.save({ whitelist, blocklist }));
        break;
      }
      case XCF.MSG.LOG_FILTERED:
        sendResponse(await XcfArchive.append(msg.entry || {}));
        break;
      case XCF.MSG.LOG_THREAD_ROOT:
        sendResponse(await XcfArchive.upsertThreadRoot(msg.entry || {}));
        break;
      case XCF.MSG.GET_LIBRARY: {
        const settings = await XcfSettings.load();
        const lanes = await XcfArchive.getLibrary();
        sendResponse({
          blocklist: settings.blocklist || [],
          whitelist: settings.whitelist || [],
          textKeywords: settings.textKeywords || [],
          displayNameKeywords: settings.displayNameKeywords || [],
          rules: settings.rules || {},
          archive: lanes.filtered,
          blockedReplies: lanes.blockedReplies,
          threadRoots: lanes.threadRoots || {}
        });
        break;
      }
      case XCF.MSG.BLOCK_ARCHIVE_ENTRY: {
        const id = msg.id;
        if (id) {
          const list = await XcfArchive.load();
          const entry = list.find((r) => r.id === id);
          if (entry?.handle) {
            const h = normalizeHandle(entry.handle);
            const cur = await XcfSettings.load();
            const blocklist = [...new Set([...(cur.blocklist || []).map(normalizeHandle), h])];
            const whitelist = (cur.whitelist || []).map(normalizeHandle).filter((x) => x !== h);
            await XcfSettings.save({ blocklist, whitelist });
          }
          await XcfArchive.moveToBlockedLane(id);
        }
        const lanes = await XcfArchive.getLibrary();
        sendResponse({
          blocklist: (await XcfSettings.load()).blocklist || [],
          archive: lanes.filtered,
          blockedReplies: lanes.blockedReplies
        });
        break;
      }
      case XCF.MSG.RESTORE_ARCHIVE_ENTRY: {
        if (msg.id) await XcfArchive.restoreFromBlockedLane(msg.id);
        const lanes = await XcfArchive.getLibrary();
        sendResponse({
          blocklist: (await XcfSettings.load()).blocklist || [],
          archive: lanes.filtered,
          blockedReplies: lanes.blockedReplies
        });
        break;
      }
      case XCF.MSG.CLEAR_ARCHIVE:
        sendResponse(await XcfArchive.clearFilteredOnly());
        break;
      case XCF.MSG.COMPACT_ARCHIVE: {
        const stats = await XcfArchive.compact();
        const lib = await XcfArchive.getLibrary();
        sendResponse({
          blocklist: (await XcfSettings.load()).blocklist || [],
          archive: lib.filtered,
          blockedReplies: lib.blockedReplies,
          stats
        });
        break;
      }
      case XCF.MSG.EXPORT_DATA:
        sendResponse(await XcfArchive.exportBundle());
        break;
      default:
        sendResponse(null);
    }
  })();
  return true;
});
