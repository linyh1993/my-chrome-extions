# Google SERP & SEO 扩展数据提取器 (Google SERP & SEO Extractor)

一款专为 SEO 分析、关键词调研与竞品研究打造的 Chrome 扩展 (Manifest V3)。

在 Google 搜索页面上，不仅提取原生搜索结果（排名、标题、目标网址、域名、摘要），更能**深度联合提取由 [AITDK](https://aitdk.com) 与 [Keywords Everywhere](https://keywordseverywhere.com) 两个扩展在每个搜索项中异步注入的高价值 SEO 指标**，并全景捕获**搜索统计、探索推荐词 (People also search for)、竞品产品与服务 (Find related products & services)、意图提问 (People also ask)、商业竞价广告 (Sponsored Ads) 与 AI 概览 (AI Overview)**。

---

## ✨ 核心特性

1. **三合一数据全景采集**：
   - **Google 原生 SERP**：自然排名、页面标题、目标直链 URL（自动解析解开重定向）、主域名、搜索摘要。
   - **Keywords Everywhere 指标**：MOZ DA（及走势百分比）、Ref Dom（引荐域数）、Ref Links（外链数）、Spam Score（垃圾得分）、单页流量、整站流量、单页排名关键词数、整站关键词数、顶部搜索量/CPC。
   - **AITDK 指标**：Monthly Visits（月访问量）、Avg. Visit Duration（平均访问时长）、Domain Created（域名建立时间）。
2. **SERP 全生态扩展模块采集**：
   - **📊 搜索统计 (Result Stats)**：结构化解析例如 `About 18,300 results (0.17 seconds)` 中的总条数与耗时。
   - **💡 搜索词库 (People also search for & Related searches)**：提取相关探索词与长尾词库，附带 KE 月搜索量与 CPC。
   - **🛍️ 商业竞品与产品 (Find related products & services)**：提取产品名称、商家品牌、价格区间、用户评分与链接。
   - **❓ 搜索意图提问 (People also ask)**：提取常见用户提问、回答摘要及权威来源站点。
   - **📢 商业投放广告 (Sponsored Ads)**：提取投放竞品、标题、广告语与着陆页链接。
   - **🤖 Google AI Overview**：提取生成式 AI 摘要与被引用的竞品站点。
   - **💬 社区与论坛 (Discussions & Forums)**：提取 Reddit、Quora 热门讨论帖。
3. **多通道便捷导出**：
   - **📋 复制表格 (TSV)**：多 Tab 视图下支持一键复制任意板块表格，直接在 Excel、Google Sheets、飞书表格或 Notion 中按 `Ctrl + V` 完整贴入表格。
   - **📥 导出 CSV**：各板块均可独立导出，内置 UTF-8 BOM，在 Windows / Mac Excel 中双击直接打开，绝不乱码。
   - **📦 导出全景 JSON**：一键打包全页面完整对象结构，便于程序员或自动化脚本进行二次分析与存储。
4. **双入口自由使用**：
   - **页面悬浮胶囊**：固定于 Google 搜索右下角，实时展示识别数、AITDK/KE 就绪状态与各模块徽章，一键提取或打开多 Tab 全景抽屉，可随时收起或展开。
   - **工具栏 Popup 弹窗**：点击浏览器右上角图标直接操作与快速预览。
5. **智能等待与跨页追加**：
   - 自动监听 AITDK 与 Keywords Everywhere 的异步渲染完成状态。
   - 提供「➕ 追加模式」，翻页搜索时持续累积自然结果，轻松收集 Top 50 / Top 100 竞品。
6. **插拔式插件适配器架构 (Plugin Adapter Architecture)**：
   - **零耦合与沙箱隔离**：Google 原生核心 SERP 引擎完全独立，不硬依赖任何具体第三方扩展；第三方插件出错绝不影响 Google 搜索与原生提取。
   - **即插即用注册表 (`PluginRegistry`)**：未来若新增更多 SEO 插件（如 Semrush, SimilarWeb, Ahrefs 等）或移除插件，只需实现适配器接口注册即可，状态胶囊、表格列、CSV/TSV 导出全部自动适配。
7. **🗄️ 本地数据库中继落库 (Proxy-Server Relay)**：
   - **直连本地中央网关**：内置标准 `RelayEnvelope` 协议，无缝接入本地 [proxy-server](file:///E:/dev/proxy-server) (`http://127.0.0.1:9090/relay`)。
   - **彻底解决多词丢失**：支持一键「🚀 存入数据库」及可选「自动入库模式」，跨词连续搜索时后台自动沉淀至 PostgreSQL，绝无数据丢失风险。
   - **安全跨域转发**：由 Extension Service Worker 托管请求，完全规避 Google HTTPS 页面的 Mixed Content 限制。

---

## 📊 提取字段说明

### 1. 自然搜索结果宽表 (SERP Organic Table)

| 字段名 | 来源 | 示例 | 说明 |
|--------|------|------|------|
| **排名 (Rank)** | Google | `1`, `2`... | 当前自然搜索排名序号 |
| **搜索词 (Query)** | Google | `ai photo detector` | 本次搜索的主关键词 |
| **标题 (Title)** | Google | `AI Image Detector \| Detect...` | 网页标题 |
| **URL** | Google | `https://deepai.org/ai-image-detector` | 真实目标网页链接 |
| **域名 (Domain)** | Google | `deepai.org` | 网站根域名 |
| **摘要 (Snippet)** | Google | `Use our free AI Image Detector...` | 搜索摘要（已清洗掉注入干扰文本） |
| **MOZ DA** | Keywords Everywhere | `56/100` | 网站权重得分 |
| **DA 走势** | Keywords Everywhere | `+87%` | 权重变化趋势 |
| **引荐主域 (Ref Dom)** | Keywords Everywhere | `9K` | 引用该网站的独立域名数 |
| **外链数 (Ref Links)** | Keywords Everywhere | `119.1K` | 外部链接总数 |
| **垃圾得分 (Spam Score)**| Keywords Everywhere | `1%` 或 `-` | 垃圾反向链接比例 |
| **页面流量 (Page Traffic)**| Keywords Everywhere | `0/mo` | 单页预估搜索月流量 |
| **整站流量 (Site Traffic)**| Keywords Everywhere | `151.80K/mo` | 全站预估搜索月流量 |
| **页面关键词数** | Keywords Everywhere | `0` | 单页排名的关键词总量 |
| **整站关键词数** | Keywords Everywhere | `8605` | 全站排名的关键词总量 |
| **月访问量 (Monthly Visits)**| AITDK | `20.51M` | 网站月均访问量 |
| **平均时长 (Avg Duration)**| AITDK | `00:03:10` | 访客平均停留时长 |
| **域名建立时间** | AITDK | `2023-01-05` | Whois 注册日期 |
| **全局搜索量/CPC** | Keywords Everywhere | `Volume: 49.5K/mo \| CPC: $1.20` | 本搜索词的总体指标 |

### 2. 搜索词库表 (Keywords / PASF)
- `推荐关键词 (Keyword)`、`来源模块 (Source)`、`预估月搜索量 (Volume)`、`CPC 竞价成本`、`搜索链接 (URL)`。

### 3. 竞品产品与服务表 (Products & Services)
- `产品名称 (Title)`、`商家/品牌 (Merchant)`、`价格 (Price)`、`评分 (Rating)`、`产品链接 (URL)`。

### 4. 搜索意图提问表 (People also ask)
- `搜索意图问题 (Question)`、`回答摘要 (Answer Snippet)`、`引用网站 (Source Domain)`、`来源链接 (Source URL)`。

### 5. 商业竞价广告表 (Sponsored Ads)
- `广告位 (Rank)`、`广告标题 (Ad Title)`、`投放商家 (Domain)`、`着陆页链接 (URL)`、`广告文案 (Snippet)`。

---

## 🚀 安装与使用方法

1. 打开 Chrome 浏览器，访问：`chrome://extensions/`
2. 在右上角开启 **「开发者模式」 (Developer mode)** 开关。
3. 点击左上角 **「加载已解压的扩展程序」 (Load unpacked)**。
4. 在弹出的文件选择窗口中，选择本扩展目录：
   ```
   e:\dev\my-chrome-extions\google-serp-extractor
   ```
5. 打开或刷新 [Google 搜索页面](https://www.google.com)，搜索任意关键词（例如：`ai photo detector`）。
6. 查看页面右下角悬浮胶囊：
   - 看到 `18,300 结果 | A:10 | K:10 | 词:8 | 品:4` 等实时状态。
   - 点击 **「👁️ 全景预览」** 打开全景多 Tab 数据窗口，支持切换查看自然排名、长尾词库、竞品产品、PAA 和广告。
   - 任意 Tab 均可点击 **「📋 复制当前 Tab」** 或 **「📥 导出当前 CSV」**；也可点击 **「📦 导出全景 JSON」**。
   - 点击 **「➕ 追加模式」**，翻页搜索持续累加数据，轻松完成多页批量采集！

---

## 🧪 自动化测试

项目内置针对全景模块解析与导出格式的回归测试套件：

```bash
cd google-serp-extractor
npm test
```
