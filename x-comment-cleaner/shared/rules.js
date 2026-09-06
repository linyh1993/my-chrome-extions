/**
 * X Spam Reply Cleaner - Unified Rules Engine & Heuristics Core
 * 
 * Standalone pure-JS module with zero DOM / Chrome dependencies.
 * Features:
 * - 8 Curated Industry Keyword Packs with multi-gap phrase matching
 * - 64-bit SimHash Fuzzy Campaign / Copypasta Fingerprinting
 * - Account & Link Heuristics (Default user digits, spam domain hints, erogenous combos)
 * - Pure Number & Mention Pattern Detectors
 * - Whitelist & OP Protection Filters
 */

// === 1. 8 Categorized Preset Keyword Packs ===
const KEYWORD_PACKS = [
  {
    id: "adult_gray_traffic",
    name: "黄推 / 成人引流",
    description: "福利隐语、同城约会、骚话诱导、主页相册及微密圈等成人导流",
    enabled: true,
    rules: [
      "比她好看", "比她骚", "没她骚", "没她好看", "比我好看", "比我骚", "没我骚", "没我好看",
      "比我玩的开", "比我玩得开", "比我放得开", "比我放的开", "比我玩的大", "比我玩得大",
      "玩的开", "玩得开", "玩的嗨", "玩得嗨", "放得开", "放的开", "玩的大", "玩得大",
      "耐不住寂寞", "寂寞难耐", "空虚寂寞", "长夜漫漫", "深夜寂寞", "找个哥哥", "找哥哥", "有哥哥吗",
      "福不黑", "服不黑", "批不黑", "逼不黑", "鲍不黑", "不黑不信", "粉不粉", "黑不黑",
      "粉嫩", "水多", "耐操", "反差", "反差婊", "反差女", "反差母狗", "小母狗", "骚货", "骚逼", "发骚", "赔钱货",
      "约炮", "同城约", "可约", "线下约", "可线下", "线下吗", "线下找", "探花", "裸聊", "自慰", "情趣", "绿奴", "露出",
      "大秀", "福利姬", "微密圈", "无圣光", "秀人", "麻豆", "糖心", "91",
      "固泡", "急需一位固泡", "找固泡", "求固泡", "蹲固泡", "同城固",
      "主人任务", "接主人任务", "做主人任务", "认主人", "找主人",
      "男大来", "找男大", "男大进", "女大来", "找女大",
      "看主页", "看主頁", "看置顶", "看置頂", "看头像", "点头像", "点我头像", "点主页", "进主页",
      "看动态", "看相册", "私密相册", "私密视频", "精选相册", "置顶动态", "看置顶动态",
      "不信你看", "不信看", "信不信你看", "不信你来", "想看私", "想看的", "懂的都懂", "懂的来",
      "私信看福利", "私信发福利", "主页自取福利", "进主页看福利", "福利视频在主页", "福利在主页", "福利在简介",
      "全国空降", "同城空降", "同城上门", "真人上门", "少妇上门", "学生妹上门", "线下私约",
      "门槛群", "福利群", "吃瓜群", "黑料群", "大瓜", "瓜条", "夸克网盘", "解压码"
    ],
    gapRules: [
      { id: "adult-gap-door", terms: ["同城", "上门"], maxGap: 14 },
      { id: "adult-gap-hookup", terms: ["同城", "约炮"], maxGap: 14 },
      { id: "adult-gap-private", terms: ["同城", "私约"], maxGap: 14 },
      { id: "adult-gap-airdrop", terms: ["同城", "空降"], maxGap: 14 },
      { id: "adult-gap-profile", terms: ["福利", "主页"], maxGap: 10 },
      { id: "adult-gap-bio", terms: ["福利", "简介"], maxGap: 10 }
    ]
  },
  {
    id: "investment_scam",
    name: "投资 / 带单诈骗",
    description: "内幕消息、稳赚不赔、带单老师、包赚返利等金融理财诱导",
    enabled: true,
    rules: [
      "带单老师", "带单", "内幕消息", "稳赚不赔", "保本高息", "保本保息", "内部渠道",
      "包赚", "日入过万", "日收益", "跟单盈利", "一对一指导", "翻倍计划", "带你回血",
      "包赔", "高收益项目", "量化跟单", "投资回报率", "胜率99"
    ],
    gapRules: [
      { id: "invest-gap-follow", terms: ["老师", "带单"], maxGap: 12 },
      { id: "invest-gap-profit", terms: ["稳赚", "收益"], maxGap: 12 },
      { id: "invest-gap-recoup", terms: ["包赔", "回血"], maxGap: 12 }
    ]
  },
  {
    id: "crypto_scam",
    name: "加密货币 / 空投骗局",
    description: "虚假 Giveaway、免费领取 USDT/SOL/BTC、钓鱼空投与签名诈骗",
    enabled: true,
    rules: [
      "free crypto", "free bitcoin", "free eth", "free usdt", "free airdrop",
      "crypto giveaway", "usdt giveaway", "sol giveaway", "claim airdrop",
      "claim rewards", "airdrop claim", "free gift card", "免费领取usdt",
      "空投领取", "扫码领币", "钱包空投", "假空投"
    ],
    gapRules: [
      { id: "crypto-gap-giveaway", terms: ["giveaway", "usdt"], maxGap: 30 },
      { id: "crypto-gap-airdrop", terms: ["airdrop", "claim"], maxGap: 30 },
      { id: "crypto-gap-free", terms: ["free", "crypto"], maxGap: 20 }
    ]
  },
  {
    id: "task_scam",
    name: "兼职刷单 / 任务诈骗",
    description: "点赞佣金、日结手工、打字兼职、充值解锁与高薪副业诱饵",
    enabled: true,
    rules: [
      "刷单返利", "刷单", "兼职日结", "日结兼职", "佣金日结", "手工活外发",
      "点赞赚钱", "打字员", "高薪副业", "在家兼职", "无需押金", "一部手机日入",
      "动动手指", "任务佣金", "学生兼职", "宝妈兼职", "轻松日结"
    ],
    gapRules: [
      { id: "task-gap-daily", terms: ["兼职", "日结"], maxGap: 12 },
      { id: "task-gap-phone", terms: ["手机", "日入"], maxGap: 14 },
      { id: "task-gap-like", terms: ["点赞", "佣金"], maxGap: 12 }
    ]
  },
  {
    id: "loan_scam",
    name: "贷款 / 解冻诈骗",
    description: "黑白户可下、不查征信、免抵押秒批、卡单解冻等贷款话术",
    enabled: true,
    rules: [
      "黑白户", "包下款", "免抵押秒批", "征信修复", "无视征信", "秒批到账",
      "快速下款", "卡单解冻", "资金解冻", "流水不足包过", "无门槛下款", "小额贷款秒下"
    ],
    gapRules: [
      { id: "loan-gap-fast", terms: ["黑户", "下款"], maxGap: 12 },
      { id: "loan-gap-pass", terms: ["征信", "秒批"], maxGap: 12 }
    ]
  },
  {
    id: "gambling_traffic",
    name: "博彩 / 赌场引流",
    description: "彩票计划、百家乐、开奖网、真人视讯、澳门威尼斯人等引流",
    enabled: true,
    rules: [
      "百家乐", "彩票计划", "澳洲幸运", "极速赛车", "开奖网", "真人视讯",
      "威尼斯人", "太阳城", "彩票导师", "稳定出款", "大额无忧", "充值返利"
    ],
    gapRules: [
      { id: "gamble-gap-plan", terms: ["彩票", "计划"], maxGap: 12 },
      { id: "gamble-gap-cash", terms: ["稳定", "出款"], maxGap: 12 }
    ]
  },
  {
    id: "engagement_bait",
    name: "互动诱导 / 钓鱼",
    description: "互关必回、回关秒关、留号送等无意义骗粉骗互动话术",
    enabled: true,
    rules: [
      "互关必回", "回关必回", "秒关互粉", "互粉必回", "留号必发",
      "留邮箱送", "评论区抽", "转评赞送", "万粉互助"
    ],
    gapRules: [
      { id: "engage-gap-follow", terms: ["互关", "必回"], maxGap: 8 },
      { id: "engage-gap-email", terms: ["留", "邮箱"], maxGap: 8 }
    ]
  },
  {
    id: "general_marketing",
    name: "通用营销 / 私域引流",
    description: "加微信、私域变现、引流脚本、群发软件等营销广告",
    enabled: true,
    rules: [
      "加v", "加V", "加vx", "加VX", "加微", "加🛰", "加卫星", "卫星号", "卫星：",
      "威信", "薇信", "唯心", "维信", "v信", "➕v", "➕V", "➕vx", "➕微", "＋v", "＋V", "🛰️", "🛰",
      "私域流量", "引流脚本", "微信群发", "爆粉软件", "被动引流", "私我进群"
    ],
    gapRules: [
      { id: "mkt-gap-wechat", terms: ["微信", "私信"], maxGap: 12 },
      { id: "mkt-gap-group", terms: ["进群", "私我"], maxGap: 10 }
    ]
  }
];

