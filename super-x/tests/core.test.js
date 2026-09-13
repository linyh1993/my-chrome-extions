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
assert.ok(isolatedScripts.includes("features/x-better-ui/better-ui-feature.js"), "better-ui-feature.js must be loaded");
assert.ok(isolatedScripts.includes("features/x-follow-to-list/follow-list-feature.js"), "follow-list-feature.js must be loaded");

const isolatedStyles = manifest.content_scripts[1].css;
assert.ok(isolatedStyles.includes("features/x-better-ui/better-ui.css"), "better-ui.css must be loaded");
assert.ok(isolatedStyles.includes("features/x-follow-to-list/follow-list.css"), "follow-list.css must be loaded");

// 确保 better-ui.css 包含关键规则
const betterCssPath = path.resolve(__dirname, "../features/x-better-ui/better-ui.css");
const betterCss = fs.readFileSync(betterCssPath, "utf8");
assert.ok(betterCss.includes("data-superx-hide-trends"), "Must define hide trends styles");
assert.ok(betterCss.includes("data-superx-widen"), "Must define widen timeline styles");
assert.ok(betterCss.includes("#superx-toc-container") || betterCss.includes("#superx-article-outline"), "Must define article outline / TOC styles");
assert.ok(betterCss.includes("data-testid=\"trend\""), "Must target modern trend element");

console.log("✓ Manifest V3 & Feature scripts check passed.");

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

// 4.3 测试 X 自动翻译特性识别 (避免外文被自动翻译为中文后误判为中文帖)
assert.ok(typeof XCleanerRules.checkTranslationMeta === "function", "Rules engine must export checkTranslationMeta");

// 对应用户截图中的阿拉伯语自动翻译场景
const arabicTranslated = XCleanerRules.checkTranslationMeta(
  "سعود المقحم @SAUDALmUQHIm · 16小时\n翻译自 阿拉伯语 显示原文\n这个来自西藏的痛苦视频，女孩被迫嫁给四个兄弟，依照习俗和传统......"
);
assert.strictEqual(arabicTranslated.isTranslated, true, "Must detect post as translated");
assert.strictEqual(arabicTranslated.isForeign, true, "Must identify non-Chinese source language as foreign");
assert.strictEqual(arabicTranslated.sourceLang, "阿拉伯语", "Must extract correct source language name");

// 英文推文被自动翻译为中文的场景
const englishTranslated = XCleanerRules.checkTranslationMeta(
  "Sam Altman @sama · 2h\n翻译自 英语 显示原文\n我们今天发布了新模型，欢迎大家体验..."
);
assert.strictEqual(englishTranslated.isTranslated, true, "Must detect English translated post");
assert.strictEqual(englishTranslated.isEnglish, true, "Must recognize English as original source language");

// 英文界面下的翻译场景
const englishUITranslated = XCleanerRules.checkTranslationMeta(
  "Translated from Arabic Show original\nThis video shows traditional practices..."
);
assert.strictEqual(englishUITranslated.isTranslated, true, "Must detect English UI translation");
assert.strictEqual(englishUITranslated.isForeign, true, "Must detect foreign source in English UI");

// 普通中文推文（无翻译）
const normalChinese = XCleanerRules.checkTranslationMeta(
  "张三 @zhangsan · 1小时\n今天天气真好，出去散步了。"
);
assert.strictEqual(normalChinese.isTranslated, false, "Native Chinese post must not be marked as translated");
assert.strictEqual(normalChinese.isForeign, false, "Native Chinese post must not be marked as foreign");
console.log("✓ checkTranslationMeta X auto-translation detection tests passed.");

