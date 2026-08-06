# SaveAI / AI Exporter 能力参考

来源：

- [saveai.net 首页](https://saveai.net/)
- [AI Exporter docs](https://saveai.net/docs)
- [AI Exporter FAQ](https://saveai.net/faq)
- [Chrome Web Store listing](https://chromewebstore.google.com/detail/ai-exporter-save-chatgpt/kagjkiiecagemklhmhkabbalfpbianbe?hl=en)
- [Sync to Notion docs](https://saveai.net/docs/guide/export-to-notion)

## 支持平台

公开页面明确出现的平台：

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

页面还使用了 “15+ AI platforms”、“10+ leading AI platforms” 和 “12+ major AI platforms” 这类描述；实现时不要依赖这些模糊数字，应该以 site registry 中明确列出的 adapter 为准。

## 采集与选择能力

- Full page export：导出当前完整 conversation。
- Selective export：通过 checkbox 或 drag select 选择部分消息。
- Single message export：对单条 Q&A / message 做保存或同步。
- Cross-page aggregation：跨页面聚合内容。
- Multi-model aggregation：把来自多个 AI platform / model 的 conversation 放入 sidebar，再统一 review / collect / export。
- Deep Research export：支持 ChatGPT Deep Research 和 Gemini Deep Research 这类长内容模式。

## 导出格式

- PDF
- Markdown
- Word / DOCX
- TXT
- JSON
- PNG / image
- Copy as Markdown
- Markdown to PDF
- Markdown to Word
- Markdown to HTML

## 保真能力

- Code syntax highlighting
- LaTeX / math formula
- Tables
- Inline images
- Attachments
- Rich media web content
- Native UI-like formatting
- Long chat / thousand-turn chat export
- Timestamps
- Model version
- Source URL

## 知识库与集成

- Notion sync：把 conversation 同步到 Notion page / database。
- 支持 full conversation sync、single message sync、selected messages sync。
- 可以禁用 Notion integration。
- AI navigation：popup 中快速切换 AI websites，支持 reorder / pin。
- Sidebar collection：用于跨平台收集和比较 conversation。

## 隐私与安全声明

公开页面声称 Markdown、TXT、JSON、image、Notion 等功能主要在本地浏览器运行；PDF generation 会临时在服务器处理并删除数据。Chrome Web Store listing 披露该扩展处理 personally identifiable information 和 user activity。

对本项目的启发：

- 我们的第一版应坚持 local-first，不做云端 PDF generation。
- 不采集 Cookie、token、账号信息或隐藏 payload。
- 本地服务写入文件或 SQLite，数据默认不离开用户机器。

## 对本项目的取舍

第一阶段采用：

- 多平台 site registry
- Full conversation capture
- Manual trigger 和 automatic trigger 共用同一 capture engine
- JSONL / JSON 本地归档
- Markdown export
- Source URL、timestamp、platform、conversation id、message id、role、content metadata

第一阶段暂不做：

- PDF / Word 排版
- Notion sync
- Sidebar cross-model collection
- AI platform launcher
- Image watermark remover
- 复杂模板系统
