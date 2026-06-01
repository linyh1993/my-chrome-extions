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
    COMPACT_ARCHIVE: 'compactArchive',
    GET_ACTIVE_THREAD: 'getActiveThread',
    GET_THREAD_CAPTURE_KEYS: 'getThreadCaptureKeys',
    REMOVE_ARCHIVE_ENTRY: 'removeArchiveEntry',
    UNCLASSIFY_ENTRY: 'unclassifyEntry',
    UNCLASSIFY_ON_PAGE: 'unclassifyOnPage',
    OPEN_OPTIONS_PAGE: 'openOptionsPage'
  },

  /** 评论分类：noise=无效/噪音，signal=有效/非噪音（默认不写入库） */
  COMMENT_KIND: {
    NOISE: 'noise',
    SIGNAL: 'signal'
  },

  SESSION: {
    ACTIVE_THREAD: 'xcf_active_thread',
    OPTIONS_THREAD: 'xcf_options_thread',
    OPTIONS_MAIN: 'xsuite_options_main'
  },

  DISPLAY_MODE: {
    FOLD: 'fold',
    HIDE: 'hide'
  },

  /** 页内统一面板：panelUi ↔ 展示模式 */
  panelUiFromDisplayMode(mode) {
    if (mode === 'expanded') return { hidden: false, collapsed: false };
    if (mode === 'minimized') return { hidden: false, collapsed: true };
    return { hidden: true, collapsed: false };
  },

  displayModeFromPanelUi(ui) {
    if (ui?.hidden) return 'hidden';
    if (ui?.collapsed) return 'minimized';
    return 'expanded';
  }
};
