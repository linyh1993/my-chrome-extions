# Google SERP & SEO 扩展数据提取器 (Google SERP & SEO Extractor)

一款专为 SEO 分析、关键词调研与竞品研究打造的 Chrome 扩展 (Manifest V3)。

在 Google 搜索页面上，不仅提取原生搜索结果（排名、标题、目标网址、域名、摘要），更能**深度联合提取由 [AITDK](https://aitdk.com) 与 [Keywords Everywhere](https://keywordseverywhere.com) 两个扩展在每个搜索项中异步注入的高价值 SEO 指标**。

---

## ✨ 核心特性

1. **三合一数据全景采集**：
   - **Google 原生 SERP**：自然排名、页面标题、目标直链 URL（自动解析解开重定向）、主域名、搜索摘要。
   - **Keywords Everywhere 指标**：MOZ DA（及走势百分比）、Ref Dom（引荐域数）、Ref Links（外链数）、Spam Score（垃圾得分）、单页流量、整站流量、单页排名关键词数、整站关键词数、顶部搜索量/CPC。
   - **AITDK 指标**：Monthly Visits（月访问量）、Avg. Visit Duration（平均访问时长）、Domain Created（域名建立时间）。
2. **多通道便捷导出**：
   - **📋 复制表格 (TSV)**：点击后直接在 Excel、Google Sheets、飞书表格或 Notion 中按 `Ctrl + V` 完整贴入表格，最顺手的分析体验。
   - **📥 导出 CSV**：内置 UTF-8 BOM，在 Windows / Mac Excel 中双击直接打开，绝不乱码。
   - **📄 导出 JSON**：便于程序员或自动化脚本进行二次处理。
3. **双入口自由使用**：
   - **页面悬浮胶囊**：固定于 Google 搜索右下角，实时展示识别数、AITDK/KE 就绪状态，一键提取或全屏表格预览，可随时收起或展开。
   - **工具栏 Popup 弹窗**：点击浏览器右上角图标直接操作与快速预览。
4. **智能等待与跨页追加**：
   - 自动监听 AITDK 与 Keywords Everywhere 的异步渲染完成状态。
   - 提供「➕ 追加模式」，翻页搜索时持续累积结果，轻松收集 Top 50 / Top 100 竞品。

---

## 📊 提取字段说明

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
6. 等待 AITDK 和 Keywords Everywhere 加载完成（页面右下角悬浮胶囊的状态指示会从黄色变为绿色并显示就绪数量）。
7. 点击 **「📋 复制表格」** 即可粘贴到 Excel/Sheets，或点击 **「📥 导出 CSV」** 保存到本地！

---

## 🧪 自动化测试

项目内置针对 DOM 解析与导出格式的回归测试套件：

```bash
cd google-serp-extractor
npm test
```
