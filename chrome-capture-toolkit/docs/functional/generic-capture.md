# 通用抓包

## 目的

通用抓包用于采集 Chrome 中某个页面产生的网络请求与响应，不包含任何业务系统定制逻辑。

## 入口

- `.\scripts\powershell\start-capture.ps1`

## 执行流程

1. 检查 Chrome 远程调试端口是否可用
2. 按参数解析目标 Tab
3. 启动 Node 抓包入口
4. 订阅 CDP 网络事件
5. 按路由规则落地 NDJSON

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

支持的过滤参数：

- `-DomainInclude`
- `-DomainExclude`
- `-UrlInclude`
- `-UrlExclude`
- `-MethodInclude`
- `-ResourceTypeInclude`
- `-MimeInclude`
- `-IncludeBase64`

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