// Flat default keywords list for backward compatibility
const X_SPAM_DICTIONARY = KEYWORD_PACKS.flatMap(p => p.rules);

// Heuristic Regex Patterns
const X_SPAM_PATTERNS = [
  /(?:没人|谁)比我.*(?:玩|骚|放|浪)/i,
  /(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i,
  /(?:看主页|看置顶|看相册|私信我|进群).*(?:福利|无门槛|吃瓜|资源|相册)/i,
  /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u,
  /(?:比她|好看|骚|看主|置顶|资源|私聊|福利|主页|吃瓜).*@[\w_]{3,20}/i,
  /\b(?:dm|pm)\s+(?:me|us)\b[\s\S]{0,40}\b(?:invest|crypto|profit|earn|signal)/i,
  /\b\d{1,7}\s*(?:usdt|usdc|btc|eth|sol|trx)\b[\s\S]{0,80}g[i1](?:v|w)?e?away/i
];

const DEFAULT_CLEANER_SETTINGS = {
  enabled: true,
  hideMode: "collapse", // 'collapse' or 'hide'
  // Rule feature toggles
  filterKeywords: true,
  filterHomophones: true,
  filterPureNumbers: true,
  filterMentionSpam: true,
  filterDuplicates: true,
  filterSimhash: true,
  filterHeuristics: true,
  // Pack toggles: packId -> boolean
  packSettings: {
    adult_gray_traffic: true,
    investment_scam: true,
    crypto_scam: true,
    task_scam: true,
    loan_scam: true,
    gambling_traffic: true,
    engagement_bait: true,
    general_marketing: true
  },
  // Custom keywords array
  customKeywords: [],
  // User whitelist (handles without @ in lowercase)
  whitelist: [],
  // Statistics
  blockedCount: 0,
  blockedAccountsHistory: []
};

// === 2. SimHash 64-bit Fuzzy Fingerprinting ===
const SIMHASH_HAMMING_THRESHOLD = 2;
const MAX_TOKEN_WEIGHT = 8;
const MIN_FINGERPRINT_LENGTH = 6;

/**
 * Tokenize normalized text into 2-4 character n-grams
 */
function simhashTokens(text) {
  const normalized = normalizeTextForComparison(text);
  if (normalized.length < MIN_FINGERPRINT_LENGTH) {
    return [];
  }
  const grams = [];
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= normalized.length - n; i++) {
      grams.push(normalized.slice(i, i + n));
    }
  }
  return grams;
}