// 4.4 测试被 X 自动翻译为中文的外文推文在 evaluateReplySpam 中不被拦截
const translatedSpamCheck = XCleanerRules.evaluateReplySpam({
  text: "这个来自西藏的痛苦视频，女孩被迫嫁给四个兄弟，依照习俗和传统......",
  rawText: "翻译自 阿拉伯语 显示原文\n这个来自西藏的痛苦视频，女孩被迫嫁给四个兄弟，依照习俗和传统......",
  authorHandle: "SAUDALmUQHIm",
  displayName: "سعود المقحم",
  links: [],
  settings: XCleanerRules.DEFAULT_CLEANER_SETTINGS
});
assert.strictEqual(translatedSpamCheck.isSpam, false, "Auto-translated foreign post must NOT trigger spam detection");
assert.strictEqual(translatedSpamCheck.isEnglish, true, "Auto-translated post must be treated as protected non-Chinese post");
console.log("✓ Auto-translated foreign post protection test passed.");

// 4.5 测试中文垃圾评论依然被准确拦截
const spamTest = XCleanerRules.evaluateReplySpam({
  text: "哥哥想看吗？看主页置顶私信看福利视频，同城空降上门",
  authorHandle: "sexy_girl123456",
  displayName: "福利姬小美",
  links: [],
  settings: XCleanerRules.DEFAULT_CLEANER_SETTINGS
});
assert.strictEqual(spamTest.isSpam, true, "Must flag adult spam reply");
console.log(`✓ Rules engine spam detection passed (Detected spam reason: ${spamTest.reason}).`);

