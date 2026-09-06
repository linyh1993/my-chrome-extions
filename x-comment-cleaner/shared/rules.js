/**
 * X Spam Reply Cleaner - Unified Rules Engine & Dictionary
 * 
 * Standalone pure-JS module for spam detection, text normalization, and pattern matching.
 * Zero Chrome/DOM dependencies - can be used in Chrome Extension, Node.js, Web Workers,
 * Userscripts, or external backend services.
 */

// === 1. Default Spam Dictionary ===
const X_SPAM_DICTIONARY = [
  // === 1. 黄推诱导 / 骚话 / 身体特征与通假变体 ===
  "比她好看", "比她骚", "没她骚", "没她好看", "比我好看", "比我骚", "没我骚", "没我好看",
  "比我玩的开", "比我玩得开", "比我放得开", "比我放的开", "比我玩的大", "比我玩得大",
  "玩的开", "玩得开", "玩的嗨", "玩得嗨", "放得开", "放的开", "玩的大", "玩得大",
  "耐不住寂寞", "耐不住", "寂寞难耐", "空虚寂寞", "长夜漫漫", "深夜寂寞", "找个哥哥", "找哥哥", "有哥哥吗", "有哥哥线下吗", "哥哥线下",
  "福不黑", "服不黑", "批不黑", "逼不黑", "鲍不黑", "不黑不信", "粉不粉", "黑不黑",
  "粉嫩", "水多", "耐操", "反差", "反差婊", "反差女", "反差母狗", "小母狗", "骚货", "骚逼", "发骚", "赔钱货",
  "约炮", "同城约", "可约", "线下约", "可线下", "线下吗", "线下找", "探花", "裸聊", "自慰", "情趣", "绿奴", "露出",
  "大秀", "福利姬", "微密圈", "无圣光", "秀人", "麻豆", "糖心", "91",
  "固泡", "急需一位固泡", "找固泡", "求固泡", "蹲固泡", "同城固",
  "主人任务", "接主人任务", "做主人任务", "认主人", "找主人",
  "男大来", "找男大", "男大进", "女大来", "找女大",

  // === 2. 引流引导 / 主页 / 头像 / 相册 / 诱饵 ===
  "看主页", "看主頁", "看置顶", "看置頂", "看头像", "点头像", "点我头像", "点主页", "进主页",
  "看动态", "看相册", "私密相册", "私密视频", "精选相册", "置顶动态", "看置顶动态",
  "不信你看", "不信看", "信不信你看", "不信你来", "你看我", "想看私", "想看的", "懂的都懂", "懂的来",

  // === 3. 私信 / 私聊 / 约聊变体 ===
  "私信", "私信我", "私聊", "私我", "斯我", "斯聊", "丝我", "丝聊", "私发", "私密", "喜欢私", "可y", "可Y", "私可y", "可面面", "可面交",

  // === 4. 微信 / 联系方式变体 ===
  "加v", "加V", "加vx", "加VX", "加微", "加🛰", "加卫星", "卫星号", "卫星：",
  "威信", "薇信", "唯心", "维信", "v信", "➕v", "➕V", "➕vx", "➕微", "＋v", "＋V", "🛰️", "🛰",

  // === 5. 门槛 / 群 / 裙 / 变体 ===
  "门槛", "门槛群", "門檻", "门卡", "门坎", "无门槛", "进群", "进裙", "入群", "入裙",
  "裙内", "群内看", "裙内看", "👗内", "进👗", "入👗", "门票", "免门槛",

  // === 6. 黑料 / 吃瓜 / 资源 / 网盘 ===
  "福利", "福力", "资源群", "吃瓜群", "黑料", "大瓜", "瓜条", "爆料", "合集",
  "夸克网盘", "夸克", "度盘", "网盘链接", "解压码"
];