/**
 * Generate 64-bit SimHash bit vector (BigInt) from text
 */
function textToSimhash(text) {
  const tokens = simhashTokens(text);
  if (tokens.length === 0) return null;

  const counts = new Map();
  for (const t of tokens) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }

  const weights = [];
  for (const [token, count] of counts) {
    const w = Math.min(count, MAX_TOKEN_WEIGHT);
    if (w <= 0) continue;

    let h = 0x35b5e5a7n;
    for (let i = 0; i < token.length; i++) {
      h ^= BigInt(token.charCodeAt(i)) * 0x100000001b3n;
      h = (h >> 8n) | (h << 56n);
    }
    weights.push({ hash: h & 0xffffffffffffffffn, weight: w });
  }

  const bits = new Array(64).fill(0);
  for (const { hash, weight } of weights) {
    for (let b = 0; b < 64; b++) {
      if ((hash >> BigInt(b)) & 1n) {
        bits[b] += weight;
      } else {
        bits[b] -= weight;
      }
    }
  }

  let result = 0n;
  for (let b = 63; b >= 0; b--) {
    result = (result << 1n) | (bits[b] > 0 ? 1n : 0n);
  }
  return result;
}

/**
 * Calculate Hamming distance between two 64-bit BigInts
 */
function hammingDistance(a, b) {
  let diff = a ^ b;
  let count = 0;
  while (diff !== 0n) {
    diff &= diff - 1n;
    count++;
  }
  return count;
}

function simhashToHex(value) {
  if (typeof value !== 'bigint') return '';
  return value.toString(16).padStart(16, '0');
}

function simhashFromHex(hex) {
  if (!hex || !/^[0-9a-f]{16}$/i.test(hex)) return null;
  return BigInt(`0x${hex}`);
}

