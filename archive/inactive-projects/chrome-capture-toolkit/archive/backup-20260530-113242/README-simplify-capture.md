# 抓包精简脚本

这个脚本会读取原始抓包的 `ndjson` 文件，并输出一份精简版 `json`。

原始文件不会改动。

每条记录只保留这几个字段：

- `interface`
- `method`
- `requestParams`
- `requestParamsType`
- `response`
- `responseType`

## 用法

精简整个菜单目录：

```powershell
node .\simplify-capture.mjs --input "F:\work\skill factory\数据\ops\智能运营\指标及达成" --only-api
```

指定输出目录：

```powershell
node .\simplify-capture.mjs --input "F:\work\skill factory\数据\ops\智能运营\指标及达成" --output-dir "F:\work\skill factory\数据\ops\智能运营\指标及达成-simplified" --only-api
```

## 说明

- `--only-api` 会只保留 `XHR`、`Fetch`、以及 JSON 响应
- 输出文件会和原始文件同名，但扩展名改成 `.json`
- 默认输出到源目录旁边的 `-simplified` 目录
