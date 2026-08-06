# Architecture Discussion

## 背景

用户经常在免费 AI chat 平台上对话，希望把这些 conversation 自动保留到本地。首批关注平台：

- DeepSeek: `https://chat.deepseek.com/`
- YuanBao: `https://yuanbao.tencent.com/`
- Google AI Studio: `https://aistudio.google.com/`
- Gemini: `https://gemini.google.com/`

竞品参考是 [saveai.net](https://saveai.net/) / AI Exporter。它偏 “manual export + multi-format + Notion + sidebar collection”。本项目偏 “automatic local archive first”。

## 核心认知

Automatic capture 和 manual capture 是同一个 capture capability，只是 trigger 不同。不要创建两套 capture pipeline。

```text
Trigger Layer
  -> Capture Orchestrator
  -> Site Adapter
  -> Extractor
  -> Normalizer
  -> Deduper / Revision Manager
  -> Local Sink
```

## Trigger Layer

Trigger 只负责决定何时调用 capture engine。

- `manual-click`：用户在 popup / side panel 中点击保存当前 conversation。
- `manual-selection`：用户保存选中的 messages。
- `manual-single-message`：用户保存单条 message。
- `auto-page-detected`：content script 判断当前页面是支持的 chat page。
- `auto-dom-mutated`：message list 发生变化。
- `auto-route-changed`：SPA route 或 conversation id 变化。
- `auto-conversation-settled`：streaming message 稳定一段时间。
- `manual-resync`：用户手动补齐当前 conversation。

## Capture Orchestrator

统一入口：

```js
capture({
  platform,
  tabId,
  reason,
  scope
});
```

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
  getConversationTitle() {},
  getMessageNodes() {},
  extractMessage(node) {}
};
```

首批 adapter：

- `deepseek`
- `yuanbao`
- `google-ai-studio`
- `gemini`

后续 adapter 可参考 SaveAI 支持列表扩展到 ChatGPT、Claude、Grok、Copilot、Perplexity、NotebookLM、Kimi、Qwen、Doubao 等。

## Normalized Data

第一版以 JSON event 为主，方便本地 append-only 保存和后续导出。

```json
{
  "type": "message.upsert",
  "platform": "gemini",
  "conversationId": "gemini:abc",
  "messageId": "msg-123",
  "role": "assistant",
  "content": [
    { "type": "markdown", "text": "..." }
  ],
  "metadata": {
    "title": "...",
    "model": null,
    "sourceUrl": "...",
    "capturedAt": "2026-08-06T03:00:00.000Z",
    "updatedAt": "2026-08-06T03:00:00.000Z"
  },
  "status": "streaming"
}
```

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

暂不做 sidebar collection、PDF template、Notion sync、platform launcher。

## Manifest / Permission 方向

必须使用 Manifest V3。

第一版倾向：

- `content_scripts` 用于 DOM 采集。
- `background.service_worker` 用于统一转发到本地 endpoint、维护状态和 retry queue。
- `permissions`: `storage`
- `host_permissions`: 只列首批 AI chat host 和本地 endpoint。

避免：

- `<all_urls>`
- `debugger` permission
- 抓取 Cookie / token
- 注入远程 JS
- 云端上传 conversation
