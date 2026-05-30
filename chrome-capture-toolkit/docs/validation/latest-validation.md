# 最近一次验证结果

## 验证日期

- 2026-05-30

## 验证范围

本次验证覆盖：

- 目录重构后的路径解析
- PowerShell 包装层启动链路
- Node CLI 导入链路
- Chrome 调试实例复用能力
- Chrome Profile 列表能力
- Tab 列表能力
- 默认输出目录能力
- 通用抓包、OPS 抓包、精简导出三类能力

## 实际执行命令

进入项目根目录后执行：

```powershell
node .\src\capture\cli\capture-chrome-network.mjs --help
node .\src\capture\cli\capture-ops-network.mjs --help
node .\src\capture\cli\simplify-capture.mjs --help
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-chrome-remote-debug.ps1 -LaunchMode reuse
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\list-chrome-profiles.ps1
node .\src\capture\cli\capture-chrome-network.mjs --list
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-capture.ps1 -OpenBlankTab -SessionName smoke-default
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-ops-capture.ps1 -Mode manual -MenuGroup smoke -MenuName ops -OpenBlankTab
node .\src\capture\cli\simplify-capture.mjs --input .\_tmp-simplify-source --output-dir .\_tmp-simplify-output --only-api
```

## 结果

- CLI 帮助输出通过
- Chrome 调试实例复用通过
- Chrome Profile 列表输出通过
- Tab 列表输出通过
- 通用抓包包装层启动通过
- OPS 抓包包装层启动通过
- 两个 PowerShell 入口在未传 `-OutputDir` 时均正确落到 `.\output`
- 精简导出处理通过
- 未发现路径解析错误或模块导入错误

## 备注

- 抓包验证采用空白页启动后人工中断方式，目标是验证链路可启动
- 精简导出验证使用临时 NDJSON 样例数据
- 验证产生的临时目录已清理
