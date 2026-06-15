# 通用抓包

## 目的

通用抓包用于采集 Chrome 中某个页面产生的 HTTP 请求响应与 WebSocket 消息，不包含任何业务系统定制逻辑。

## 入口

- `.\scripts\powershell\start-capture.ps1`

## 执行流程

1. 检查 Chrome 远程调试端口是否可用
2. 按参数解析目标 Tab
3. 启动 Node 抓包入口
4. 订阅 CDP 网络事件
5. 按路由规则落地 HTTP NDJSON 与 WebSocket 会话文件

## Tab 选择能力

支持以下方式：

- `-TargetId`
- `-HostContains`
- `-UrlContains`
- `-TitleContains`
- `-TabIndex`
- `-Interactive`
- `-NavigateUrl`
- `-OpenBlankTab`

选择规则：

- 只匹配到一个 Tab 时自动使用
- 匹配到多个 Tab 时，要求进一步指定 `-TabIndex` 或 `-Interactive`
- 没有匹配结果时直接失败

## 输出规则

默认未传 `-OutputDir` 时，输出到项目根目录下的 `.\output`

支持两种落地布局：

- `flat`：`<输出目录>\<会话名>\<域名>__<路径>.ndjson`
- `nested`：`<输出目录>\<会话名>\<域名>\<路径>.ndjson`

WebSocket 输出固定落在：

- `<输出目录>\<会话名>\ws\<站点域名>\<页面标识>\<连接标识>\session.json`
- `<输出目录>\<会话名>\ws\<站点域名>\<页面标识>\<连接标识>\messages.ndjson`
- `<输出目录>\<会话名>\ws\<站点域名>\<页面标识>\<连接标识>\summary.json`

命名规则：

- `站点域名`：来自 WebSocket URL 的 host
- `页面标识`：优先使用当前 Tab 标题，缺失时退化到页面 URL
- `连接标识`：使用 WebSocket 路径末段加短哈希，避免同页多连接冲突

支持的过滤参数：

- `-DomainInclude`
- `-DomainExclude`
- `-UrlInclude`
- `-UrlExclude`
- `-MethodInclude`
- `-ResourceTypeInclude`
- `-MimeInclude`
- `-IncludeBase64`

过滤说明：

- 域名、URL 过滤同时作用于 HTTP 与 WebSocket
- `-ResourceTypeInclude "WebSocket"` 可只保留 WebSocket 连接
- WebSocket 二进制帧默认只保留元信息；传 `-IncludeBase64` 后才保留 base64 载荷

## 示例

先进入项目根目录：

```powershell
Set-Location <项目根目录>
```

启动抓包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-capture.ps1 `
  -HostContains "x.com" `
  -SessionName "x-api" `
  -OutputDir ".\output\x-api" `
  -UrlInclude "/i/api/,graphql" `
  -ResourceTypeInclude "XHR","Fetch"
```
