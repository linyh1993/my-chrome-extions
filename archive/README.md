# 归档目录

本目录存放已停用、仅作对照的历史项目，**不删除**。

默认规则：

- 归档内容只作回溯、对照、迁移参考。
- Agent 与日常开发默认**不要读取** `archive/` 下的项目，避免历史实现制造噪音。
- 只有用户明确要求读取、对比、迁移，或强制要求从归档中取信息时，才允许进入。

## 内容

| 路径 | 说明 |
|------|------|
| [legacy-extensions/x-comment-filter/](legacy-extensions/x-comment-filter/) | 旧版「X 评论过滤」，已合并入 `x-suite/` |
| [legacy-extensions/traffic-relay/](legacy-extensions/traffic-relay/) | 旧版「流量镜像」，已合并入 `x-suite/` |
| [inactive-projects/traffic-relay/](inactive-projects/traffic-relay/) | 停用的通用流量复刻项目，不再作为活跃扩展使用 |
| [inactive-projects/chrome-capture-toolkit/](inactive-projects/chrome-capture-toolkit/) | 停用的 Chrome CDP 抓包工具，不再作为活跃项目使用 |

## 使用说明

- **日常开发与安装**：请使用仓库根目录的 [`x-suite/`](../x-suite/)，不要同时加载归档扩展（会重复注入）。
- `inactive-projects/` 下的项目已停用，不再作为默认实现入口。
- 归档副本不再跟随 `x-suite` 自动更新；以 `x-suite` 为准。
