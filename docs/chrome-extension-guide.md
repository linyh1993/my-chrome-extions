# Chrome 扩展开发速查（LLM / Agent 用）

> 本文是本仓库唯一 Chrome 扩展开发准则。LLM 生成或修改扩展时，必须使用 **Manifest V3**、extension service worker、`action`、`host_permissions`、`chrome.runtime.*` 等当前 API；不要引入已废弃的扩展架构或历史兼容写法。

---

## 1. 当前结论

- 口语里的「Chrome 插件」在官方语境是 **Chrome Extension**：HTML/CSS/JS + `manifest.json`，不是 NPAPI/PPAPI。
- 所有扩展一律使用 **Manifest V3**。不要添加历史 manifest 格式、旧后台页或旧消息 API。
- 后台逻辑使用 **extension service worker**，不是常驻 HTML 页面；不要依赖全局内存长期存在。
- 扩展页禁止远程托管代码和内联脚本；不要用 CDN 动态执行代码、`eval()`、`onclick="..."`、`href="javascript:"`。
- 拦截/修改网络请求优先用 `declarativeNetRequest`。MV3 中阻塞式 `webRequest` 基本只保留给策略安装扩展，不应作为普通商店扩展方案。

---

## 2. 开发调试


| 操作                    | 做法                                                                |
| --------------------- | ----------------------------------------------------------------- |
| 打开管理页                 | `chrome://extensions`，开启 **开发者模式**                                |
| 本地加载                  | 「加载已解压的扩展程序」选包含 `manifest.json` 的扩展目录                             |
| 改代码后                  | 管理页点重载或按 **Ctrl+R**；content script 改动还要刷新目标网页                     |
| 看后台报错                 | 扩展卡片点「Service Worker」打开独立控制台；静默失败先查这里                             |
| 调试 content script     | 页面 DevTools Console 顶部上下文选择扩展名，不是 `top`                           |
| 调试 popup / side panel | 对对应页面右键「检查」；被检查时 popup 会保持打开                                      |
| 看已安装扩展源码              | `%LocalAppData%\Google\Chrome\User Data\Default\Extensions\<id>\` |


---

## 3. 架构：常见执行环境


| 类型                               | 典型文件             | DOM                    | 页面 JS   | 扩展 API                                          | 网络请求                                      |
| -------------------------------- | ---------------- | ---------------------- | ------- | ----------------------------------------------- | ----------------------------------------- |
| **content script**               | `content.js`     | ✅ 读写页面 DOM             | ❌ 隔离世界  | 仅 `runtime` / `storage` / `i18n` / 部分 `dom` 等子集 | 通常受页面同源/CORS 约束；跨域请求交给扩展页或 service worker |
| **service worker**               | `background.js`  | ❌                      | ❌       | ✅ 绝大部分扩展 API                                    | ✅ 扩展源发起，需匹配 `host_permissions`            |
| **popup / side panel / options** | `popup.html` 等   | 仅自身页                   | ❌       | ✅ 多数扩展 API                                      | ✅ 扩展源发起，需匹配 `host_permissions`            |
| **injected script**              | 注入页面的 `<script>` | ✅                      | ✅ 与页面共享 | ❌                                               | 同页面权限和 CSP                                |
| **devtools**                     | `devtools.js`    | 通过 DevTools API 访问被检查页 | 部分      | `devtools` + 少量 `runtime`                       | 不作为通用跨域入口                                 |


**选型口诀：**

1. 改页面 DOM、跟站点 SPA 交互：用 `content_scripts`。
2. 跨标签协调、右键菜单、定时任务、网络规则、集中存储：用 `background.service_worker`。
3. 临时 UI、设置、开关：用 `action.default_popup`、`options_page` 或 `side_panel`。
4. 必须读写页面全局变量、hook 站点 JS：用 injected script，并通过 `window.postMessage` 与 content script 通信。
5. 不要把常驻逻辑写在 popup 或 side panel；窗口关闭或页面卸载后状态会丢。

---

## 4. Manifest 要点

```json
{
  "manifest_version": 3,
  "name": "...",
  "version": "1.0.0",
  "minimum_chrome_version": "114",
  "permissions": ["storage", "contextMenus", "scripting", "sidePanel"],
  "host_permissions": ["https://x.com/*"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js", "type": "module" },
  "side_panel": { "default_path": "sidepanel.html" },
  "content_scripts": [
    {
      "matches": ["https://x.com/*"],
      "js": ["content.js"],
      "css": ["style.css"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["inject.js"],
      "matches": ["https://x.com/*"]
    }
  ]
}
```


Manifest 编写规则：

- 必须声明 `"manifest_version": 3`。
- 工具栏入口使用 `action`。
- 后台入口使用 `background.service_worker`，需要 ESM 时加 `"type": "module"`。
- 普通扩展权限放 `permissions`，站点访问放 `host_permissions`。
- 暴露给页面的资源必须使用带 `resources` 和 `matches` 的 `web_accessible_resources` 对象数组。
- 按站点启停功能时，用 `chrome.action`、`declarativeContent` 或业务逻辑控制，不要引入旧入口字段。


---

## 5. Content Scripts

- content script 与页面共享 DOM，但 JS 运行在隔离世界；读不到页面全局变量，页面也调不到 content 里的函数。
- content script 可用的扩展 API 是受限子集。需要 `tabs`、`contextMenus`、`declarativeNetRequest` 等能力时，通过 `chrome.runtime.sendMessage` 让 service worker 处理。
- `run_at` 可选 `document_start`、`document_end`、`document_idle`，默认 `document_idle`。如果在 content 里监听 `DOMContentLoaded`，要处理脚本注入时事件已经触发的情况。
- 对 SPA 站点，manifest 匹配只负责首次注入；页面内路由变化要用 `MutationObserver`、History API hook 或站点事件重新扫描，并做 debounce。
- 注入 CSS 要作用域化，避免污染全站。动态 CSS 用 `chrome.scripting.insertCSS`，通常需要 `scripting` 权限和目标站点 host 权限。
- 动态脚本注入用 `chrome.scripting.executeScript`。注入函数或文件时不要依赖外部闭包；目标 tab/frame 也要有 host 权限或 `activeTab` 临时权限。

---

## 6. Background / Service Worker

- service worker 按事件唤醒，空闲后会被终止；全局变量只能当缓存，持久状态放 `chrome.storage`、IndexedDB 或后端。
- 不能访问 DOM、不能使用 `window`、不能操作普通网页元素；要通过 content script 或 `chrome.scripting.executeScript`。
- 事件监听要在顶层同步注册，不要等异步初始化后才 `addListener`，否则唤醒事件可能被错过。
- 长耗时任务要拆分，必要时用 `chrome.alarms`、storage 状态机或 offscreen document 承接需要 DOM 的后台工作。
- 调试时点扩展管理页的「Service Worker」链接。

---

## 7. 消息通信

统一用 `chrome.runtime.onMessage` / `chrome.runtime.sendMessage`。


| 方向                           | API                                                              |
| ---------------------------- | ---------------------------------------------------------------- |
| content → background         | `chrome.runtime.sendMessage(message)`                            |
| background → content         | `chrome.tabs.sendMessage(tabId, message)`                        |
| popup / side panel → content | 先 `chrome.tabs.query` 得到 `tabId`，再 `chrome.tabs.sendMessage`     |
| content ↔ injected           | `window.postMessage` + `window.addEventListener("message", ...)` |
| 长连接                          | `chrome.runtime.connect` / `chrome.tabs.connect`                 |


注意点：

- `sendMessage` 的回调只能在接收方仍活着时返回；popup 关闭后不能假设它还能收到消息。
- `sendResponse` 异步时必须 `return true`，并且同一消息只有一个 listener 能成功响应。
- Chrome 的消息载荷使用 JSON 序列化，不是浏览器标准的 structured clone；不要传 `Map`、`Set`、`Date`、函数、DOM 节点等复杂对象。

```javascript
// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.cmd === "get-state") {
    chrome.storage.local.get("state").then(({ state }) => {
      sendResponse({ ok: true, state });
    });
    return true;
  }
});