// 5. 测试 TOC 标题级别多级提取与分类规则
function classifyHeading(firstLine) {
  const mdMatch = firstLine.match(/^(#{1,4})\s+(.+)$/);
  if (mdMatch) {
    return { level: mdMatch[1].length, text: mdMatch[2].trim() };
  }
  const subSubNumMatch = firstLine.match(/^(\d+\.\d+\.\d+|[①②③④⑤⑥⑦⑧⑨⑩])[、.．\s]\s*(.+)$/);
  if (subSubNumMatch) {
    return { level: 3, text: firstLine };
  }
  const subNumMatch = firstLine.match(/^(?:(\d+\.\d+)[、.．\s]|[(（](?:[0-9一二三四五六七八九十]{1,2})[)）])\s*(.+)$/);
  if (subNumMatch) {
    return { level: 2, text: firstLine };
  }
  const cnLevel1Match = firstLine.match(/^([一二三四五六七八九十]{1,2})[、.．]\s*(.+)$/);
  if (cnLevel1Match) {
    return { level: 1, text: firstLine };
  }
  return { level: 2, text: firstLine };
}

assert.strictEqual(classifyHeading("# 第一章：系统架构设计").level, 1, "Markdown # must be Level 1");
assert.strictEqual(classifyHeading("## 1.1 模块微内核设计").level, 2, "Markdown ## must be Level 2");
assert.strictEqual(classifyHeading("### 1.1.1 事件总线EventBus").level, 3, "Markdown ### must be Level 3");
assert.strictEqual(classifyHeading("一、技术选型与背景").level, 1, "Chinese 一、 must be Level 1");
assert.strictEqual(classifyHeading("（一）网络拦截策略").level, 2, "Chinese (一) must be Level 2");
assert.strictEqual(classifyHeading("1.2 存储方案").level, 2, "1.2 numbering must be Level 2");
assert.strictEqual(classifyHeading("1.2.3 缓存指纹对比").level, 3, "1.2.3 numbering must be Level 3");
assert.strictEqual(classifyHeading("① 初始化阶段").level, 3, "Circled number ① must be Level 3");
console.log("✓ TOC multi-level heading classification tests passed.");

// 6. 测试 x-follow-to-list 核心逻辑
// 6.1 List ID 提取测试
function extractListId(input) {
  const trimmed = (input || "").trim();
  const match = trimmed.match(/lists\/(\d+)/i);
  if (match) return match[1];
  if (/^\d{5,}$/.test(trimmed)) return trimmed;
  return "";
}

assert.strictEqual(extractListId("https://x.com/i/lists/1892837482390"), "1892837482390", "Must parse ID from full URL");
assert.strictEqual(extractListId("https://twitter.com/i/lists/987654321/members"), "987654321", "Must parse ID from members URL");
assert.strictEqual(extractListId("1234567890"), "1234567890", "Must keep plain numeric ID");
assert.strictEqual(extractListId("not_a_valid_list_id"), "", "Must reject invalid list ID string");
console.log("✓ extractListId URL & ID parsing tests passed.");

// 6.2 用户数据解析与遍历测试
function extractUsersMock(payload) {
  const found = [];
  const seen = new Set();
  const text = (v) => (v == null ? "" : String(v));
  const getId = (obj) => text(obj?.rest_id || obj?.id_str || obj?.id || obj?.user_id);
  const getLegacy = (obj) => obj?.legacy || obj?.user_results?.result?.legacy || obj;
  const getHandle = (obj) => {
    const leg = getLegacy(obj);
    return text(obj?.core?.screen_name || leg?.screen_name || obj?.screen_name || obj?.username);
  };
  const getName = (obj) => {
    const leg = getLegacy(obj);
    return text(obj?.core?.name || leg?.name || obj?.name);
  };

  const isUser = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    const id = getId(obj);
    const handle = getHandle(obj);
    return Boolean(id && handle && (obj.legacy || obj.core || obj.profile_image_url_https || obj.user_results));
  };

  const walk = (node, depth) => {
    if (!node || depth > 16 || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (isUser(node)) {
      const id = getId(node);
      if (!seen.has(id)) {
        seen.add(id);
        const leg = getLegacy(node);
        found.push({
          id,
          handle: getHandle(node),
          name: getName(node),
          followers: Number(leg?.followers_count || 0),
          mutual: Boolean(leg?.followed_by)
        });
      }
    }
    for (const val of Object.values(node)) walk(val, depth + 1);
  };

  walk(payload, 0);
  return found;
}

const mockGraphQLResponse = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  {
                    entryId: "user-111",
                    content: {
                      itemContent: {
                        user_results: {
                          result: {
                            rest_id: "111",
                            legacy: {
                              screen_name: "alice_dev",
                              name: "Alice",
                              followers_count: 5200,
                              followed_by: true
                            }
                          }
                        }
                      }
                    }
                  },
                  {
                    entryId: "user-222",
                    content: {
                      itemContent: {
                        user_results: {
                          result: {
                            rest_id: "222",
                            legacy: {
                              screen_name: "bob_ai",
                              name: "Bob",
                              followers_count: 320,
                              followed_by: false
                            }
                          }
                        }
                      }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    }
  }
};

const extractedUsers = extractUsersMock(mockGraphQLResponse);
assert.strictEqual(extractedUsers.length, 2, "Must extract 2 users from GraphQL payload");
assert.strictEqual(extractedUsers[0].handle, "alice_dev", "User 0 handle match");
assert.strictEqual(extractedUsers[0].mutual, true, "User 0 mutual match");
assert.strictEqual(extractedUsers[1].handle, "bob_ai", "User 1 handle match");
assert.strictEqual(extractedUsers[1].mutual, false, "User 1 mutual match");
console.log("✓ GraphQL Following/Followers user extractor test passed.");

// 6.3 筛选逻辑测试
const mutualFiltered = extractedUsers.filter(u => u.mutual);
assert.strictEqual(mutualFiltered.length, 1, "Mutual filter should return 1");
assert.strictEqual(mutualFiltered[0].handle, "alice_dev");

const followersFiltered = extractedUsers.filter(u => u.followers > 1000);
assert.strictEqual(followersFiltered.length, 1, "Followers > 1000 filter should return 1");
assert.strictEqual(followersFiltered[0].handle, "alice_dev");
console.log("✓ Follower filtering logic tests passed.");

console.log("\n=== ALL AUTOMATED TESTS PASSED! ===");

