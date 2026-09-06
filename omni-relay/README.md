# Omni Relay

通用多平台网络流量与 DOM 数据中继器（Manifest V3 Chrome Extension）。

将各平台（内置 **X (Twitter)** 和 **Reddit**）的网络流量（GraphQL / API / WebSocket）及页面结构化数据，通过统一信封协议弹性投递至本地后端。

---

## 架构概览

```text
omni-relay/
├── manifest.json              # MV3 清单（原生 ESM Service Worker）
├── background/
│   └── service-worker.js     # 后台入口：生命周期与消息分发
├── core/
│   ├── sites.js              # [纯数据] 平台规则声明与 URL 匹配器
│   ├── storage.js            # [单一数据源] 配置持久化与度量统计
│   ├── relay-client.js       # [弹性传输] 本地 HTTP POST（超时/退避重试/Ping）
│   └── cdp-engine.js         # [CDP 引擎] 调试器会话、网络与 WebSocket 捕获
├── content/
│   ├── extractors/
│   │   └── reddit.js         # Reddit DOM 帖子提取器
│   └── content-entry.js      # 路由挂载器
├── ui/
│   └── popup/                # 控制台面板 (ESM)
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
└── icons/
```

---

## 统一数据信封 (Envelope)

所有投递至本地 Endpoint（默认 `http://127.0.0.1:9090/relay`）的 HTTP POST 请求统一遵循以下结构：

```json
{
  "version": "1.0",
  "relaySource": "omni-relay",
  "timestamp": "2026-09-06T13:45:00.000Z",
  "site": { "id": "x", "label": "X (Twitter)" },
  "channel": "network_http",
  "action": "network_response",
  "sourceUrl": "https://x.com/home",
  "payload": {
    "request": { "url": "https://x.com/i/api/graphql/...", "method": "POST" },
    "response": { "status": 200, "mimeType": "application/json" },
    "body": "{\"data\":{...}}",
    "json": { "data": { ... } }
  }
}
```

---

## 如何添加新平台 (10 行代码接入)

打开 `core/sites.js`，在 `SITES` 数组中声明新平台：

```javascript
{
  id: 'bilibili',
  label: 'Bilibili',
  hosts: ['bilibili.com'],
  urlPatterns: ['*://*.bilibili.com/*'],
  network: {
    enabled: true,
    jsonOnly: true,
    pathIncludes: ['/x/web-interface/'],
    wsPathIncludes: []
  },
  dom: { enabled: false }
}
```

并在 `manifest.json` 的 `host_permissions` 中补充该域名即可。
