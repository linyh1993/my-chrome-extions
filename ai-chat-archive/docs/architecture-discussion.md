# Architecture Discussion

## 背景

用户经常在免费 AI chat 平台上对话，希望把这些 conversation 自动保留到本地。首批关注平台：

- DeepSeek: `https://chat.deepseek.com/`
- YuanBao: `https://yuanbao.tencent.com/`
- Google AI Studio: `https://aistudio.google.com/`
- Gemini: `https://gemini.google.com/`

竞品参考是 [saveai.net](https://saveai.net/) / AI Exporter。它偏 “manual export + multi-format + Notion + sidebar collection”。本项目偏 “automatic local archive first”。

## 架构概览

系统只有一套 capture pipeline。Manual trigger、automatic trigger、selection trigger 和 single-message trigger 都调用同一个 capture engine，只在触发来源和 capture scope 上不同。

```text
Trigger Layer
  -> Capture Orchestrator
  -> Content Capture Runtime
  -> Site Adapter / Extractor
  -> Normalizer
  -> Event Queue
  -> Local Sink Client
```

MV3 执行边界：

- Content script 负责 DOM detection、message extraction、streaming 状态判断和 selection 映射。
- Extension service worker 不读取 DOM，只负责 tab 调度、配置、持久化 retry queue、本地 endpoint 转发和状态广播。
- Local archive service 负责落盘、幂等 upsert、SQLite index 和 Markdown export。

## Trigger Layer

Trigger 只负责决定何时调用 capture engine。

- `manual-click`：用户在 popup 中点击保存当前 conversation。
- `manual-selection`：用户保存选中的 messages。
- `manual-single-message`：用户保存单条 message。
- `auto-page-detected`：content script 判断当前页面是支持的 chat page。
- `auto-dom-mutated`：message list 发生变化。
- `auto-route-changed`：SPA route 或 conversation id 变化。
- `auto-conversation-settled`：streaming message 稳定一段时间。
- `manual-resync`：用户手动补齐当前 conversation。

## Capture Policy

第一版采用 per-site auto capture policy：

- Auto capture 默认按 site 开关控制；首批 site 可默认 enabled，但 popup 必须能关闭当前 site。
- `auto-page-detected` 只在当前 chat page 建立 watcher，并触发一次 current conversation snapshot，不主动加载历史 conversation。
- `auto-dom-mutated` 只捕获新增或变化的 visible messages。
- 不自动遍历 side navigation、history list、pagination 或 lazy-loaded old messages。
- 本地服务 offline 时继续生成 events，但进入持久化 queue；popup 显示 backlog 和最近错误。
- 用户可以通过 `manual-resync` 对当前 conversation 做完整 DOM snapshot，用于补齐自动采集漏掉的可见内容。

## Capture Orchestrator

统一入口：

```js
capture({
  platform,
  tabId,
  reason,
  scope,
  requestedBy
});
```

运行方式：

- Popup / service worker 发起 manual capture 时，通过 `chrome.tabs.sendMessage` 请求目标 tab 的 content script 执行 capture。
- Auto triggers 由 content script 内部产生，直接调用 content-side capture runtime。
- Content script 完成 extraction 和 normalization 后，把 events 发给 service worker。
- Service worker 不调用 adapter，也不接收 DOM node。

`scope` 类型：

- `conversation`：抓当前完整 conversation。
- `messages`：抓新增或变化的 messages。
- `selection`：抓用户选中的 messages。
- `single-message`：抓单条 message。

## Site Adapter

每个平台一个 adapter，隔离 DOM selector 和平台差异。

```js
const adapter = {
  id: "gemini",
  label: "Gemini",
  matches: ["https://gemini.google.com/*"],
  detectPage() {},
  getConversationId() {},
  getConversationKey() {},
  getConversationTitle() {},
  getMessageNodes() {},
  getMessageKey(node) {},
  getMessageRole(node) {},
  isStreaming(node) {},
  getVisibleRange() {},
  extractMessage(node) {}
};
```

首批 adapter：

- `deepseek`
- `yuanbao`
- `google-ai-studio`
- `gemini`

后续 adapter 可参考 SaveAI 支持列表扩展到 ChatGPT、Claude、Grok、Copilot、Perplexity、NotebookLM、Kimi、Qwen、Doubao 等。

第一版 DOM 边界：

- 只采集当前 DOM 中可见或已渲染的 messages。
- 不主动 scroll、load more 或展开历史记录。
- 如遇 iframe / shadow DOM / virtualized list，adapter 必须显式声明支持情况；不支持时返回 partial capture 状态。
- Selection capture 只支持能映射回 message node 的选择；无法映射时拒绝并在 popup 提示。
- Attachments / images 第一版可记录 metadata 和可见 URL，不保证下载二进制内容。

## ID 与 Revision 策略

优先级：

1. 平台 DOM 或 URL 中存在稳定 id 时，使用平台 id。
2. 否则生成 deterministic key：
   - `conversationId = platform + normalizedUrlConversationKey`
   - `messageId = conversationId + role + domOrder + firstStableContentHash`
3. Streaming message 在 final 前保留同一个 `messageId`，用 `revision` 递增表示内容变化。
4. `manual-resync` 以同一 id 策略 upsert，不创建平行 message。

如果 conversation URL 无法区分不同会话，adapter 必须返回 `confidence: "low"`，并在 event metadata 中标记。

## Normalized Data

第一版以 JSON event 为主，方便本地 append-only 保存和后续导出。

Conversation event：

```json
{
  "type": "conversation.upsert",
  "eventId": "evt-...",
  "schemaVersion": 1,
  "platform": "gemini",
  "conversationId": "gemini:abc",
  "title": "...",
  "sourceUrl": "...",
  "adapterVersion": "gemini-dom-v1",
  "capturedAt": "2026-08-06T03:00:00.000Z"
}
```

Message event：

```json
{
  "type": "message.upsert",
  "eventId": "evt-...",
  "schemaVersion": 1,
  "platform": "gemini",
  "conversationId": "gemini:abc",
  "messageId": "msg-123",
  "revision": 3,
  "role": "assistant",
  "content": [
    { "type": "markdown", "text": "..." }
  ],
  "metadata": {
    "model": null,
    "sourceUrl": "...",
    "adapterVersion": "gemini-dom-v1",
    "capturedAt": "2026-08-06T03:00:00.000Z",
    "updatedAt": "2026-08-06T03:00:00.000Z"
  },
  "status": "streaming"
}
```

Capture lifecycle events：

- `capture.started`
- `capture.completed`
- `capture.failed`
- `sink.failed`

## Streaming 处理

Assistant response streaming 时不要每个 token 写一条最终记录。

- DOM 变化时 upsert 同一个 `messageId`。
- 短 debounce 后发送 draft update。
- 稳定一段时间后标记 `final`。
- 用户手动 resync 时以完整 conversation snapshot 补齐漏采。

## Local Sink

Chrome Extension 不直接写文件，交给本机服务。

```text
content script
  -> service worker
  -> http://127.0.0.1:9090/ai-chat/events
  -> local archive service
  -> JSONL / SQLite / Markdown export
```

Local endpoint：

- 默认只使用 `http://127.0.0.1:9090/ai-chat/events`。
- `http://localhost:9090/*` 是否支持由设置显式开启。
- Content script 不直接请求本地服务；统一由 service worker 发起。

Retry queue：

- Queue 存在 `chrome.storage.local` 或 IndexedDB，不依赖 service worker 全局内存。
- 每个 event 必须有稳定 `eventId`，local archive service 按 `eventId` 幂等处理。
- 失败时记录 `attemptCount`、`lastAttemptAt`、`nextAttemptAt`、`lastError`。
- 使用指数退避并设置最大 backlog；超过上限时 popup 显示阻塞状态，不静默丢弃。
- Service worker 启动、local service online probe 成功、用户点击 retry 时触发 flush。

第一版优先：

- JSONL append-only event log
- SQLite message index
- Markdown export

## UI Scope

第一版 popup 只显示状态和开关：

- 当前 site 是否 supported
- 是否检测到 conversation
- 是否正在采集
- local service 是否 online
- 当前 site 是否启用 auto capture
- 最近保存数量 / 最近错误
- retry backlog 数量和手动 retry
- `Save current chat` / `Resync current chat`

暂不做 sidebar collection、PDF template、Notion sync、platform launcher。

## Manifest / Permission 方向

必须使用 Manifest V3。

第一版倾向：

- `content_scripts` 用于 DOM 采集。
- `background.service_worker` 用于统一转发到本地 endpoint、维护状态和 retry queue。
- `permissions`: `storage`
- `host_permissions`: 只列首批 AI chat host 和 `http://127.0.0.1:9090/*`；`localhost` 作为用户设置项再加入。

避免：

- `<all_urls>`
- `debugger` permission
- 抓取 Cookie / token
- 注入远程 JS
- 云端上传 conversation
