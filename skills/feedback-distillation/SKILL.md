---
name: feedback-distillation
description: Use when the user explicitly asks Codex to remember, distill, reflect, review, or record a correction; when the user points out a repeated mistake, wrong abstraction, high-friction misunderstanding, or reusable success pattern that should become future guardrail.
---

# Feedback Distillation

## 核心原则

把对话中出现的反馈信号沉淀成可审查、可复用的后置 guardrail。不要写聊天流水账；只记录会改变后续行为的认知修正、反复错误、高摩擦模式或成功模式。

本 skill 不负责事前 `context briefing`。如果用户只是要开始一个新任务，先按任务本身工作；只有当用户明确要求“记下来 / 沉淀 / distill / 反思 / 复盘 / 以后注意”，或给出明显纠偏信号时，才使用本 skill。

## 流程

1. Triage：判断是否值得沉淀。
   - 用户明确说“记下来 / 沉淀 / 反思 / 复盘 / 以后注意”。
   - 用户纠正了 agent 的架构抽象、需求理解或执行边界。
   - 同类错误、低效沟通或错误假设反复出现。
   - 出现了值得默认复用的成功模式。
   - 可以提取成微小、可重复使用的 skill 或 checklist。
   - 如果只是普通背景、普通过程总结或一次性偏好，不写入 memory。

2. Distill：把内容压缩成五个字段。
   - `Signal`：用户给出的触发信号。
   - `Observation`：发生了什么；可以是 mistake、friction、success pattern 或 skill opportunity。
   - `Correction`：更准确的抽象、边界或做法。
   - `Guardrail`：以后遇到类似场景时默认执行的规则。
   - `Applies`：适用范围，例如当前 repo、Chrome Extension、architecture discussion、所有 coding task。

3. 选择落点。
   - 项目专属内容写入当前 repo 的 `memory/YYYY-MM-DD.md`。
   - 跨项目复用且会频繁触发的内容，建议提炼成 skill。
   - 已经在 spec、ADR、README 中表达清楚的项目决策，不重复写入 memory，除非用户明确要求审查记录。

4. 写入方式。
   - 使用当天日期命名文件：`memory/YYYY-MM-DD.md`。
   - 只追加，不覆盖、不重写、不整理旧 entry。
   - 如果文件不存在，创建文件并写入一级标题 `# YYYY-MM-DD`。
   - 每次调用都追加一个新的二级标题，标题格式为 `## HH:mm - <短标题>`。
   - 如果是同一会话或同一主题的后续纠偏，仍然追加新 entry，并在 `Relation` 字段写明关联对象，例如 `Follow-up to: HH:mm - <短标题>`。
   - 默认中文书写，保留必要英文术语、API 名、字段名和命令。
   - 写入前移除 secrets、token、Cookie、账号信息和敏感 payload。

5. 完成后确认。
   - 简短说明写入路径。
   - 如果仓库规则要求提交和推送，按仓库规则处理。

## Memory Entry 模板

```markdown
## HH:mm - <短标题>

Relation:
<New | Follow-up to: HH:mm - <短标题> | Supersedes: HH:mm - <短标题>>

Signal:
<用户给出的纠偏或沉淀信号。>

Observation:
<错误认知、低效模式、高摩擦点、成功模式或 skill opportunity。>

Correction:
<更准确的抽象、边界或做法。>

Guardrail:
<以后遇到类似场景时默认执行的规则。>

Applies:
<适用范围。>
```

## Append-Only 规则

- 旧 entry 是审查证据，不要为了“更干净”而改写。
- 新反馈修正了旧结论时，追加新 entry，并用 `Relation: Supersedes: ...` 标记。
- 新反馈只是补充上下文时，追加新 entry，并用 `Relation: Follow-up to: ...` 标记。
- 同一会话内多次调用也逐条追加，保留发生顺序。
- 只有用户明确授权重写，或需要修正错别字、乱码、格式损坏、secrets 泄漏时，才允许修改旧 entry；修改后必须说明原因。

## 不要记录

- 普通过程总结。
- 没有 `Guardrail` 的感想。
- 事前 context brief、普通项目背景或需求梳理。
- 已经由 commit message、spec 或 ADR 清楚表达的重复内容。
- 只对当前一次对话有意义、不能复用的细节。
- secrets、credential、Cookie、access token、private payload。

## 常见错误

| 错误 | 修正 |
| --- | --- |
| 把用户反馈原样贴进 memory | 提炼成 `Signal -> Observation -> Correction -> Guardrail -> Applies` |
| 只写“以后注意” | 写成可执行的默认行为 |
| 记录所有聊天细节 | 只记录能改变后续行为的内容 |
| 把项目决策和 agent 纠偏混在一起 | 项目决策进 spec/ADR；认知纠偏进 memory |
| 回头改写旧 entry | 追加新 entry，用 `Relation` 表达修正或补充 |
| 把本 skill 当作事前需求澄清 | 本 skill 只处理后置反馈；事前 context briefing 另设独立 skill |
