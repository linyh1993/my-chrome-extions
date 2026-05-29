# my-chrome-extions

本仓库用于存放个人 Chrome 扩展项目。

## Chrome 扩展开发指引

编写或修改扩展（`manifest.json`、content script、service worker、消息通信、权限、`chrome.storage` 等）时，**请先阅读**：

**[docs/chrome-extension-guide.md](docs/chrome-extension-guide.md)**

该文档是本仓库 Chrome 扩展开发的唯一准则，面向 Manifest V3 与本仓库实践；仅在相关任务时按需加载，无需每次会话全文带入。

## 子项目


| 目录                  | 说明                                             |
| ------------------- | ---------------------------------------------- |
| `traffic-relay/`    | 按站点镜像 API 流量；MV3，含 side panel + content script |
| `x-comment-filter/` | X 单帖/Thread 评论过滤；默认折叠；架构可扩展更多页面类型              |


## 约定

- 所有扩展必须使用 **Manifest V3**（`service_worker`、`action`、`host_permissions`）。
- 不要引入历史 manifest 格式、旧后台页或旧消息 API；发现旧写法时应改为当前 MV3 API。
- 每个扩展独立子目录，根目录各自包含 `manifest.json`。
- 页面 DOM 操作用 content script；跨标签、存储、右键菜单等用 service worker。
