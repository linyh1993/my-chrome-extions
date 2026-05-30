# Chrome 抓包工具

这是一套基于 Chrome DevTools Protocol 的抓包工具，用于采集浏览器请求与响应，并支持将原始抓包结果精简为便于分析和交接的 JSON 数据。

项目已经从 `misc` 根目录中独立出来，当前根目录就是这套工具自己的工作目录。后续无论是继续开发、交接给其他人，还是让 LLM 持续改造，都应以这里作为唯一项目根目录。

## 目录结构

```text
chrome-capture-toolkit
|-- README.md
|-- archive
|   `-- backup-20260530-113242
|-- docs
|   |-- functional
|   |   |-- system-overview.md
|   |   |-- chrome-profile-list.md
|   |   |-- generic-capture.md
|   |   |-- ops-menu-capture.md
|   |   `-- simplify-export.md
|   `-- validation
|       |-- latest-validation.md
|       `-- smoke-checklist.md
|-- scripts
|   `-- powershell
|       |-- start-capture.ps1
|       |-- start-ops-capture.ps1
|       |-- start-chrome-remote-debug.ps1
|       `-- lib
|           `-- bootstrap.ps1
`-- src
    `-- capture
        |-- cli
        |   |-- capture-chrome-network.mjs
        |   |-- capture-ops-network.mjs
        |   `-- simplify-capture.mjs
        `-- lib
            |-- cdp.mjs
            |-- core.mjs
            |-- engine.mjs
            |-- ops-menu.mjs
            `-- record-utils.mjs
```

## 入口文件

- 通用抓包入口：`.\scripts\powershell\start-capture.ps1`
- OPS 菜单抓包入口：`.\scripts\powershell\start-ops-capture.ps1`
- Chrome 调试实例入口：`.\scripts\powershell\start-chrome-remote-debug.ps1`
- Chrome Profile 列表入口：`.\scripts\powershell\list-chrome-profiles.ps1`
- 精简导出入口：`.\src\capture\cli\simplify-capture.mjs`

## 文档体系

功能说明文档：

- `.\docs\functional\system-overview.md`
- `.\docs\functional\chrome-profile-list.md`
- `.\docs\functional\generic-capture.md`
- `.\docs\functional\ops-menu-capture.md`
- `.\docs\functional\simplify-export.md`

验证文档：

- `.\docs\validation\smoke-checklist.md`
- `.\docs\validation\latest-validation.md`

## 设计约束

- PowerShell 包装层只放在 `scripts/powershell`
- Node 实现层只放在 `src/capture`
- OPS 定制逻辑不得进入通用抓包链路
- 功能说明只放在 `docs/functional`
- 验证步骤和验证结果只放在 `docs/validation`
- 入口脚本保持轻量，核心行为放到 `src/capture`

## 默认行为

- 如果未传 `-OutputDir`，PowerShell 入口默认输出到项目根目录下的 `.\output`
- 如果已存在 Chrome 远程调试实例，可用 `reuse` 方式复用
- 如果需要指定 Profile，优先通过 `start-chrome-remote-debug.ps1` 显式启动

## 快速开始

先进入项目根目录：

```powershell
Set-Location <项目根目录>
```

复用或启动 Chrome 调试实例：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-chrome-remote-debug.ps1 -LaunchMode reuse
```

启动通用抓包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-capture.ps1 `
  -HostContains "x.com" `
  -SessionName "x-api" `
  -OutputDir ".\output\x-api" `
  -UrlInclude "/i/api/,graphql" `
  -ResourceTypeInclude "XHR","Fetch"
```

启动 OPS 菜单抓包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-ops-capture.ps1 `
  -Mode auto `
  -HostContains "sp.jupyte.com" `
  -OutputDir ".\output\ops"
```

执行精简导出：

```powershell
node .\src\capture\cli\simplify-capture.mjs `
  --input ".\output\ops" `
  --output-dir ".\output\ops-simplified" `
  --only-api
```
