# my-chrome-extions

个人 Chrome 扩展项目集合。所有扩展均按 Manifest V3 编写。

## 项目

| 目录 | 说明 |
|------|------|
| [`x-suite/`](x-suite/) | **推荐安装**：X 评论过滤 + 可选 GraphQL 流量镜像 |
| [`traffic-relay/`](traffic-relay/) | 通用流量复刻：任意站点 API 镜像到本地 |
| [`archive/legacy-extensions/`](archive/legacy-extensions/) | 已归档的旧版 `x-comment-filter`、`traffic-relay`（保留对照，勿加载） |
| [`chrome-capture-toolkit/`](chrome-capture-toolkit/) | Chrome CDP 抓包与精简导出 |

## 开发入口

- Agent 入口地图：[AGENTS.md](AGENTS.md)
- Chrome 扩展规则：[rules/chrome-extension-guide.md](rules/chrome-extension-guide.md)
- 通用编码准则：[rules/andrej-karpathy-coding-guidelines.md](rules/andrej-karpathy-coding-guidelines.md)