// === 2. Regex / Heuristic patterns ===
const X_SPAM_PATTERNS = [
  /(?:没人|谁)比我.*(?:玩|骚|放|浪)/i,
  /(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i,
  /(?:看主页|看置顶|看相册|私信我|进群).*(?:福利|无门槛|吃瓜|资源|相册)/i,
  /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u,
  /(?:比她|好看|骚|看主|置顶|资源|私聊|福利|主页|吃瓜).*@[\w_]{3,20}/i
];

const DEFAULT_CLEANER_SETTINGS = {
  enabled: true,
  hideMode: "collapse", // 'collapse' or 'hide'
  filterKeywords: true,
  filterHomophones: true,
  filterPureNumbers: true,
  filterMentionSpam: true,
  filterDuplicates: true,
  keywords: [...X_SPAM_DICTIONARY],
  blockedCount: 0
};

// === 3. Normalization Helpers ===

/**
 * Merge custom keywords into base dictionary
 */
function mergeKeywords(storedKeywords, baseDict = X_SPAM_DICTIONARY) {
  const set = new Set(Array.isArray(baseDict) ? baseDict : X_SPAM_DICTIONARY);
  if (Array.isArray(storedKeywords)) {
    for (const k of storedKeywords) {
      if (typeof k === 'string' && k.trim().length >= 2) {
        set.add(k.trim());
      }
    }
  }
  return Array.from(set);
}

/**
 * Extract consecutive Chinese characters while normalizing homophone symbols
 */
function extractChineseText(text) {
  if (!text) return '';
  const s = text
    .replace(/➕|\＋|\+/g, '加')
    .replace(/👗/g, '群')
    .replace(/🛰️|🛰/g, '微')
    .replace(/威信|薇信|唯心|维信/g, '微信')
    .replace(/裙内|进裙|入裙/g, '进群')
    .replace(/門檻|门坎|门卡/g, '门槛')
    .replace(/看主頁/g, '看主页')
    .replace(/置頂/g, '置顶');
  const matches = s.match(/[\u4e00-\u9fa5]+/g);
  return matches ? matches.join('') : '';
}

/**
 * Normalize text for keyword & pattern matching (strips timestamps, emojis, punctuations)
 */
function normalizeTextForMatching(text, filterHomophones = true) {
  if (!text) return '';
  let s = text.toLowerCase();

  // 1. Strip timestamps and dates
  s = s.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?\b/g, '');
  s = s.replace(/\b17\d{10,11}\b/g, ''); // strip millisecond unix timestamps

  // 2. Strip emojis
  s = s.replace(/[\p{Emoji}\u200d\uFE0F\uE000-\uF8FF]/gu, '');

  if (filterHomophones) {
    s = s
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/➕|\＋|\+/g, '加')
      .replace(/👗/g, '群')
      .replace(/🛰️|🛰/g, '微')
      .replace(/威信|薇信|唯心|维信/g, '微信')
      .replace(/裙内|进裙|入裙/g, '进群')
      .replace(/門檻|门坎|门卡/g, '门槛')
      .replace(/看主頁/g, '看主页')
      .replace(/置頂/g, '置顶')
      .replace(/[\s\-_,，。！？!?.~～`@#$%^&*()（）:：/\\|<>'"“”‘’\d]+/g, '');
  } else {
    s = s.replace(/[\s\-_,，。！？!?.~～`@#$%^&*()（）:：/\\|<>'"“”‘’\d]+/g, '');
  }

  return s;
}

/**
 * Normalize text for duplicate / copypasta comparison across multiple accounts
 */
function normalizeTextForComparison(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/@[\w_]+/g, '')
    .replace(/[\s\p{Emoji}\u200d\uFE0F\d.,!?;:，。！？；：_~`@#$%^&*()+\-=[\]{}|\\/<>'"“”‘’]+/gu, '')
    .trim();
}

/**
 * Check if a text is composed purely of digits (or digits + simple symbols/emojis/punctuation)
 * e.g., "5", "3", "7", "8", "6", "1", "666", "111", "1.", "+1"
 */
function isPureNumberReply(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Must contain at least one digit (ASCII or fullwidth)
  const hasDigit = /[\d\uff10-\uff19]/.test(trimmed);
  if (!hasDigit) return false;

  // Must NOT contain any language letters or CJK characters
  const hasLettersOrHan = /[\p{L}\p{Script=Han}]/u.test(trimmed);
  if (hasLettersOrHan) return false;

  // Must only contain digits, whitespace, and common symbols/punctuation/emojis
  return /^[0-9\uff10-\uff19\s.,，。！？!?~～#+_\-/\\:：@$￥¥€£%&^|*()（）[\]【】{}<>'"`"“”‘’\p{Emoji}\u200d\uFE0F]+$/u.test(trimmed);
}

// === 4. Evaluation Engines ===

/**
 * Evaluate raw text content against keyword blacklist and homophone/heuristic rules
 * @param {string} text
 * @param {Object} options
 * @returns {{ isSpam: boolean, reason?: string }}
 */
function evaluateTextContent(text, {
  filterKeywords = true,
  filterHomophones = true,
  keywords = X_SPAM_DICTIONARY,
  patterns = X_SPAM_PATTERNS
} = {}) {
  if (!text || text.length < 2) return { isSpam: false };

  const lowerText = text.toLowerCase();
  const normalizedText = normalizeTextForMatching(text, filterHomophones);
  const chineseText = extractChineseText(text);

  // 1. Curated / custom keywords check
  if (filterKeywords && Array.isArray(keywords)) {
    for (const kw of keywords) {
      if (typeof kw !== 'string') continue;
      const trimmed = kw.trim();
      if (trimmed.length < 2) continue;

      // Chinese-only substring matching
      const kwCn = extractChineseText(trimmed);
      if (kwCn && kwCn.length >= 2 && chineseText.includes(kwCn)) {
        return { isSpam: true, reason: trimmed };
      }

      // Standard normalized matching
      const normKw = normalizeTextForMatching(trimmed, filterHomophones);
      if (normKw && normKw.length >= 2) {
        if (lowerText.includes(trimmed.toLowerCase()) || normalizedText.includes(normKw)) {
          return { isSpam: true, reason: trimmed };
        }
      }
    }
  }

  // 2. Homophone & Bait sentence heuristics
  if (filterHomophones) {
    if (/(?:没人|谁)比我.*(?:玩|骚|放|浪)/i.test(normalizedText) || /(?:没人|谁)比我.*(?:玩|骚|放|浪)/i.test(chineseText)) {
      return { isSpam: true, reason: '诱导话术' };
    }
    if (/(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i.test(normalizedText) || /(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i.test(chineseText)) {
      return { isSpam: true, reason: '诱导话术' };
    }
    if (/(?:看主页|看置顶|看相册|私信我|进群).*(?:福利|无门槛|吃瓜|资源|相册)/i.test(normalizedText)) {
      return { isSpam: true, reason: '引流诱导' };
    }

    const patternList = Array.isArray(patterns) ? patterns : X_SPAM_PATTERNS;
    for (const pattern of patternList) {
      if (pattern.test(text) || pattern.test(normalizedText)) {
        return { isSpam: true, reason: '特征匹配' };
      }
    }
  }

  return { isSpam: false };
}

/**
 * Full reply/comment spam evaluator.
 * Evaluates text (pure numbers, keywords, patterns, mention spam, duplicates) and author display name.
 * 
 * @param {Object} params
 * @param {string} params.text - Reply text content
 * @param {string} [params.authorHandle] - User handle (without @)
 * @param {string} [params.displayName] - User profile display name
 * @param {Object} [params.settings] - Active filter options
 * @param {Map<string, Set<string>>} [params.duplicateTracker] - State map for copypasta detection
 * @returns {{ isSpam: boolean, reason?: string }}
 */
function evaluateReplySpam({
  text = '',
  authorHandle = '',
  displayName = '',
  settings = {},
  duplicateTracker = null
} = {}) {
  const cfg = {
    filterKeywords: true,
    filterHomophones: true,
    filterPureNumbers: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: X_SPAM_DICTIONARY,
    ...settings
  };

  // 1. Check tweet text
  if (text) {
    // Pure number / single digit spam check (e.g. 5, 3, 7, 8, 6, 1, 666)
    if (cfg.filterPureNumbers && isPureNumberReply(text)) {
      return { isSpam: true, reason: '纯数字刷屏' };
    }

    const textCheck = evaluateTextContent(text, cfg);
    if (textCheck.isSpam) {
      return textCheck;
    }

    // Mention Spam Pattern (短语 + @mention + 随机Emoji/数字)
    if (cfg.filterMentionSpam) {
      const mentionPattern = /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u;
      if (mentionPattern.test(text)) {
        return { isSpam: true, reason: 'Bot 引流艾特' };
      }
    }

    // Copypasta / duplicate reply check across different authors
    if (cfg.filterDuplicates && duplicateTracker) {
      const normalized = normalizeTextForComparison(text);
      if (normalized.length >= 6) {
        let authors = duplicateTracker.get(normalized);
        if (!authors) {
          authors = new Set();
          duplicateTracker.set(normalized, authors);
        }

        if (authorHandle) {
          authors.add(authorHandle.toLowerCase());
        }

        if (authors.size >= 2) {
          return { isSpam: true, reason: `重复刷屏 (${authors.size} 账号同发)` };
        }
      }
    }
  }

  // 2. Check author display name (catches spam solicitations in nickname, e.g. "急需一位固泡", "接主人任务")
  if (displayName) {
    const nameCheck = evaluateTextContent(displayName, cfg);
    if (nameCheck.isSpam) {
      return { isSpam: true, reason: nameCheck.reason };
    }
  }

  return { isSpam: false };
}

const XCleanerRules = {
  X_SPAM_DICTIONARY,
  X_SPAM_PATTERNS,
  DEFAULT_CLEANER_SETTINGS,
  mergeKeywords,
  extractChineseText,
  normalizeTextForMatching,
  normalizeTextForComparison,
  isPureNumberReply,
  evaluateTextContent,
  evaluateReplySpam
};

// Global exports (for browser extension / content script / worker)
if (typeof globalThis !== 'undefined') {
  globalThis.X_SPAM_DICTIONARY = X_SPAM_DICTIONARY;
  globalThis.X_SPAM_PATTERNS = X_SPAM_PATTERNS;
  globalThis.DEFAULT_CLEANER_SETTINGS = DEFAULT_CLEANER_SETTINGS;
  globalThis.isPureNumberReply = isPureNumberReply;
  globalThis.extractChineseText = extractChineseText;
  globalThis.normalizeTextForMatching = normalizeTextForMatching;
  globalThis.normalizeTextForComparison = normalizeTextForComparison;
  globalThis.evaluateTextContent = evaluateTextContent;
  globalThis.evaluateReplySpam = evaluateReplySpam;
  globalThis.mergeKeywords = mergeKeywords;
  globalThis.XCleanerRules = XCleanerRules;
}

// CommonJS export (for Node.js / tests / build scripts)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = XCleanerRules;
}
