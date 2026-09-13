# SuperX — X (Twitter) 全能增强聚合插件

> 一站式聚合 X (Twitter) 垃圾评论净化、界面体验优化、数据分析与高级效率工具集。基于 Chrome Manifest V3、微内核底座与热插拔插件化架构打造。

---

## 🌟 为什么需要 SuperX？

在 X (Twitter) 生态中，通常一个功能对应一个独立扩展（如垃圾评论拦截、关注导出、大纲生成、高级搜索、热度分析）。当安装多个扩展时，经常面临：
1. **网络劫持冲突**：多个扩展在页面内各自 Hook `fetch` / `XMLHttpRequest` 抢占 GraphQL 数据；
2. **DOM 性能雪崩**：各个扩展各自启动 `MutationObserver` 轮询虚拟滚动推文，引发浏览器卡顿掉帧；
3. **UI 体验割裂**：工具栏图标成堆，页面上充斥着各扩展注入的浮窗与按钮；
4. **配置存储杂乱**：缺乏统一命名空间与导出备份。

**SuperX 采用「微内核底座 + 特性插件契约 + 三级 UI 漏斗」体系彻底解决了上述矛盾。**

---

## 🏗️ 架构设计

```
super-x/
├── manifest.json               # Manifest V3 核心声明
├── background/
│   └── service-worker.js       # 后台服务 (ESM)：状态流转、SidePanel 唤起、跨上下文通信
├── network-hook/
│   └── hook.js                 # 唯一定义在 MAIN world 的 fetch/xhr 劫持，零冲突广播 GraphQL
├── core/                       # 底座微内核 (Core Engine)
│   ├── event-bus.js            # 模块解耦事件流 (EventBus)
│   ├── storage.js              # 命名空间隔离存储 (StorageManager)
│   ├── dom-observer.js         # 全局唯一防抖 DOM 观察器 (DOMObserver)
│   ├── feature-manager.js      # 特性注册与生命周期管理中枢 (FeatureManager)
│   └── content-main.js         # Content Script 组装启动入口
├── features/                   # 业务特性插件集 (可自包含扩展)
│   ├── x-comment-cleaner/      # 模块1: 64位 SimHash 垃圾评论与引流 Bot 拦截助手
│   └── x-better-ui/            # 模块2: 长文大纲、隐藏侧栏干扰、正文加宽
└── ui/                         # 三级 UI 漏斗
    ├── popup/                  # 入口 1: Action Popup (类似 iOS 控制中心的快捷开关总控)
    └── sidepanel/              # 入口 2: Chrome 114+ 原生 Side Panel (数据大盘与深度配置)
```

---

## 🚀 已内置功能模块

### 1. 🛡️ 垃圾评论净化 (`x-comment-cleaner`)
- **64位 SimHash** 话术相似度指纹比对，精准识别群发与同质化引流变种；
- **8 大内置分类词库**（黄推/成人、投资带单、博彩开票、欺诈盗号等）；
- **智能聚类折叠**：自动收起连续垃圾评论并展示紧凑防卫条；
- **防封流控自动拉黑**：模拟人类操作间隔，保护主账号安全。

### 2. 📑 Better UI 体验增强 (`x-better-ui`)
- **长文大纲生成**：在阅读长推文/文章时，于侧边栏自动生成可点击跳转的目录；
- **纯净阅读**：自动隐藏右侧栏“当前趋势”、“有什么新鲜事”等干扰推流；
- **自适应加宽**：自动优化时间线与阅读排版宽度。

### 3. 👥 规划与接入中能力
- **Follow 批量转列表**（借鉴 `X-Follow-to-List`）：通过底座 GraphQL 拦截无感知提取关注列表并批量加入 List；
- **高级搜索助手**（借鉴 `advanced-search-for-x-twitter`）：可视化搜索语法生成器。

---

## 🛠️ 安装与调试

1. 打开 Chrome / Edge / Brave 浏览器，访问 `chrome://extensions/`；
2. 开启右上角 **「开发者模式 (Developer mode)」**；
3. 点击 **「加载已解压的扩展程序 (Load unpacked)」**；
4. 选择目录 `e:\dev\my-chrome-extions\super-x`；
5. 打开 `https://x.com` 即可开始使用！

---

## 🧩 如何新增一个业务特性？

只需在 `features/` 下建立独立子目录，并实现标准契约即可：

```javascript
// features/my-new-feature/index.js
const MyFeature = {
  id: "my-new-feature",
  name: "我的新功能",
  defaultEnabled: true,

  async init(context) {
    // 读写独立配置: context.storage.getConfig("my-new-feature")
  },
  async enable() {},
  async disable() {},
  onDOMNodes(tweets) {
    // 响应全局推文节点变更
  },
  onGraphQLResponse(endpoint, data) {
    // 响应网络请求数据（如 TweetDetail、Following 等）
  }
};

window.__SuperX__.FeatureManager.register(MyFeature);
```
