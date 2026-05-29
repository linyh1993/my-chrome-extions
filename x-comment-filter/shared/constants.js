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
    WHITELIST_HANDLE: 'whitelistHandle',
    SETTINGS_CHANGED: 'settingsChanged',
    GET_PAGE_STATS: 'getPageStats'
  },

  DISPLAY_MODE: {
    FOLD: 'fold',
    HIDE: 'hide'
  }
};
