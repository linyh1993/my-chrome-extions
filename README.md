# my-chrome-extions

个人 Chrome 扩展项目集合。所有扩展均按 Manifest V3 编写。

## 项目


| 目录                  | 说明                                       |
| ------------------- | ---------------------------------------- |
| `traffic-relay/`    | 按站点镜像 API 流量到本地，提供悬浮面板与 side panel 控制。   |
| `x-comment-filter/` | 过滤 X（Twitter）单帖 / Thread 下的垃圾评论，命中后默认折叠。 |


## 开发入口

- Agent 入口地图：[AGENTS.md](AGENTS.md)
- Chrome 扩展规则：[rules/chrome-extension-guide.md](rules/chrome-extension-guide.md)
- 通用编码准则：[rules/andrej-karpathy-coding-guidelines.md](rules/andrej-karpathy-coding-guidelines.md)

默认优先按仓库内规则和现有代码开发，不主动访问官方文档；只有用户明确要求或本地规则不足且有明显风险时才查官方文档。