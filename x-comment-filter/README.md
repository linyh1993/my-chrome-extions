# X 评论过滤

过滤 X（Twitter）**单帖 / Thread** 下的垃圾评论。命中后**默认折叠**，可单条展开、屏蔽用户或标记误杀。

## 安装

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录 `x-comment-filter`
4. 打开任意 `https://x.com/.../status/...` 帖子页，刷新一次

## 架构（便于扩展时间线、文章页等）

```
content/bootstrap.js     # 路由 + MutationObserver 调度
core/registry.js         # 站点适配器注册表
sites/x/adapter.js       # X 的 DOM 与页面类型识别
filter/rules.js          # 与 DOM 无关的规则
core/fold.js             # 折叠 UI（displayMode: fold | hide）
shared/settings.js       # 设置与 contexts 开关
```

新增页面类型：在 `shared/constants.js` 增加 `CONTEXT`，在 `sites/x/adapter.js` 的 `detectContext` / `isContextEnabled` 中实现，并在 `settings.contexts` 中打开开关。

## v0.1 范围

- ✅ 单帖 / Thread 评论
- ✅ 默认折叠 + 底部汇总条
- ✅ 规则：黑名单、纯表情、昵称关键词
- ⏳ 时间线、文章页（`contexts` 已预留，默认关闭）
