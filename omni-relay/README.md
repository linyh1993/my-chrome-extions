# Omni Relay

通用多平台网络流量与 DOM 数据中继器（Manifest V3 Chrome Extension）。

支持将多个平台（目前内置 **X (Twitter)** 和 **Reddit**）的原生网络请求数据流（GraphQL / API）、WebSocket 帧以及页面 DOM 结构化数据，经过统一协议信封封装后，弹性投递到本地后端服务。

---

## 特性

- ⚡ **统一中继架构**：单插件覆盖所有目标平台，统一投递通道与协议规范。
- 🌐 **网络层镜像 (CDP Network Engine)**：通过 `chrome.debugger` 无感监听网络请求与 WebSocket，抗前端 UI 改版，获取完整 Response Body。
- 🧩 **DOM 语义提取 (DOM Extractor Engine)**：针对特定页面提供高穿透力选择器解析，结合指纹比对防抖与去重。
- 🛡️ **弹性本地投递**：超时控制、指数退避重试（Backoff）、投递健康监控与防内存泄漏机制。
- 🔌 **高扩展性注册机制**：新增平台只需在 `sites-registry.js` 声明规则，即可享受完整的生命周期管理与数据中继。
- 📊 **可视化控制台 (Popup UI)**：全局与分站点独立开关、当前 Tab 实时监听状态诊断、本地连通性测试 (Ping) 与累计统计。

---

## 目录结构

```text
omni-relay/
├── manifest.json                  # MV3 清单文件
├── background/
│   └── service-worker.js         # 后台服务工作进程入口
├── core/
│   ├── sites-registry.js         # 【扩展平台核心】站点规则注册中心
│   ├── debugger-session.js       # CDP 会话管理与冲突处理
│   ├── network-tracker.js        # 网络请求与 Body 追踪
│   ├── websocket-tracker.js      # WebSocket 数据帧追踪
│   ├── http-relay.js             # 弹性 HTTP 投递器（重试/超时/Ping）
│   └── relay-orchestrator.js     # 多 Tab 状态编排与消息路由
├── content/
│   ├── content-entry.js          # Content Script 路由加载器
│   └── extractors/
│       └── reddit-extractor.js   # Reddit DOM 提取器
├── shared/
│   ├── protocol.js               # 统一信封协议定义
│   └── settings.js               # 配置存储与度量统计 (chrome.storage)
├── ui/
│   └── popup/                    # 控制台面板
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
└── icons/
```

---

## 统一信封数据协议 (Payload Envelope)

所有投递至本地 Endpoint 的数据均遵循以下标准格式：

```json
{
  "version": "1.0",
  "relaySource": "omni-relay",
  "timestamp": "2026-09-06T13:45:00.000Z",
  "timestampMs": 1725630300000,
  "site": {
    "id": "reddit",
    "label": "Reddit"
  },
  "channel": "dom_extracted",
  "action": "batch_posts",
  "sourceUrl": "https://www.reddit.com/r/technology/",
  "metadata": {
    "tabId": 12345,
    "itemCount": 5
  },
  "payload": [
    {
      "title": "Example Post Title",
      "link": "https://www.reddit.com/r/technology/comments/...",
      "author": "john_doe",
      "flair": "Tech News",
      "score": "350",
      "comments": "42",
      "sourcePageUrl": "https://www.reddit.com/r/technology/",
      "capturedAt": "2026-09-06T13:45:00.000Z"
    }
  ]
}
```

网络层 CDP 拦截到的 GraphQL/API 数据信封示例：
```json
{
  "version": "1.0",
  "relaySource": "omni-relay",
  "timestamp": "2026-09-06T13:45:00.000Z",
  "site": { "id": "x", "label": "X (Twitter)" },
  "channel": "network_http",
  "action": "network_response",
  "payload": {
    "request": { "method": "POST", "url": "https://x.com/i/api/graphql/..." },
    "response": { "status": 200, "mimeType": "application/json" },
    "body": "{...}",
    "json": { "data": { ... } }
  }
}
```

---

## 本地接收端示例 (Python / Node.js)

### Python (FastAPI / Uvicorn)
```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/relay")
async def receive_relay(request: Request):
    envelope = await request.json()
    site = envelope.get("site", {}).get("id")
    channel = envelope.get("channel")
    print(f"收到 [{site}] 数据 ({channel}): {len(str(envelope.get('payload')))} bytes")
    return {"status": "ok"}

# 启动: uvicorn server:app --host 127.0.0.1 --port 9090
```

### Node.js (Express)
```javascript
const express = require('express');
const app = express();
app.use(express.json({ limit: '50mb' }));

app.post('/relay', (req, res) => {
  const { site, channel, payload } = req.body;
  console.log(`收到来自 [${site?.label}] 的数据 (${channel})`);
  res.json({ ok: true });
});

app.listen(9090, '127.0.0.1', () => {
  console.log('Omni Relay 本地接收服务已启动: http://127.0.0.1:9090/relay');
});
```

---

## 如何接入一个新平台（开发者指南）

在 `core/sites-registry.js` 的 `SITES` 数组中增加一条规则：

```javascript
{
  id: 'bilibili',
  label: 'Bilibili',
  description: 'B站动态与视频 API 数据',
  hosts: ['bilibili.com', 'api.bilibili.com'],
  urlPatterns: ['*://*.bilibili.com/*'],
  network: {
    enabled: true,
    jsonOnly: true,
    pathIncludes: ['/x/web-interface/', '/x/v2/reply'],
    webSocketPathIncludes: []
  },
  dom: {
    enabled: false,
    extractorId: null
  }
}
```

并在 `manifest.json` 的 `host_permissions` 添加对应域名前缀，即完成了新站点的全量网络流量中继接入！
