/** @file 过滤规则（与 DOM 无关，可复用于其他站点） */
const XcfRules = (() => {
  const RULE_ORDER = [
    'blocklist',
    'text_keywords',
    'display_name_keywords',
    'probable_spam',
    'mention_spam',
    'emoji_spam'
  ];

  const RULE_META = {
    blocklist: { id: 'blocklist', label: '屏蔽账号' },
    text_keywords: { id: 'text_keywords', label: '评论含关键词' },
    probable_spam: { id: 'probable_spam', label: 'X 疑似垃圾区' },
    mention_spam: { id: 'mention_spam', label: '短句多 @ 提及' },
    emoji_spam: { id: 'emoji_spam', label: '纯表情/无意义符号' },
    display_name_keywords: { id: 'display_name_keywords', label: '昵称含关键词' }
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

  function findKeyword(blob, keywords) {
    const lower = (blob || '').toLowerCase();
    for (const kw of keywords || []) {
      const k = String(kw || '').trim();
      if (k && lower.includes(k.toLowerCase())) return k;
    }
    return null;
  }

  const implementations = {
    blocklist(meta, settings) {
      const h = XcfSettings.normalizeHandle(meta.handle);
      const list = (settings.blocklist || []).map(XcfSettings.normalizeHandle);
      if (h && list.includes(h)) {
        return {
          ruleId: 'blocklist',
          reason: '屏蔽账号',
          label: `用户 @${meta.handle || h}`
        };
      }
      return null;
    },

    text_keywords(meta, settings) {
      const hit = findKeyword(meta.text, settings.textKeywords);
      if (!hit) return null;
      return {
        ruleId: 'text_keywords',
        reason: '评论关键词',
        label: `关键词「${hit}」`,
        matchedKeyword: hit
      };
    },

    display_name_keywords(meta, settings) {
      const hit = findKeyword(
        `${meta.displayName || ''} ${meta.handle || ''}`,
        settings.displayNameKeywords
      );
      if (!hit) return null;
      return {
        ruleId: 'display_name_keywords',
        reason: '昵称关键词',
        label: `昵称「${hit}」`
      };
    },

    probable_spam(meta) {
      if (meta.inProbableSpam) {
        return { ruleId: 'probable_spam', reason: 'X 垃圾区', label: 'X 垃圾区' };
      }
      return null;
    },

    mention_spam(meta) {
      const raw = (meta.text || '').trim();
      if (!raw) return null;
      const mentions = (raw.match(/@[A-Za-z0-9_]{1,30}/g) || []).length;
      const compact = raw.replace(/\s/g, '');
      if (mentions >= 2 && compact.length > 0 && compact.length <= 100) {
        return { ruleId: 'mention_spam', reason: '多@提及', label: '多 @ 提及' };
      }
      return null;
    },

    emoji_spam(meta) {
      if (!isEmojiSpam(meta.text)) return null;
      return { ruleId: 'emoji_spam', reason: '纯表情', label: '纯表情' };
    }
  };

  function listEnabled(settings) {
    return RULE_ORDER.filter((id) => settings.rules?.[id] !== false);
  }

  function evaluate(meta, settings) {
    const h = XcfSettings.normalizeHandle(meta.handle);
    const wl = (settings.whitelist || []).map(XcfSettings.normalizeHandle);
    if (h && wl.includes(h)) return null;

    for (const id of listEnabled(settings)) {
      const fn = implementations[id];
      if (!fn) continue;
      const hit = fn(meta, settings);
      if (hit) return hit;
    }
    return null;
  }

  function foldBarText(meta, match) {
    const tag = match?.label || match?.reason || '已过滤';
    const who = meta.handle ? `@${meta.handle}` : '';
    return who ? `已过滤 ${who} · ${tag}` : `已过滤 · ${tag}`;
  }

  return { RULE_META, RULE_ORDER, evaluate, foldBarText, isEmojiSpam };
})();
