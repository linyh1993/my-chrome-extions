---
name: feedback-distillation
description: Use when the user explicitly asks Codex to remember, distill, reflect, review, or record a correction; when the user points out a repeated mistake, wrong abstraction, high-friction misunderstanding, or reusable success pattern that should become future guardrail.
---

# Feedback Distillation

## 核心原则

把用户给出的纠偏信号沉淀成可审查、可复用的 guardrail。不要写聊天流水账；只记录会改变后续行为的认知修正、反复错误、高摩擦模式或成功模式。

## 流程

1. 判断是否值得沉淀。
   - 用户明确说“记下来 / 沉淀 / 反思 / 复盘 / 以后注意”。
   - 用户纠正了 agent 的架构抽象、需求理解或执行边界。
   - 同类错误、低效沟通或错误假设反复出现。
   - 出现了值得默认复用的成功模式。
   - 可以提取成微小、可重复使用的 skill 或 checklist。

2. 把内容压缩成五个字段。
   - `Signal`：用户给出的触发信号。
   - `Mistake`：agent 原先的错误认知、低效模式或缺失判断。
   - `Correction`：更准确的抽象、边界或做法。
   - `Guardrail`：以后遇到类似场景时默认执行的规则。
   - `Applies`：适用范围，例如当前 repo、Chrome Extension、architecture discussion、所有 coding task。

3. 选择落点。
   - 项目专属内容写入当前 repo 的 `memory/YYYY-MM-DD.md`。
   - 跨项目复用且会频繁触发的内容，建议提炼成 skill。
   - 已经在 spec、ADR、README 中表达清楚的项目决策，不重复写入 memory，除非用户明确要求审查记录。

4. 写入方式。
   - 使用当天日期命名文件：`memory/YYYY-MM-DD.md`。
   - 如果文件已存在，追加一个新的二级标题。
   - 默认中文书写，保留必要英文术语、API 名、字段名和命令。
   - 写入前移除 secrets、token、Cookie、账号信息和敏感 payload。

5. 完成后确认。
   - 简短说明写入路径。
   - 如果仓库规则要求提交和推送，按仓库规则处理。

## Memory Entry 模板

```markdown
## <短标题>

Signal:
<用户给出的纠偏或沉淀信号。>

Mistake:
<agent 原先的错误认知、低效模式或缺失判断。>

Correction:
<更准确的抽象、边界或做法。>

Guardrail:
<以后遇到类似场景时默认执行的规则。>

Applies:
<适用范围。>
```

## 不要记录

- 普通过程总结。
- 没有 `Guardrail` 的感想。
- 已经由 commit message、spec 或 ADR 清楚表达的重复内容。
- 只对当前一次对话有意义、不能复用的细节。
- secrets、credential、Cookie、access token、private payload。

## 常见错误

| 错误 | 修正 |
| --- | --- |
| 把用户反馈原样贴进 memory | 提炼成 `Signal -> Mistake -> Correction -> Guardrail -> Applies` |
| 只写“以后注意” | 写成可执行的默认行为 |
| 记录所有聊天细节 | 只记录能改变后续行为的内容 |
| 把项目决策和 agent 纠偏混在一起 | 项目决策进 spec/ADR；认知纠偏进 memory |
