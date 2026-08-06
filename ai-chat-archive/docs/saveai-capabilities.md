# SaveAI / AI Exporter 能力调研报告

## 1. 调研范围

本文只记录 SaveAI / AI Exporter 公开页面展示的产品能力，作为后续产品设计参考。不包含实现取舍、架构建议或优先级判断。

调研时间：2026-08-06

主要来源：

- [saveai.net 首页](https://saveai.net/)
- [AI Exporter Documentation](https://saveai.net/docs)
- [AI Exporter FAQ](https://saveai.net/faq)
- [Sync to Notion](https://saveai.net/docs/guide/export-to-notion)
- [Chrome Web Store listing](https://chromewebstore.google.com/detail/ai-exporter-save-chatgpt/kagjkiiecagemklhmhkabbalfpbianbe?hl=en)

## 2. 产品定位

SaveAI / AI Exporter 的公开定位是多平台 AI conversation 管理与导出工具。首页标题强调面向 ChatGPT、Gemini 等 AI chat 平台的导出能力，并将核心价值描述为保存、整理、复用 AI conversations。

公开文案中的主要使用场景：

- 将 AI chat 导出为结构化文档。
- 保存重要 conversation 作为研究、学习或工作资料。
- 在多个 AI platform / model 之间收集、比较和合并内容。
- 将 conversation 同步到 Notion，形成个人知识库。

## 3. 支持平台

### 3.1 首页平台列表

首页 “Supports 15+ AI Platforms” 区域明确展示以下平台：

- ChatGPT
- Gemini
- Claude
- DeepSeek
- Grok
- Microsoft Copilot
- GitHub Copilot
- Google Search AI / AI Overview / AI Mode
- Google AI Studio
- Perplexity
- NotebookLM
- Kimi
- YuanBao
- Qwen
- Doubao

### 3.2 Docs / FAQ 中的平台表述

Docs 页面写到支持 “over 10 leading AI platforms”，并列举 ChatGPT、Gemini、DeepSeek、Claude、Grok、Perplexity、Copilot、Google AI Studio、GitHub Copilot。

FAQ 写到支持 ChatGPT、Gemini、Claude、DeepSeek、Grok、Microsoft Copilot、GitHub Copilot、Google Search AI、Google AI Studio、Perplexity、NotebookLM、Kimi 以及 “12+ major AI platforms”。

### 3.3 平台数量表述

公开页面同时出现 “15+ AI Platforms”、“over 10 leading AI platforms” 和 “12+ major AI platforms”。这些是营销性数量描述；准确支持范围应以页面明确列名的平台和 extension 实际版本为准。

## 4. 核心能力

### 4.1 Full Page Export

导出完整 conversation。FAQ 中以 ChatGPT / Gemini 为例，描述用户打开 conversation 后点击 extension，即可导出完整页面内容。公开页面强调 long chats、timestamps、model names、code blocks、tables、images 和 formatting 的保留。

### 4.2 Selective Export

支持只导出部分 conversation。Docs 和 FAQ 都提到可以通过 checkbox 选择具体 conversation bubbles；首页还提到可通过 quick selection tools 或 drag-select 选择 chat section。

### 4.3 Single Message Export

Docs navigation 中单独列出 Single Message Export。Notion 文档也提到可以同步 single message。

### 4.4 Multi-Model Aggregation

Docs 描述该功能可以把不同平台的 conversations 收集到 sidebar，并将不同 models 的 responses 合并为一个 export file。首页也描述可把 Claude、ChatGPT、Gemini、DeepSeek 等 conversation 加入 sidebar，用于 review、collection 或 export。

### 4.5 Cross-Page Aggregation

Docs navigation 中单独列出 Cross-Page Aggregation，并在 key features 中描述可从不同 tabs 和 models 添加 conversation 到 sidebar，最后统一导出。

### 4.6 AI Navigation

首页描述 popup dropdown 可在 AI websites 间快速切换，并支持 drag reorder 和 pin 常用 AI tools。

### 4.7 Local Favorites

Docs key features 中提到 Local Favorites，用于在本地保存重要 conversations，方便之后快速参考。

## 5. 导出与转换格式

公开页面出现的导出 / 转换格式：

| 类型 | 公开描述 |
| --- | --- |
| PDF | 首页和 FAQ 主推能力；包含 full page PDF、样式主题和 long chat 支持。 |
| Markdown | 免费导出格式之一，也用于 Notion sync 的格式保真。 |
| Word / DOCX | 首页、FAQ 和 docs 提到支持 Word export。 |
| TXT | 免费导出格式之一。 |
| JSON | 免费导出格式之一。 |
| PNG / image | Docs 提到 PNG image export 和 high-resolution long images。 |
| Copy as Markdown | Docs navigation 中单独列出。 |
| Markdown to PDF | 首页工具入口和 docs feature links 中出现。 |
| Markdown to Word | 首页工具入口中出现。 |
| Markdown to HTML | 页脚工具链接中出现，指向 domarkdown.com。 |

## 6. 内容保真能力

公开页面反复强调导出内容应尽量保留原始 AI UI 的结构和信息。

已明确提到的保真对象：

- Code syntax highlighting
- Code language tags
- LaTeX / math formulas
- Tables
- Inline images
- Attachments
- Rich media web content
- Timestamps
- Model names / model version
- Source URL
- Google AI Overview results
- Deep Research content from Gemini and ChatGPT
- Long chats / thousand-turn chats

## 7. PDF 与样式能力

Docs 和首页提到 PDF 相关能力包括：

- Elegant PDF layout
- Multiple PDF styles / themes
- Dark / Light modes
- Built-in styles such as Light、Dark、Memo cards
- 首页还展示了 highlighted、dark mode、cherry blossom 等 theme 表述

Docs navigation 中还包含：

- Customize PDF Style
- Show / Hide Thinking Process
- Show Message Timestamps
- Include Source URL

## 8. Notion 集成

公开页面和 Notion 文档显示：

- 支持连接 Notion workspace。
- 支持同步到 Notion page 或 database。
- 支持 full conversation sync。
- 支持 single message sync。
- 支持 selected messages sync。
- 支持 Markdown formatting、code blocks、tables、images 等内容结构。
- FAQ 描述用户需要保持 Notion 登录状态，然后从 AI Exporter 发起 sync。
- 文档中还出现禁用 Notion integration 的入口。

## 9. 浏览器支持

FAQ 写到官方支持：

- Chrome
- Microsoft Edge
- Firefox

同时表示可运行于 Chromium-based browsers，包括 Brave、Arc 和 360 Browser。

首页还展示了 Chrome Extension、Edge Extension、Firefox Extension 三个安装入口。

## 10. 价格与额度

FAQ 写到：

- Markdown、TXT、JSON、image export 免费。
- PDF、Notion、Word exports 包含每日免费试用额度。
- AI navigation、chat aggregation 和其他 core features 免费。

## 11. 隐私与数据处理声明

FAQ / 首页声称：

- Markdown、TXT、JSON、image、Notion 等功能主要在 local browser 中运行。
- PDF generation 会临时在服务器处理。
- PDF 文件创建后数据会被删除。
- 公开文案声称不会存储、分析或分享用户 conversations。

Chrome Web Store listing 还披露该扩展处理 personally identifiable information 和 user activity。该披露是 store 层面的权限/数据分类信息，应与官网隐私声明一起看待。

## 12. 能力地图

| 能力域 | 能力项 |
| --- | --- |
| Platform coverage | 多 AI platform 支持；ChatGPT、Gemini、Claude、DeepSeek、Grok、Copilot、Google AI Studio、Perplexity、NotebookLM、Kimi、YuanBao、Qwen、Doubao 等 |
| Capture / selection | Full page export、Selective export、Single message export |
| Aggregation | Multi-model aggregation、Cross-page aggregation、sidebar collection |
| Export formats | PDF、Markdown、Word、TXT、JSON、PNG / image |
| Conversion tools | Markdown to PDF、Markdown to Word、Markdown to HTML |
| Fidelity | Code、LaTeX、tables、images、attachments、timestamps、model names、source URL、long chats |
| Knowledge integration | Notion page / database sync、full / selected / single message sync |
| Navigation | AI platform popup dropdown、reorder、pin |
| Settings | PDF style、thinking process visibility、timestamp visibility、source URL inclusion |
| Browser support | Chrome、Edge、Firefox、Chromium-based browsers |

## 13. 不确定性与待核验点

- “15+”、“12+”、“over 10” 是公开页面中的不同数量表述，不能直接推导精确平台总数。
- Chrome Web Store listing 的实际权限、host matches、版本更新记录需要在实现前单独核验。
- Notion sync 的具体数据 schema、授权流程和失败处理未在公开页面中完整展开。
- Single Message Export、Cross-Page Aggregation、Multi-Model Aggregation 的细节需要逐页阅读 docs feature pages 或实际安装 extension 验证。
