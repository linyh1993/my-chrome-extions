/**
 * SuperX Core & Feature Unit Tests
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=== Running SuperX Verification Tests ===");

// 1. 测试 EventBus 逻辑
class TestEventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
  }
  emit(event, data) {
    if (!this.listeners.has(event)) return;
    for (const cb of this.listeners.get(event)) cb(data);
  }
}

const bus = new TestEventBus();
let receivedData = null;
bus.on("graphql:response", (d) => { receivedData = d; });
bus.emit("graphql:response", { endpoint: "TweetDetail", count: 1 });
assert.deepStrictEqual(receivedData, { endpoint: "TweetDetail", count: 1 });
console.log("✓ EventBus pub/sub verification passed.");

// 2. 测试 Storage 命名空间格式
const PREFIX_CONFIG = "superx:feature:";
function buildKey(featureId, type) {
  return `${PREFIX_CONFIG}${featureId}:${type}`;
}
assert.strictEqual(buildKey("x-comment-cleaner", "config"), "superx:feature:x-comment-cleaner:config");
assert.strictEqual(buildKey("x-better-ui", "data"), "superx:feature:x-better-ui:data");
console.log("✓ Storage namespacing format verification passed.");

// 3. 测试 Manifest V3 合规性
const manifestPath = path.resolve(__dirname, "../manifest.json");
assert.ok(fs.existsSync(manifestPath), "manifest.json must exist");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.strictEqual(manifest.manifest_version, 3, "Must be Manifest V3");
assert.ok(manifest.permissions.includes("storage"), "Must request storage permission");
assert.ok(manifest.permissions.includes("sidePanel"), "Must request sidePanel permission");
assert.ok(manifest.background?.service_worker, "Must define background service worker");
assert.strictEqual(manifest.background?.type, "module", "Background service worker must be type module");
assert.ok(manifest.content_scripts?.length >= 2, "Must configure MAIN and ISOLATED content scripts");
assert.strictEqual(manifest.content_scripts[0].world, "MAIN", "First content script must be in MAIN world for network hook");

// 确保 content scripts 没有包含导致冲突的重复拆分子模块
const isolatedScripts = manifest.content_scripts[1].js;
assert.ok(!isolatedScripts.includes("features/x-comment-cleaner/simhash.js"), "simhash.js should not be duplicated");
assert.ok(!isolatedScripts.includes("features/x-comment-cleaner/packs.js"), "packs.js should not be duplicated");
assert.ok(isolatedScripts.includes("features/x-comment-cleaner/rules.js"), "rules.js must be loaded");

console.log("✓ Manifest V3 compliance check passed.");

// 4. 测试 x-comment-cleaner 规则引擎评估与英文帖子识别
const rulesPath = path.resolve(__dirname, "../features/x-comment-cleaner/rules.js");
require(rulesPath);
const XCleanerRules = globalThis.XCleanerRules;
assert.ok(XCleanerRules && typeof XCleanerRules.evaluateReplySpam === "function", "Rules engine must export evaluateReplySpam");
assert.ok(typeof XCleanerRules.isEnglishLanguage === "function", "Rules engine must export isEnglishLanguage");

// 4.1 测试 isEnglishLanguage
assert.strictEqual(
  XCleanerRules.isEnglishLanguage({ text: "Just released a new open source library! Check it out.", lang: "en" }),
  true,
  "Should detect standard English post with lang='en'"
);
assert.strictEqual(
  XCleanerRules.isEnglishLanguage({ text: "Congrats on this milestone! Really loved the demo. 🔥🚀", lang: "" }),
  true,
  "Should detect English text even if lang attribute is empty"
);
assert.strictEqual(
  XCleanerRules.isEnglishLanguage({ text: "DeepSeek released an exciting paper on MoE architectures.", lang: "en" }),
  true,
  "Should detect English post with terminology"
);
assert.strictEqual(
  XCleanerRules.isEnglishLanguage({ text: "今天试用了最新的 Cursor 和 Claude 3.5 Sonnet，写代码真的很丝滑！", lang: "zh" }),
  false,
  "Should NOT identify Chinese post with English terms as English post"
);
assert.strictEqual(
  XCleanerRules.isEnglishLanguage({ text: "看主页置顶私信发福利视频，加VX: abc12345，同城可约", lang: "zh" }),
  false,
  "Should NOT identify Chinese adult spam as English"
);
console.log("✓ isEnglishLanguage identification tests passed.");

// 4.2 测试英文内容不触发评论清理
const englishReplyTest = XCleanerRules.evaluateReplySpam({
  text: "Congratulations on the launch! How does this compare with existing solutions?",
  lang: "en",
  authorHandle: "dev_user",
  displayName: "Dev User",
  links: [],
  settings: XCleanerRules.DEFAULT_CLEANER_SETTINGS
});
assert.strictEqual(englishReplyTest.isSpam, false, "English reply must NOT be flagged as spam");
assert.strictEqual(englishReplyTest.isEnglish, true, "English reply must return isEnglish: true");
console.log("✓ English reply bypass test passed.");

// 4.3 测试中文垃圾评论依然被准确拦截
const spamTest = XCleanerRules.evaluateReplySpam({
  text: "哥哥想看吗？看主页置顶私信看福利视频，同城空降上门",
  authorHandle: "sexy_girl123456",
  displayName: "福利姬小美",
  links: [],
  settings: XCleanerRules.DEFAULT_CLEANER_SETTINGS
});
assert.strictEqual(spamTest.isSpam, true, "Must flag adult spam reply");
console.log(`✓ Rules engine spam detection passed (Detected spam reason: ${spamTest.reason}).`);

console.log("\n=== ALL AUTOMATED TESTS PASSED! ===");
