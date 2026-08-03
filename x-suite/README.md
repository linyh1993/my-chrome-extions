# X Traffic Mirror

一个只做 X 流量镜像的 Manifest V3 Chrome Extension。

## 功能

- 用 `chrome.debugger` 监听当前 X / Twitter tab 的 Network 事件。
- 转发 `/api/graphql` HTTP response body 到本机 endpoint。
- 转发 X 站点 WebSocket / WSS 创建、握手、frame、关闭事件。
- 默认接收地址：`http://127.0.0.1:9090/mirror-traffic`。

## 安装

1. 打开 `chrome://extensions`，开启 Developer mode。
2. Load unpacked，选择 `x-suite/` 目录。
3. 打开 X 页面，点击扩展 popup，确认 `Mirror` 开启。
4. 本机启动接收服务，监听 `http://127.0.0.1:9090/mirror-traffic`。

## 目录结构

```text
x-suite/
├── manifest.json
├── background/service-worker.js
├── mirror/debugger-bg.js
├── mirror/sites-config.js
├── shared/mirror-settings.js
├── ui/popup/
└── icons/
```

## Storage key

| Key | 用途 |
|-----|------|
| `xsuite_mirror_settings` | 镜像开关和本机 endpoint |

## HTTP payload

```json
{
  "siteId": "x",
  "request": { "method": "POST", "url": "https://x.com/i/api/graphql/..." },
  "response": { "status": 200, "mimeType": "application/json" },
  "responseBody": "{...}"
}
```

## WebSocket payload

```json
{
  "relayKind": "websocket",
  "eventType": "frame",
  "siteId": "x",
  "siteLabel": "X",
  "websocket": {
    "requestId": "12345.67",
    "url": "wss://...",
    "openedAt": "2026-06-15T04:00:00.000Z",
    "handshake": {
      "request": { "headers": {} },
      "response": { "status": 101, "headers": {} }
    },
    "sentSeq": 0,
    "receivedSeq": 1
  },
  "frame": {
    "direction": "received",
    "sequence": 1,
    "opcode": 1,
    "opcodeName": "text",
    "payloadEncoding": "utf8",
    "payloadData": "{\"type\":\"chunk\"}",
    "payloadJson": { "type": "chunk" },
    "payloadSize": 16
  },
  "timestamp": 123456.789
}
```
