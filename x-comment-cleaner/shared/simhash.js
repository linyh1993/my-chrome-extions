/**
 * X Spam Reply Cleaner - 64-bit SimHash Fuzzy Fingerprinting Module
 * Pure mathematical / algorithmic module. Zero external dependencies.
 */

const SIMHASH_HAMMING_THRESHOLD = 5;
const MAX_TOKEN_WEIGHT = 8;
const MIN_FINGERPRINT_LENGTH = 6;

/**
 * Standardize text specifically for fuzzy tokenization comparison
 */
function normalizeForSimhash(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/@[\w_]+/g, '')
    .replace(/[\s\p{Emoji}\u200d\uFE0F\d.,!?;:，。！？；：_~`@#$%^&*()+\-=[\]{}|\\/<>'"“”‘’\u200B-\u200D\uFEFF]+/gu, '')
    .trim();
}

/**
 * Tokenize normalized text into 2-4 character n-grams
 */
function simhashTokens(text) {
  const normalized = normalizeForSimhash(text);
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

const XCleanerSimhash = {
  SIMHASH_HAMMING_THRESHOLD,
  normalizeForSimhash,
  simhashTokens,
  textToSimhash,
  hammingDistance,
  simhashToHex,
  simhashFromHex
};

if (typeof globalThis !== 'undefined') {
  globalThis.SIMHASH_HAMMING_THRESHOLD = SIMHASH_HAMMING_THRESHOLD;
  globalThis.simhashTokens = simhashTokens;
  globalThis.textToSimhash = textToSimhash;
  globalThis.hammingDistance = hammingDistance;
  globalThis.simhashToHex = simhashToHex;
  globalThis.simhashFromHex = simhashFromHex;
  globalThis.XCleanerSimhash = XCleanerSimhash;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XCleanerSimhash;
}
