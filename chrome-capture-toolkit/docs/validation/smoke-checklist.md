# 冒烟检查清单

## 目标

用于验证目录结构、入口脚本、CLI、以及基础运行链路在修改后仍然可用。

## 前置条件

- `PATH` 中可用 `node`
- 本机可执行 PowerShell 脚本
- 本机已安装 Chrome

## 执行方式

先进入项目根目录：

```powershell
Set-Location <项目根目录>
```

## 检查项

### 目录结构

```powershell
Get-ChildItem .\scripts\powershell
Get-ChildItem .\src\capture\cli
Get-ChildItem .\docs\functional
Get-ChildItem .\docs\validation
```

### CLI 帮助输出

```powershell
node .\src\capture\cli\capture-chrome-network.mjs --help
node .\src\capture\cli\capture-ops-network.mjs --help
node .\src\capture\cli\simplify-capture.mjs --help
```

### Tab 列表能力

```powershell
node .\src\capture\cli\capture-chrome-network.mjs --list
```

预期结果：

- 能连接到 Chrome 远程调试端口
- 能输出页面目标的 `id`、`index`、`title`、`url`

### Chrome 调试实例能力

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-chrome-remote-debug.ps1 -LaunchMode reuse
```

预期结果：

- 已存在调试实例时可直接复用
- 不存在时可切换为 `-LaunchMode new` 启动新实例

### Chrome Profile 列表能力

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\list-chrome-profiles.ps1
```

预期结果：

- 能定位到 Chrome `User Data` 目录
- 能输出可用的 `ProfileDirectory`
- 能输出对应的显示名称或账号信息

### 通用抓包包装层

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-capture.ps1 -OpenBlankTab -SessionName smoke-test -OutputDir .\_tmp-capture
```

预期结果：

- 能选择或新建目标 Tab
- 能启动 Node 抓包 CLI
- 启动过程中不出现路径或导入错误

### OPS 抓包包装层

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-ops-capture.ps1 -Mode manual -MenuGroup smoke -MenuName ops -OpenBlankTab -OutputDir .\_tmp-ops
```

预期结果：

- 能启动 OPS 抓包链路
- 能显示当前菜单上下文
- 启动过程中不出现路径或导入错误

### 精简导出能力

```powershell
node .\src\capture\cli\simplify-capture.mjs --input .\_tmp-simplify-source --output-dir .\_tmp-simplify-output --only-api
```

预期结果：

- 能遍历输入目录
- 能输出 JSON 文件
- 输出包含类型字段

## 通过标准

- 所有帮助命令执行成功
- 所有入口脚本能正确解析路径
- 通用抓包、OPS 抓包、精简导出都能完成基础启动或处理
- 通用抓包启动日志中能看到 `WebSocket files:` 输出路径

## WebSocket 追加检查

在存在 WebSocket 页面时，可追加执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-capture.ps1 `
  -HostContains "<目标站点>" `
  -SessionName smoke-ws `
  -OutputDir .\_tmp-ws
```

预期结果：

- 输出目录下出现 `.\_tmp-ws\smoke-ws\ws\`
- 每条 WebSocket 连接独立目录，包含 `session.json`、`messages.ndjson`、`summary.json`
- 文本帧逐条写入 `messages.ndjson`
