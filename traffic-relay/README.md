# 流量复刻（traffic-relay）

通用 Chrome 扩展：按站点配置，通过 CDP 捕获 **GET/POST** 且响应为 **application/json**（含 GraphQL）的 API 流量，以及匹配规则内的 **WebSocket / WSS** 连接与消息帧，POST 到本地镜像端点。

## 默认支持的站点

首次安装（或未保存过配置）内置两条规则，可在选项页随时增删改：


| 站点          | 域名                    | 路径过滤           |
| ----------- | --------------------- | -------------- |
| X / Twitter | `x.com`、`twitter.com` | `/api/graphql` |
| SIF         | `sif.com`             | `/api/`        |


## 抓取规则

- **方法**：仅 `GET`、`POST`
- **响应**：须为 `application/json` 或 `*+json`（GraphQL 常见）
- **路径**：按站点配置的子串匹配；留空则用默认 `/api/graphql`、`/graphql`、`/api/`
- **域名**：按站点 hosts 匹配当前页及同源/子域请求
- **WebSocket**：按相同 hosts + path 规则匹配 `ws://` / `wss://`，逐条转发握手、帧、关闭事件

## 添加新站点

1. 扩展选项页 → **添加站点**
2. 填写显示名称、ID、域名（每行一个）、路径过滤（可选）
3. 保存后刷新目标页面即可

## 目录结构

```
traffic-relay/
├── shared/config.js    # 多站点配置读写
├── shared/filters.js   # GET/POST + JSON 过滤
├── background/
├── content/
└── ui/options/         # 站点列表编辑
```

## 本地 payload

HTTP 请求保持原结构：

```json
{
  "siteId": "x",
  "siteLabel": "X / Twitter",
  "request": { "method": "POST", "url": "https://x.com/api/graphql" },
  "response": { "status": 200, "mimeType": "application/json" },
  "responseBody": "..."
}
```

WebSocket 事件使用独立结构：

```json
{
  "relayKind": "websocket",
  "eventType": "frame",
  "siteId": "x",
  "siteLabel": "X / Twitter",
  "page": { "hostname": "x.com" },
  "websocket": {
    "requestId": "12345.67",
    "url": "wss://api.x.com/graphql-stream",
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

## 安装

`chrome://extensions` → 加载 `traffic-relay/` → 选项页确认站点与镜像地址（默认 `http://127.0.0.1:9090/mirror-traffic`）

## 与 x-suite

`x-suite/` 仍保留 X 专用镜像；勿与本扩展同时对同一标签页附加 debugger。
