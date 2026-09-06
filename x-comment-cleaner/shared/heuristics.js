/**
 * X Spam Reply Cleaner - Heuristics, Normalization & Phrase Rules
 * Pure functional module for text normalization, phrase gap matching, and account heuristics.
 */

const DEFAULT_NAME_RE = /^(?:user|用户)[\s\u00a0]*\d{5,}$/i;
const DIGIT_TAIL_HANDLE_RE = /^[a-z]{1,10}\d{5,}$/i;
const SPAM_HOST_HINT_RE = /(?:giveaway|airdrop|freecrypto|freegift|claimrewards?|t\.me\/|linktr\.ee)/i;

const EROGENOUS_MARKERS = [
  [/涩|色色/, "涩"],
  [/没我骚|比我[^。]{0,8}骚|极品骚/, "骚"],
  [/玩[得的]{1,2}更?开|玩[得的]{1,2}大/, "玩得开"],
  [/[🍑🍒🍆💧💋🌹🔞]/u, "擦边emoji"]
];

function normalizeHandle(handle) {
  if (!handle) return '';
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

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

function normalizeTextForMatching(text, filterHomophones = true) {
  if (!text) return '';
  let s = text.toLowerCase();

  // Strip timestamps and dates
  s = s.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?\b/g, '');
  s = s.replace(/\b17\d{10,11}\b/g, '');

  // Strip emojis & zero-width characters
  s = s.replace(/[\p{Emoji}\u200d\uFE0F\uE000-\uF8FF\u200B-\u200D\uFEFF]/gu, '');

  if (filterHomophones) {
    s = s
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

function isPureNumberReply(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const hasDigit = /[\d\uff10-\uff19]/.test(trimmed);
  if (!hasDigit) return false;

  const hasLettersOrHan = /[\p{L}\p{Script=Han}]/u.test(trimmed);
  if (hasLettersOrHan) return false;

  return /^[0-9\uff10-\uff19\s.,，。！？!?~～#+_\-/\\:：@$￥¥€£%&^|*()（）[\]【】{}<>'"`"“”‘’\p{Emoji}\u200d\uFE0F]+$/u.test(trimmed);
}

/**
 * Check if text matches ordered gap phrases: e.g. ["同城", "上门"] within maxGap characters
 */
function matchGapPhrase(text, terms, maxGap = 15) {
  if (!text || !terms || terms.length < 2) return false;
  let lastPos = 0;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i].toLowerCase();
    const pos = text.indexOf(term, lastPos);
    if (pos === -1) return false;
    if (i > 0 && (pos - lastPos) > maxGap + terms[i - 1].length) {
      return false;
    }
    lastPos = pos + term.length;
  }
  return true;
}

/**
 * Check account and external link heuristics
 */
function checkAccountHeuristics({ handle = '', displayName = '', links = [], bio = '', text = '' } = {}) {
  const normHandle = normalizeHandle(handle);
  const trimName = (displayName || '').trim();

  // 1. Default user name + long digits handle
  if (trimName && DEFAULT_NAME_RE.test(trimName)) {
    return { isSpam: true, reason: '默认名+随机数字账号' };
  }
  if (DIGIT_TAIL_HANDLE_RE.test(normHandle) && trimName && DEFAULT_NAME_RE.test(trimName)) {
    return { isSpam: true, reason: '批量注册特征账号' };
  }

  // 2. Suspicious external link hostname
  if (Array.isArray(links)) {
    for (const link of links) {
      const hostname = typeof link === 'string' ? link : (link.hostname || link.href || '');
      if (hostname && SPAM_HOST_HINT_RE.test(hostname)) {
        return { isSpam: true, reason: `指向可疑引流域名 (${hostname.slice(0, 20)})` };
      }
    }
  }

  // 3. Combined erogenous markers
  const haystack = [text, bio].filter(Boolean).join('\n');
  if (haystack) {
    const hits = [];
    for (const [re, label] of EROGENOUS_MARKERS) {
      if (re.test(haystack)) {
        hits.push(label);
        if (hits.length >= 2) {
          return { isSpam: true, reason: `擦边引流特征 (${hits.join('+')})` };
        }
      }
    }
  }

  return { isSpam: false };
}

function mergeKeywords(storedKeywords, baseDict = []) {
  const set = new Set(Array.isArray(baseDict) ? baseDict : []);
  if (Array.isArray(storedKeywords)) {
    for (const k of storedKeywords) {
      if (typeof k === 'string' && k.trim().length >= 2) {
        set.add(k.trim());
      }
    }
  }
  return Array.from(set);
}

const XCleanerHeuristics = {
  normalizeHandle,
  extractChineseText,
  normalizeTextForMatching,
  isPureNumberReply,
  matchGapPhrase,
  checkAccountHeuristics,
  mergeKeywords
};

if (typeof globalThis !== 'undefined') {
  globalThis.normalizeHandle = normalizeHandle;
  globalThis.extractChineseText = extractChineseText;
  globalThis.normalizeTextForMatching = normalizeTextForMatching;
  globalThis.isPureNumberReply = isPureNumberReply;
  globalThis.matchGapPhrase = matchGapPhrase;
  globalThis.checkAccountHeuristics = checkAccountHeuristics;
  globalThis.mergeKeywords = mergeKeywords;
  globalThis.XCleanerHeuristics = XCleanerHeuristics;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XCleanerHeuristics;
}
