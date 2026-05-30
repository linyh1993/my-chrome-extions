# OPS 菜单抓包

## 目的

OPS 菜单抓包是在通用抓包基础上的定制能力，用于识别当前菜单，并将接口数据按菜单目录归档。

## 入口

- `.\scripts\powershell\start-ops-capture.ps1`

## 边界

- OPS 菜单识别逻辑只存在于 `.\src\capture\lib\ops-menu.mjs`
- 通用抓包入口不感知 OPS 菜单
- 只有确实需要按菜单归档时，才使用 OPS 入口

## 模式

### 自动模式

自动读取当前页面的菜单状态，确定：

- 一级菜单
- 当前叶子菜单

输出结构：

```text
<输出目录>\<一级菜单>\<叶子菜单>\<域名>__<路径>.ndjson
```

示例：

```powershell
Set-Location <项目根目录>

powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-ops-capture.ps1 `
  -Mode auto `
  -HostContains "sp.jupyte.com" `
  -OutputDir ".\output\ops"
```

### 手动模式

不依赖页面自动识别，直接指定菜单目录。

示例：

```powershell
Set-Location <项目根目录>

powershell -ExecutionPolicy Bypass -File .\scripts\powershell\start-ops-capture.ps1 `
  -Mode manual `
  -MenuGroup "智能运营" `
  -MenuName "指标及达成" `
  -HostContains "sp.jupyte.com" `
  -OutputDir ".\output\ops"
```

## 识别策略

OPS 适配层当前按以下顺序尝试识别：

- 已选中的菜单项
- 已激活的子菜单
- 页面标题
- URL 路径

当菜单切换后，后续采集到的请求会自动写入新的菜单目录。
