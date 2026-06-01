# X Suite

合并自 `x-comment-filter` 与 `traffic-relay` 的 **X（Twitter）专用** Chrome 扩展（Manifest V3）。

历史版本见 [`../archive/legacy-extensions/`](../archive/legacy-extensions/)。

## 功能

| 模块 | 说明 | 默认 |
|------|------|------|
| 评论过滤 | 单帖 / Thread 垃圾评论折叠、屏蔽、记录 | 开启 |
| 流量镜像 | 将 `/api/graphql` POST 到本机可配置地址 | **开启**（可在页内/侧边栏关闭） |

## 安装

1. `chrome://extensions` → 开发者模式 → 加载 **`x-suite`** 目录（含本文件与 `manifest.json` 的文件夹）
2. 勿再加载 `archive/legacy-extensions/` 下的旧扩展
3. 打开 `https://x.com/.../status/...` 验证评论过滤
4. 流量镜像：安装时已包含 **debugger** 权限，手动开启即可镜像（仍需本机接收服务）

## 目录结构

```text
x-suite/
├── manifest.json          # 扩展入口（仅此与 README 在根级）
├── icons/
├── background/            # Service Worker
├── ui/                    # 扩展页面（HTML / CSS / JS）
│   ├── popup/             # 工具栏弹出
│   ├── options/           # 选项页 + panels.js
│   └── sidepanel/         # 侧边栏（流量镜像）
├── content/               # Content scripts
├── shared/                # 存储、常量、归档库
├── core/                  # 过滤引擎、折叠 UI
├── filter/                # 规则
├── sites/x/               # X 站点适配
├── mirror/                # GraphQL 镜像（debugger）
├── styles/                # 注入页面的 content.css
└── data/                  # 词库等资源
```

## 界面入口

| 入口 | 路径 |
|------|------|
| Popup | `ui/popup/` |
| 选项页 | `ui/options/` |
| 侧边栏 | `ui/sidepanel/` |
| 页内面板 | `content/panel.js`（X 页面右下角） |

## 存储 key

| Key | 用途 |
|-----|------|
| `xcf_settings` | 评论过滤 |
| `xsuite_mirror_settings` | 镜像开关（`enabled`，默认开）与 URL |
| `xcf_settings.panelUi` | 页内面板：`expanded` 展开 / 默认小图标 |

默认镜像地址：`http://127.0.0.1:9090/mirror-traffic`

## 开发

遵守仓库 [`AGENTS.md`](../AGENTS.md) 与 [`rules/chrome-extension-guide.md`](../rules/chrome-extension-guide.md)。
