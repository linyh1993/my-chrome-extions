/**
 * X Spam Reply Cleaner - Unified Rules Engine Facade
 * 
 * Orchestrates:
 * 1. Whitelist Protection
 * 2. Pure Number Comment Filter
 * 3. Categorized Keyword Packs & max_gap Multi-Phrase Rules
 * 4. Bot Mention Patterns
 * 5. Heuristic Regex
 * 6. SimHash Fuzzy Variant & Copypasta Trackers
 * 7. Author Display Name Checks
 * 8. Account & Link Heuristics
 */

// Load dependencies depending on runtime environment
let packsModule, simhashModule, heuristicsModule;

if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  packsModule = require('./packs.js');
  simhashModule = require('./simhash.js');
  heuristicsModule = require('./heuristics.js');
} else {
  packsModule = globalThis.XCleanerPacks || {};
  simhashModule = globalThis.XCleanerSimhash || {};
  heuristicsModule = globalThis.XCleanerHeuristics || {};
}

const KEYWORD_PACKS = packsModule.KEYWORD_PACKS || [];
const X_SPAM_PATTERNS = packsModule.X_SPAM_PATTERNS || [];
const DEFAULT_CLEANER_SETTINGS = packsModule.DEFAULT_CLEANER_SETTINGS || {};
const X_SPAM_DICTIONARY = packsModule.X_SPAM_DICTIONARY || [];

const { textToSimhash, hammingDistance, simhashTokens, simhashToHex, simhashFromHex, normalizeForSimhash } = simhashModule;
const { normalizeHandle, extractChineseText, normalizeTextForMatching, isPureNumberReply, matchGapPhrase, checkAccountHeuristics, mergeKeywords } = heuristicsModule;

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
    // Exact duplicate tracker
    if (cfg.filterDuplicates && duplicateTracker) {
      const compText = (typeof normalizeForSimhash === 'function') ? normalizeForSimhash(text) : text.trim().toLowerCase();
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
    if (cfg.filterSimhash && simhashTracker && typeof textToSimhash === 'function') {
      const hash = textToSimhash(text);
      if (hash !== null) {
        let matchedHash = null;
        for (const [knownHash, knownAuthors] of simhashTracker.entries()) {
          const dist = hammingDistance(hash, knownHash);
          if (dist <= simhashModule.SIMHASH_HAMMING_THRESHOLD) {
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
  if (cfg.filterHeuristics && typeof checkAccountHeuristics === 'function') {
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

const XCleanerRules = {
  KEYWORD_PACKS,
  X_SPAM_DICTIONARY,
  X_SPAM_PATTERNS,
  DEFAULT_CLEANER_SETTINGS,
  simhashTokens,
  textToSimhash,
  hammingDistance,
  simhashToHex,
  simhashFromHex,
  normalizeHandle,
  extractChineseText,
  normalizeTextForMatching,
  isPureNumberReply,
  matchGapPhrase,
  checkAccountHeuristics,
  evaluateTextAgainstPacks,
  evaluateReplySpam,
  mergeKeywords
};

if (typeof globalThis !== 'undefined') {
  globalThis.XCleanerRules = XCleanerRules;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XCleanerRules;
}
