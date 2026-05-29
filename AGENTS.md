# my-chrome-extions

本仓库用于存放个人 Chrome 扩展项目。`AGENTS.md` 只作为地图索引：帮助 Agent 判断先读什么、遵守什么、如何验证；详细规则放在 `docs/` 或子项目文档中。

## 读文档路线

- 修改 Chrome 扩展代码、manifest、权限、消息通信、content script、service worker、storage、side panel 时，先读 [docs/chrome-extension-guide.md](docs/chrome-extension-guide.md)。
- 做任何代码实现、重构、修 bug、代码审查时，按需读 [docs/agent-coding-guidelines.md](docs/agent-coding-guidelines.md)。
- 修改具体子项目时，优先读该子项目自己的 `README.md` 和现有代码。
- 默认不要访问 Chrome 官方文档；优先按本仓库指南和现有代码实现。只有用户明确要求，或本地指南无法覆盖且不查证会带来明显风险时，才访问 Chrome 官方文档。

## 工作循环

按 `PLAN -> BUILD -> VERIFY` 循环工作，直到改动可验证或明确受阻。

- `PLAN`：基于模型推理和本地代码上下文形成简短实现计划；这里的 plan 是思考产物，不要求使用工具内置 plan。
- `BUILD`：按计划修改最小必要文件，保持边界清晰，不做无关重构。
- `VERIFY`：运行可用的检查、测试或手动验证步骤；若发现问题，回到 `PLAN` 修正后继续。
- 无法验证时，在回复中说明原因、已做的静态检查和剩余风险。

## 硬性约定

- 所有扩展必须使用 Manifest V3：`manifest_version: 3`、`background.service_worker`、`action`、`host_permissions`。
- 不要引入历史 manifest 格式、旧后台页或旧消息 API；发现旧写法时应改为当前 MV3 API。
- 每个扩展独立子目录，根目录各自包含 `manifest.json`。
- 页面 DOM 操作用 content script；跨标签、存储、右键菜单等用 service worker。
- 只提交与当前任务相关的文件；不要清理或提交无关工作区差异。

## 子项目地图

| 目录 | 说明 | 入口 |
| --- | --- | --- |
| `traffic-relay/` | 按站点镜像 API 流量；MV3，含 side panel + content script | `manifest.json`、`background.js`、`content.js`、`sidepanel.*` |
| `x-comment-filter/` | X 单帖/Thread 评论过滤；默认折叠；架构可扩展更多页面类型 | `README.md`、`manifest.json`、`content/bootstrap.js`、`core/`、`sites/x/adapter.js` |
