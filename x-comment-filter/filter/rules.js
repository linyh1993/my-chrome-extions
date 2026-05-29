/** @file 过滤规则（与 DOM 无关，可复用于其他站点） */
const XcfRules = (() => {
  const RULE_META = {
    blocklist: { id: 'blocklist', label: '已屏蔽账号' },
    emoji_spam: { id: 'emoji_spam', label: '纯表情/无意义符号' },
    display_name_keywords: { id: 'display_name_keywords', label: '昵称含垃圾关键词' }
  };

  function isEmojiSpam(text) {
    const raw = (text || '').trim();
    if (!raw) return true;

    const compact = raw.replace(/\s/g, '');
    if (!compact) return true;

    const emojiRe = /\p{Extended_Pictographic}/gu;
    const emojis = (raw.match(emojiRe) || []).length;
    const alnum = (raw.match(/[\p{L}\p{N}]/gu) || []).length;

    if (alnum === 0 && emojis > 0) return true;
    if (compact.length <= 32 && emojis / compact.length >= 0.55) return true;
    return false;
  }

  function nameHasKeyword(meta, keywords) {
    const blob = `${meta.displayName || ''} ${meta.handle || ''}`.toLowerCase();
    return (keywords || []).some((kw) => kw && blob.includes(String(kw).toLowerCase()));
  }

  const implementations = {
    blocklist(meta, settings) {
      const h = XcfSettings.normalizeHandle(meta.handle);
      const list = (settings.blocklist || []).map(XcfSettings.normalizeHandle);
      if (h && list.includes(h)) {
        return { ruleId: 'blocklist', reason: `已屏蔽 @${meta.handle}` };
      }
      return null;
    },

    emoji_spam(meta, settings) {
      if (!isEmojiSpam(meta.text)) return null;
      return { ruleId: 'emoji_spam', reason: '纯表情或无实质文字' };
    },

    display_name_keywords(meta, settings) {
      if (!nameHasKeyword(meta, settings.displayNameKeywords)) return null;
      return { ruleId: 'display_name_keywords', reason: '昵称含可疑关键词' };
    }
  };

  function listEnabled(settings) {
    return Object.keys(implementations).filter((id) => settings.rules?.[id] !== false);
  }

  function evaluate(meta, settings) {
    const h = XcfSettings.normalizeHandle(meta.handle);
    const wl = (settings.whitelist || []).map(XcfSettings.normalizeHandle);
    if (h && wl.includes(h)) return null;

    for (const id of listEnabled(settings)) {
      const hit = implementations[id](meta, settings);
      if (hit) return hit;
    }
    return null;
  }

  return { RULE_META, evaluate, isEmojiSpam };
})();
