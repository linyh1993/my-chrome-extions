# my-chrome-extions

本仓库用于存放个人 Chrome 扩展项目。

## Chrome 扩展开发指引

编写或修改扩展（`manifest.json`、content script、service worker、消息通信、权限、`chrome.storage` 等）时，**请先阅读**：

**[docs/chrome-extension-guide.md](docs/chrome-extension-guide.md)**

该文档是本仓库 Chrome 扩展开发的唯一准则，面向 Manifest V3 与本仓库实践；仅在相关任务时按需加载，无需每次会话全文带入。

默认不要访问官方文档；优先按本仓库指南和现有代码实现。只有用户明确要求，或本地指南无法覆盖且不查证会带来明显风险时，才访问 Chrome 官方文档。

## 通用 LLM 编码准则

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 开发流程

按 `PLAN -> BUILD -> VERIFY` 循环工作，直到改动可验证或明确受阻。

- `PLAN`：基于模型推理和本地代码上下文形成简短实现计划；这里的 plan 是思考产物，不要求使用工具内置 plan。
- `BUILD`：按计划修改最小必要文件，保持 Manifest V3、service worker、content script、权限和消息通信边界清晰。
- `VERIFY`：运行可用的检查、测试或手动验证步骤；若发现问题，回到 `PLAN` 修正后继续。
- 无法验证时，要在回复中说明原因、已做的静态检查和剩余风险。

## 子项目


| 目录                  | 说明                                             |
| ------------------- | ---------------------------------------------- |
| `traffic-relay/`    | 按站点镜像 API 流量；MV3，含 side panel + content script |
| `x-comment-filter/` | X 单帖/Thread 评论过滤；默认折叠；架构可扩展更多页面类型              |


## 约定

- 所有扩展必须使用 **Manifest V3**（`service_worker`、`action`、`host_permissions`）。
- 不要引入历史 manifest 格式、旧后台页或旧消息 API；发现旧写法时应改为当前 MV3 API。
- 每个扩展独立子目录，根目录各自包含 `manifest.json`。
- 页面 DOM 操作用 content script；跨标签、存储、右键菜单等用 service worker。
