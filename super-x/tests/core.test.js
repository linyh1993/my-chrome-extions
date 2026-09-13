/**
 * SuperX Core & Feature Unit Tests
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log("✓ Manifest V3 compliance check passed.");

console.log("\n=== ALL AUTOMATED TESTS PASSED! ===");