// === 3. Account & Domain Heuristics ===
const DEFAULT_NAME_RE = /^(?:user|用户)[\s\u00a0]*\d{5,}$/i;
const DIGIT_TAIL_HANDLE_RE = /^[a-z]{1,10}\d{5,}$/i;
const SPAM_HOST_HINT_RE = /(?:giveaway|airdrop|freecrypto|freegift|claimrewards?|t\.me\/|linktr\.ee)/i;

const EROGENOUS_MARKERS = [
  [/涩|色色/, "涩"],
  [/没我骚|比我[^。]{0,8}骚|极品骚/, "骚"],
  [/玩[得的]{1,2}更?开|玩[得的]{1,2}大/, "玩得开"],
  [/[🍑🍒🍆💧💋🌹🔞]/u, "擦边emoji"]
];

/**
 * Check account and external link heuristics
 */
function checkAccountHeuristics({ handle = '', displayName = '', links = [], bio = '', text = '' } = {}) {
  const normHandle = handle.replace(/^@+/, '').trim();
  const trimName = displayName.trim();

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

// === 4. Text Normalization & Gap Phrase Matcher ===

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

function normalizeTextForComparison(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/@[\w_]+/g, '')
    .replace(/[\s\p{Emoji}\u200d\uFE0F\d.,!?;:，。！？；：_~`@#$%^&*()+\-=[\]{}|\\/<>'"“”‘’\u200B-\u200D\uFEFF]+/gu, '')
    .trim();
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

// === 5. Full Spam Evaluation Pipeline ===

/**
 * Evaluate reply text against active keyword packs, gap rules, and custom words
 */
function evaluateTextAgainstPacks(text, {
  packSettings = {},
  customKeywords = [],
  filterHomophones = true
} = {}) {
  if (!text || text.length < 2) return { isSpam: false };

  const lowerText = text.toLowerCase();
  const normalizedText = normalizeTextForMatching(text, filterHomophones);
  const chineseText = extractChineseText(text);

  // 1. Check active preset packs
  for (const pack of KEYWORD_PACKS) {
    if (packSettings[pack.id] === false) continue;

    // Direct keyword match
    for (const rule of pack.rules) {
      const trimmed = rule.trim();
      if (trimmed.length < 2) continue;

      const ruleCn = extractChineseText(trimmed);
      if (ruleCn && ruleCn.length >= 2 && chineseText.includes(ruleCn)) {
        return { isSpam: true, reason: `${pack.name} · ${trimmed}`, packId: pack.id };
      }

      const normRule = normalizeTextForMatching(trimmed, filterHomophones);
      if (normRule && normRule.length >= 2) {
        if (lowerText.includes(trimmed.toLowerCase()) || normalizedText.includes(normRule)) {
          return { isSpam: true, reason: `${pack.name} · ${trimmed}`, packId: pack.id };
        }
      }
    }

    // Gap rules match
    if (Array.isArray(pack.gapRules)) {
      for (const gap of pack.gapRules) {
        if (matchGapPhrase(lowerText, gap.terms, gap.maxGap) || matchGapPhrase(normalizedText, gap.terms, gap.maxGap)) {
          return { isSpam: true, reason: `${pack.name} · 组合(${gap.terms.join('+')})`, packId: pack.id };
        }
      }
    }
  }

  // 2. Check custom user keywords
  if (Array.isArray(customKeywords)) {
    for (const kw of customKeywords) {
      if (typeof kw !== 'string') continue;
      const trimmed = kw.trim();
      if (trimmed.length < 2) continue;

      if (lowerText.includes(trimmed.toLowerCase()) || normalizedText.includes(normalizeTextForMatching(trimmed, filterHomophones))) {
        return { isSpam: true, reason: `自定义词库 · ${trimmed}` };
      }
    }
  }

  return { isSpam: false };
}

/**
 * Complete reply evaluation pipeline
 */
function evaluateReplySpam({
  text = '',
  authorHandle = '',
  displayName = '',
  links = [],
  bio = '',
  settings = {},
  duplicateTracker = null,
  simhashTracker = null
} = {}) {
  const cfg = {
    ...DEFAULT_CLEANER_SETTINGS,
    ...settings
  };

  const normAuthor = normalizeHandle(authorHandle);

  // 1. Whitelist Protection
  if (normAuthor && Array.isArray(cfg.whitelist)) {
    const isWhitelisted = cfg.whitelist.some(w => normalizeHandle(w) === normAuthor);
    if (isWhitelisted) {
      return { isSpam: false, whitelisted: true };
    }
  }

  // 2. Pure number / short digit comment
  if (cfg.filterPureNumbers && text && isPureNumberReply(text)) {
    return { isSpam: true, reason: '纯数字刷屏' };
  }

  // 3. Keyword packs & gap rules check on comment text
  if (cfg.filterKeywords && text) {
    const textCheck = evaluateTextAgainstPacks(text, {
      packSettings: cfg.packSettings,
      customKeywords: cfg.customKeywords,
      filterHomophones: cfg.filterHomophones
    });
    if (textCheck.isSpam) {
      return textCheck;
    }
  }

  // 4. Mention Spam Pattern (@handle + random suffix)
  if (cfg.filterMentionSpam && text) {
    const mentionPattern = /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u;
    if (mentionPattern.test(text)) {
      return { isSpam: true, reason: 'Bot 引流艾特' };
    }
  }

  // 5. Heuristic Regex Patterns
  if (cfg.filterHomophones && text) {
    for (const pattern of X_SPAM_PATTERNS) {
      if (pattern.test(text) || pattern.test(normalizeTextForMatching(text, true))) {
        return { isSpam: true, reason: '诱导话术特征' };
      }
    }
  }

  // 6. SimHash Fuzzy Variant & Copypasta detection
  if (text) {
    // Exact/Near duplicate tracker
    if (cfg.filterDuplicates && duplicateTracker) {
      const compText = normalizeTextForComparison(text);
      if (compText.length >= 6) {
        let authors = duplicateTracker.get(compText);
        if (!authors) {
          authors = new Set();
          duplicateTracker.set(compText, authors);
        }
        if (normAuthor) authors.add(normAuthor);
        if (authors.size >= 2) {
          return { isSpam: true, reason: `重复刷屏 (${authors.size} 账号同发)` };
        }
      }
    }

    // 64-bit SimHash fuzzy matching
    if (cfg.filterSimhash && simhashTracker) {
      const hash = textToSimhash(text);
      if (hash !== null) {
        let matchedHash = null;
        for (const [knownHash, knownAuthors] of simhashTracker.entries()) {
          const dist = hammingDistance(hash, knownHash);
          if (dist <= SIMHASH_HAMMING_THRESHOLD) {
            if (normAuthor) knownAuthors.add(normAuthor);
            if (knownAuthors.size >= 2) {
              matchedHash = knownHash;
              return { isSpam: true, reason: `同款变体话术 (SimHash 相似)` };
            }
          }
        }
        if (!matchedHash) {
          const authorSet = new Set();
          if (normAuthor) authorSet.add(normAuthor);
          simhashTracker.set(hash, authorSet);
        }
      }
    }
  }

  // 7. Author Display Name check
  if (displayName && cfg.filterKeywords) {
    const nameCheck = evaluateTextAgainstPacks(displayName, {
      packSettings: cfg.packSettings,
      customKeywords: cfg.customKeywords,
      filterHomophones: cfg.filterHomophones
    });
    if (nameCheck.isSpam) {
      return { isSpam: true, reason: `昵称引流 · ${nameCheck.reason}` };
    }
  }

  // 8. Account & Link Heuristics
  if (cfg.filterHeuristics) {
    const heurCheck = checkAccountHeuristics({
      handle: normAuthor,
      displayName,
      links,
      bio,
      text
    });
    if (heurCheck.isSpam) {
      return heurCheck;
    }
  }

  return { isSpam: false };
}

// Global & CommonJS Export Container
const XCleanerRules = {
  KEYWORD_PACKS,
  X_SPAM_DICTIONARY,
  X_SPAM_PATTERNS,
  DEFAULT_CLEANER_SETTINGS,
  SIMHASH_HAMMING_THRESHOLD,
  simhashTokens,
  textToSimhash,
  hammingDistance,
  simhashToHex,
  simhashFromHex,
  normalizeHandle,
  extractChineseText,
  normalizeTextForMatching,
  normalizeTextForComparison,
  isPureNumberReply,
  matchGapPhrase,
  checkAccountHeuristics,
  evaluateTextAgainstPacks,
  evaluateReplySpam,
  mergeKeywords
};

if (typeof globalThis !== 'undefined') {
  globalThis.KEYWORD_PACKS = KEYWORD_PACKS;
  globalThis.X_SPAM_DICTIONARY = X_SPAM_DICTIONARY;
  globalThis.X_SPAM_PATTERNS = X_SPAM_PATTERNS;
  globalThis.DEFAULT_CLEANER_SETTINGS = DEFAULT_CLEANER_SETTINGS;
  globalThis.XCleanerRules = XCleanerRules;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XCleanerRules;
}
