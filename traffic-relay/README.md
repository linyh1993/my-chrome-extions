# Traffic Relay

按站点将 API 流量镜像到本地的 Chrome 扩展。当前实现使用 Manifest V3，包含 content script、background service worker、悬浮面板和 side panel 控制。

## 功能范围

- 在匹配站点中注入 content script，观察并镜像目标 API 流量。
- 使用 `chrome.debugger`、`tabs`、`storage` 和 `sidePanel` 权限协调调试、配置和 UI 状态。
- 支持 X / Twitter 与 `sif.com` 相关域名。
- 提供页面悬浮面板和浏览器 side panel 两种控制入口。

## 安装

1. 打开 `chrome://extensions`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」并选择本目录 `traffic-relay`。
4. 打开匹配站点并刷新页面。
5. 点击扩展图标打开 side panel。

## 主要文件

| 文件 | 说明 |
| --- | --- |
| `manifest.json` | MV3 manifest、权限、host 匹配、content script 和 side panel 配置。 |
| `background.js` | service worker，负责扩展级事件、debugger 和跨上下文协调。 |
| `content.js` | 注入目标页面，负责页面侧逻辑和悬浮面板交互。 |
| `sites-config.js` | 站点与 API 匹配配置。 |
| `ui-state.js` | 页面 UI 状态管理。 |
| `sidepanel.html` / `sidepanel.js` / `sidepanel.css` | side panel UI。 |

## 开发约束

- 遵守仓库根目录 [AGENTS.md](../AGENTS.md)。
- Chrome 扩展实现以 [rules/chrome-extension-guide.md](../rules/chrome-extension-guide.md) 为准。
- 不引入历史 manifest 格式、旧后台页或旧消息 API。
