# Feedback Distillation Skill Plan

## 背景

用户提供了一条关于“先写上下文文档再使用 AI”的 clipping。该材料强调的是 context-first：在行动前外化背景、已尝试方案、成功/失败标准、影响方和约束，让人和 AI 都先理解问题。

## 判断

这个方向有价值，但当前阶段不做前置 `context briefing`。本阶段只优化后置 `feedback distillation`：当用户在对话过程中给出纠偏、复盘、沉淀、反复错误或成功模式信号时，将它转成可审查、可复用的 memory entry。

## 当前 Scope

- 保留 `feedback-distillation` 作为后置反馈沉淀 skill。
- 明确它不负责普通任务开始前的 context brief。
- 强化写入前的 triage：只有能改变后续行为的反馈才写入 memory。
- 强化结构：entry 必须包含 `Signal`、`Observation`、`Correction`、`Guardrail`、`Applies`。
- 保持 append-only 默认策略；只有用户明确授权重写时，才允许重写旧 entry。

## 暂不做

- 不创建 `context-briefing` skill。
- 不要求每个任务开始前都写 context document。
- 不把普通项目背景、spec、ADR 内容重复写入 memory。

## 后续机会

如果后续反复出现“任务开始前背景不清导致返工”，再创建独立的 `context-briefing` skill。它应负责事前建模，而不是混入 `feedback-distillation`。