// content.js
chrome.runtime.sendMessage({ cmd: "get-state" }, (res) => {
  if (chrome.runtime.lastError) return;
  console.log(res);
});
```

---

## 8. 存储

- 首选 `chrome.storage`，少用 `localStorage`。扩展不同上下文的 `localStorage` 不天然共享，service worker 也没有 `localStorage`。
- `chrome.storage.local` 默认配额约 10MB；确有需要可申请 `unlimitedStorage`，但仍应控制数据规模。
- `chrome.storage.sync` 用于用户设置等小数据，会跟随登录用户同步，但有总量、单项和写入频率限制；不要存大量缓存。
- `chrome.storage.session` 适合浏览器会话内临时状态，默认不暴露给 content script，可通过访问级别配置。
- 使用前在 manifest 声明 `"permissions": ["storage"]`。

---

## 9. 安全、CSP 与发布审核

- 扩展包内必须自带执行代码；不要加载远程 JS 后执行，也不要把远程配置当代码解释。
- 扩展页禁止内联脚本和内联事件：用外部 JS 文件 + `addEventListener`。
- 避免 `eval()`、`new Function()`、字符串版 `setTimeout()`；MV3 默认 CSP 不允许这些模式。
- 页面注入脚本时，`web_accessible_resources` 只暴露必要文件，并限制到必要 `matches`。
- 权限最小化：能用 `activeTab` 就不要直接申请 `<all_urls>`；host 权限尽量写精确域名。
- 发布到 Chrome Web Store 上传的是扩展 ZIP 包，不是开发机打出来的 `.crx`。`.crx` 打包主要用于离线或企业分发测试。

---

## 10. 常用能力


| 能力          | 配置 / 权限                                            | 落点                                     |
| ----------- | -------------------------------------------------- | -------------------------------------- |
| 工具栏按钮       | `action`                                           | popup 或 service worker                 |
| 右键菜单        | `contextMenus`                                     | service worker 顶层创建或按事件创建              |
| 覆盖新标签页等     | `chrome_url_overrides`                             | 每个扩展只能覆盖每类页面一次                         |
| 地址栏关键字      | `omnibox`                                          | service worker                         |
| 桌面通知        | `notifications`                                    | service worker                         |
| 网络请求规则      | `declarativeNetRequest`                            | 静态 / 动态 / 会话规则                         |
| 观察请求但不阻塞    | `webRequest`                                       | service worker                         |
| 动态脚本/CSS    | `scripting` + host 权限或 `activeTab`                 | service worker / 扩展页                   |
| 侧边栏         | `side_panel` + `sidePanel` 权限，Chrome 114+          | side panel 页面                          |
| DevTools 面板 | `devtools_page`                                    | 独立 devtools 页面，重载扩展后要重开 DevTools       |
| 国际化         | `_locales/<lang>/messages.json` + `default_locale` | `__MSG_*__` / `chrome.i18n.getMessage` |


---

## 11. 经验清单

1. 功能莫名失效：先开 service worker 控制台看报错和生命周期日志。
2. content 改了没效果：重载扩展后刷新目标页面；必要时硬刷新或重新打开 tab。
3. SPA 站点漏处理：检查路由变化、懒加载节点、shadow DOM、iframe 和 debounce。
4. CSS 污染：排查 content 注入的全局选择器，给扩展 UI 加根节点和命名空间。
5. 跨域失败：不要在 content script 硬 fetch；改由 service worker / 扩展页发起，并检查 `host_permissions`。
6. 消息偶发丢失：确认接收方是否仍存在，异步响应是否 `return true`，是否误传不可 JSON 序列化对象。
7. 权限审核不过：删除未使用权限，把 `<all_urls>` 改成精确域名，给敏感权限写清楚用途。

---

## 12. 官方文档

- [Chrome Extensions 文档首页](https://developer.chrome.com/docs/extensions)
- [Manifest 文件格式](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Extension service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [消息通信](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [跨域网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome Web Store 发布](https://developer.chrome.com/docs/webstore/publish)
