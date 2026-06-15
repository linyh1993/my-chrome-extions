# Chrome Profile 列表

## 目的

该能力用于列出指定 Chrome `User Data` 目录下的 Profile 信息，便于在启动抓包前确认可用的 `ProfileDirectory`。

## 入口

- `.\scripts\powershell\list-chrome-profiles.ps1`

## 行为

- 未传 `-UserDataDir` 时，默认读取当前用户的 Chrome Stable 目录
- 优先从 `Local State` 的 `profile.info_cache` 读取 Profile 元数据
- 如果 `Local State` 不可用，则回退为扫描包含 `Preferences` 的目录

## 输出字段

- `ProfileDirectory`
- `ProfileName`
- `UserName`
- `GaiaName`
- `LastActiveTime`
- `Path`
- `Source`

## 用法

进入项目根目录后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\list-chrome-profiles.ps1
```

指定自定义 `User Data` 目录：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\list-chrome-profiles.ps1 `
  -UserDataDir "C:\Users\<用户名>\AppData\Local\Google\Chrome\User Data"
```

输出 JSON：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\list-chrome-profiles.ps1 -AsJson
```
