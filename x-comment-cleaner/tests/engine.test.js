/**
 * X Spam Reply Cleaner - Automated Engine & Rules Regression Suite
 * Run with: node x-comment-cleaner/tests/engine.test.js
 */

const assert = require('assert');
const { KEYWORD_PACKS, DEFAULT_CLEANER_SETTINGS } = require('../shared/packs.js');
const { textToSimhash, hammingDistance, simhashTokens, SIMHASH_HAMMING_THRESHOLD } = require('../shared/simhash.js');
const { normalizeHandle, extractChineseText, matchGapPhrase, checkAccountHeuristics, isPureNumberReply } = require('../shared/heuristics.js');
const { evaluateReplySpam, evaluateTextAgainstPacks } = require('../shared/rules.js');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function describe(suiteName, fn) {
  console.log(`\n\x1b[1m\x1b[34m[Suite]\x1b[0m ${suiteName}`);
  fn();
}

console.log('====================================================');
console.log('🧪 Running X Spam Reply Cleaner Verification Tests');
console.log('====================================================');

describe('1. 8 Categorized Keyword Packs Coverage', () => {
  it('should detect adult gray traffic', () => {
    const res = evaluateReplySpam({ text: '同城少妇上门可约，懂的都懂' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'adult_gray_traffic');
  });

  it('should detect investment & trading scams', () => {
    const res = evaluateReplySpam({ text: '跟着带单老师日入过万稳赚不赔，加V进群' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'investment_scam');
  });

  it('should detect crypto & giveaway scams', () => {
    const res = evaluateReplySpam({ text: 'Free 500 USDT giveaway claim airdrop now!' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'crypto_scam');
  });

  it('should detect task & part-time scams', () => {
    const res = evaluateReplySpam({ text: '点赞赚钱手工活兼职日结一部手机日入300' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'task_scam');
  });

  it('should detect loan & unfreeze scams', () => {
    const res = evaluateReplySpam({ text: '黑白户可下，无视征信秒批到账，资金解冻' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'loan_scam');
  });

  it('should detect gambling & casino traffic', () => {
    const res = evaluateReplySpam({ text: '澳门威尼斯人开奖网百家乐彩票计划真人视讯' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'gambling_traffic');
  });

  it('should detect engagement bait', () => {
    const res = evaluateReplySpam({ text: '互关必回，秒关互粉，留下邮箱必发！' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'engagement_bait');
  });

  it('should detect general marketing spam', () => {
    const res = evaluateReplySpam({ text: '私域流量引流脚本微信群发软件，加🛰️：abc1234' });
    assert.strictEqual(res.isSpam, true);
    assert.strictEqual(res.packId, 'general_marketing');
  });
});

describe('2. Ordered Phrase Gap Matching (max_gap)', () => {
  it('should match terms in forward order within gap', () => {
    const matched = matchGapPhrase('同城漂亮美女随时预约上门服务', ['同城', '上门'], 14);
    assert.strictEqual(matched, true);
  });

  it('should NOT match terms in reverse order', () => {
    const matched = matchGapPhrase('上门服务仅限同城区域', ['同城', '上门'], 14);
    assert.strictEqual(matched, false);
  });

  it('should NOT match terms exceeding maxGap distance', () => {
    const matched = matchGapPhrase('同城' + 'a'.repeat(30) + '上门', ['同城', '上门'], 10);
    assert.strictEqual(matched, false);
  });
});

describe('3. 64-bit SimHash Fuzzy Fingerprinting', () => {
  it('should generate valid 64-bit BigInt hash from text', () => {
    const hash = textToSimhash('这是一个用于测试指纹算法的基准句子用于验证');
    assert.strictEqual(typeof hash, 'bigint');
    assert(hash > 0n);
  });

  it('should identify near-identical spam templates across different bots', () => {
    const tracker = new Map();
    const t1 = '最新推出的自动化量化套利工具非常强大欢迎大家免费体验';
    const t2 = '最新推出的自动化量化套利工具非常强大欢迎大家免费体验呀！';

    const r1 = evaluateReplySpam({ text: t1, authorHandle: 'bot_alpha', simhashTracker: tracker, settings: { filterKeywords: false } });
    const r2 = evaluateReplySpam({ text: t2, authorHandle: 'bot_beta', simhashTracker: tracker, settings: { filterKeywords: false } });

    assert.strictEqual(r1.isSpam, false);
    assert.strictEqual(r2.isSpam, true);
    assert(r2.reason.includes('SimHash'));
  });

  it('should return higher hamming distance for completely different text', () => {
    const h1 = textToSimhash('今天天气真好一起去公园跑步锻炼身体健康');
    const h2 = textToSimhash('区块链智能合约开发技术实战教程深度解析');
    const dist = hammingDistance(h1, h2);
    assert(dist > SIMHASH_HAMMING_THRESHOLD);
  });
});

describe('4. Account & Domain Heuristics', () => {
  it('should catch default name + digit tail handle pattern', () => {
    const res = checkAccountHeuristics({ handle: 'ab12345678', displayName: '用户95278' });
    assert.strictEqual(res.isSpam, true);
    assert(res.reason.includes('默认名'));
  });

  it('should catch suspicious phishing & giveaway external link domains', () => {
    const res = checkAccountHeuristics({
      links: [{ href: 'https://freecrypto-airdrop.xyz', hostname: 'freecrypto-airdrop.xyz' }]
    });
    assert.strictEqual(res.isSpam, true);
    assert(res.reason.includes('可疑引流域名'));
  });

  it('should catch multiple combined erogenous markers', () => {
    const res = checkAccountHeuristics({ text: '小哥哥看我，我比她骚，玩得开哦🍑' });
    assert.strictEqual(res.isSpam, true);
    assert(res.reason.includes('擦边引流特征'));
  });

  it('should NOT false-positive on legitimate daily conversations', () => {
    const res = checkAccountHeuristics({
      handle: 'jack_developer',
      displayName: 'Jack Doe',
      text: 'This is a great software release, congratulations!'
    });
    assert.strictEqual(res.isSpam, false);
  });
});

describe('5. Protection Layers & Whitelist', () => {
  it('should exempt whitelisted user even if text matches spam keywords', () => {
    const res = evaluateReplySpam({
      text: '同城上门可约',
      authorHandle: 'trusted_friend',
      settings: { whitelist: ['trusted_friend'] }
    });
    assert.strictEqual(res.isSpam, false);
    assert.strictEqual(res.whitelisted, true);
  });

  it('should filter pure number spam', () => {
    assert.strictEqual(isPureNumberReply('5'), true);
    assert.strictEqual(isPureNumberReply('666'), true);
    assert.strictEqual(isPureNumberReply('1.'), true);
    assert.strictEqual(isPureNumberReply('+1'), true);
    assert.strictEqual(isPureNumberReply('Good 5 stars'), false);
  });
});

describe('6. Edge Cases & Robustness', () => {
  it('should safely handle empty or null parameters without throwing', () => {
    assert.doesNotThrow(() => evaluateReplySpam({}));
    assert.doesNotThrow(() => evaluateReplySpam({ text: null, authorHandle: undefined }));
    assert.doesNotThrow(() => textToSimhash(''));
    assert.doesNotThrow(() => extractChineseText(null));
  });
});

console.log('\n====================================================');
console.log(`🎉 Test Execution Complete: ${passedTests}/${totalTests} Passed.`);
console.log('====================================================\n');
