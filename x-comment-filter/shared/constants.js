/** @file 全局常量：页面上下文、消息类型（与站点无关，便于迁移） */
const XCF = {
  CONTEXT: {
    POST_THREAD: 'post_thread',
    TIMELINE: 'timeline',
    ARTICLE: 'article',
    SEARCH: 'search'
  },

  MSG: {
    GET_SETTINGS: 'getSettings',
    SAVE_SETTINGS: 'saveSettings',
    BLOCK_HANDLE: 'blockHandle',
    UNBLOCK_HANDLE: 'unblockHandle',
    WHITELIST_HANDLE: 'whitelistHandle',
    SETTINGS_CHANGED: 'settingsChanged',
    GET_PAGE_STATS: 'getPageStats',
    LOG_FILTERED: 'logFiltered',
    LOG_THREAD_ROOT: 'logThreadRoot',
    GET_LIBRARY: 'getLibrary',
    CLEAR_ARCHIVE: 'clearArchive',
    EXPORT_DATA: 'exportData',
    BLOCK_ARCHIVE_ENTRY: 'blockArchiveEntry',
    RESTORE_ARCHIVE_ENTRY: 'restoreArchiveEntry',
    COMPACT_ARCHIVE: 'compactArchive'
  },

  DISPLAY_MODE: {
    FOLD: 'fold',
    HIDE: 'hide'
  }
};
