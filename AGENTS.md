# my-chrome-extions

本仓库用于存放个人 Chrome 扩展项目。`AGENTS.md` 只作为地图索引：帮助 Agent 判断先读什么、遵守什么、如何验证；详细规则放在 `rules/` 或子项目文档中。

## 读文档路线

- 任何任务都必须先读 [rules/andrej-karpathy-coding-guidelines.md](rules/andrej-karpathy-coding-guidelines.md)，再开始计划和实现。
- 修改 Chrome 扩展代码、manifest、权限、消息通信、content script、service worker、storage、side panel 时，在上述文件之后继续读 [rules/chrome-extension-guide.md](rules/chrome-extension-guide.md)。
- 修改具体子项目时，优先读该子项目自己的 `README.md` 和现有代码。
- 如果本轮上下文中已经读取过某个规则文件，优先回顾上下文，不要重复读取；只有内容不确定、可能已变更或需要精确核对时才重新读取。
- 默认不要访问 Chrome 官方文档；优先按本仓库指南和现有代码实现。只有用户明确要求，或本地指南无法覆盖且不查证会带来明显风险时，才访问 Chrome 官方文档。

## 工作循环

执行时使用 `PLAN -> BUILD -> VERIFY`，这是 [rules/andrej-karpathy-coding-guidelines.md](rules/andrej-karpathy-coding-guidelines.md) 的本仓库落地方式。

- `PLAN`：先基于模型推理和本地上下文形成简短计划，不要求使用工具内置 plan。
- `BUILD`：只改当前任务需要的最小文件，不做无关重构。
- `VERIFY`：运行可用检查；失败则回到 `PLAN` 修正后继续。无法验证时，说明原因、已做的静态检查和剩余风险。

## 硬性约定

- 所有扩展必须使用 Manifest V3：`manifest_version: 3`、`background.service_worker`、`action`、`host_permissions`。
- 不要引入历史 manifest 格式、旧后台页或旧消息 API；发现旧写法时应改为当前 MV3 API。
- 每个扩展独立子目录，根目录各自包含 `manifest.json`。
- 页面 DOM 操作用 content script；跨标签、存储、右键菜单等用 service worker。
- 只提交与当前任务相关的文件；不要清理或提交无关工作区差异。
- 完成代码改动后，除非用户明确表示**不需要**提交或推送到远程分支，否则默认应 `git commit` 并 `git push` 到当前工作的远程分支。

## 子项目地图


| 目录                           | 说明                                          | 入口                                                                          |
| ---------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `x-suite/`                   | **推荐**：X 专用合并扩展（评论过滤 + 可选 GraphQL 镜像）       | `README.md`、`manifest.json`、`ui/`、`content/`、`background/service-worker.js` |
| `traffic-relay/`             | 通用流量复刻：任意站点 API 镜像到本地（CDP Network）          | `README.md`、`manifest.json`、`background/service-worker.js`、`shared/config.js` |
| `archive/legacy-extensions/` | 已归档：`x-comment-filter`、`traffic-relay`（勿加载） | `archive/README.md`                                                         |
| `chrome-capture-toolkit/`    | Chrome CDP 抓包与精简导出；PowerShell 启动 + Node CLI | `README.md`、`scripts/powershell/`、`src/capture/`、`docs/`                    |


