# 精简导出

## 目的

精简导出用于把原始 NDJSON 抓包结果转换为更易读、更适合分析和交接的 JSON 文件。

## 入口

- `.\src\capture\cli\simplify-capture.mjs`

## 输出结构

每条精简记录包含以下字段：

- `interface`
- `method`
- `requestParams`
- `requestParamsType`
- `response`
- `responseType`

## 处理规则

- 不修改原始文件
- 输入目录时会递归扫描 `ndjson`
- `--only-api` 仅保留 XHR、Fetch、JSON 类响应
- `--include-failed` 会保留失败请求，响应字段为 `null`

## 示例

```powershell
Set-Location <项目根目录>

node .\src\capture\cli\simplify-capture.mjs `
  --input ".\output\ops" `
  --output-dir ".\output\ops-simplified" `
  --only-api
```
