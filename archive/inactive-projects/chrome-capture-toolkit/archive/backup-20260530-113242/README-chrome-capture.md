# Chrome 请求与响应抓取

这套脚本通过 Chrome DevTools Protocol 抓取当前页面产生的网络请求，并导出为 `NDJSON`。

每一行都是一条完整记录，包含这些字段：

- `request.url`
- `request.method`
- `request.headers`
- `request.postData`
- `request.postDataJson`
- `request.queryParams`
- `response.status`
- `response.headers`
- `response.body`
- `response.bodyJson`
- `failure`

支持两种落盘方式：

- 总文件 + 分文件同时写
- 仅分文件，适合按菜单单独抓取
- 自动按菜单切换落到不同目录

## 1. 启动 Chrome 调试模式

```powershell
powershell -ExecutionPolicy Bypass -File .\start-chrome-remote-debug.ps1
```

如果你已经自己启动过 Chrome，并带了 `--remote-debugging-port=9222`，可以跳过这一步。

## 2. 查看可抓取标签页

```powershell
node .\capture-chrome-network.mjs --list
```

## 3. 开始抓取

按 URL 关键字选中标签页：

```powershell
node .\capture-chrome-network.mjs --url-contains your-domain.com
```

按 target id 选中标签页：

```powershell
node .\capture-chrome-network.mjs --target-id <target-id>
```

指定输出文件：

```powershell
node .\capture-chrome-network.mjs --url-contains your-domain.com --output capture.ndjson
```

只写分文件，不写总文件：

```powershell
node .\capture-chrome-network.mjs --target-id <target-id> --output-dir F:\captures --session-name menu-a --split-only
```

自动识别菜单切换，并落到 `一级菜单\二级菜单`：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-menu-capture.ps1 -AutoMenu -TargetId <target-id> -OutputDir "F:\work\skill factory\数据\ops"
```

让脚本启动抓取后立即跳转，并在 5 秒后自动停止：

```powershell
node .\capture-chrome-network.mjs --target-id <target-id> --navigate https://example.com --stop-after-ms 5000
```

## 4. 停止抓取

回到脚本窗口，按 `Ctrl + C`。

脚本退出时会把已完成请求写入输出文件。

## 5. 说明

- 默认会跳过二进制响应体；如果你也要保留图片、文件等 base64 数据，增加 `--include-base64`
- `--split-only` 常用于按菜单抓取；文件结构会是 `输出目录\菜单名\域名\路径.ndjson`
- `-AutoMenu` 会持续监听当前页面菜单，切换菜单后自动把后续请求写到新的 `一级菜单\二级菜单` 目录
- 如果某些请求没有响应体，通常是这几类情况：重定向、下载流、缓存命中、浏览器策略限制、请求尚未完成
- 输出格式是 `NDJSON`，适合后续再用脚本筛选、转成普通 JSON 或导入分析工具
