# V0.4 执行历史与故障恢复

## 范围与留存

- 每个会话最多保留最近 **150 条执行元数据**，写入本机 `AGENTDOCK_DATA_DIR/state.json`（默认 `~/.agentdock/state.json`）。
- 一条记录包含任务 ID、原始用户消息 ID、模式、创建/开始/结束时间、状态、耗时、CLI 实际返回的 Token 数、关联 worktree ID 和失败原因。历史列表只显示截断到 160 字的指令摘要。
- 原始任务文本及附件引用只保留在原有用户消息内。若旧消息因 500 条上限被裁剪，则该历史记录不能安全重试。
- 不存储 stdout/stderr 原始工具命令作为历史内容，仍需谨慎保护 `state.json` 和其备份。

## 状态机

`queued -> awaiting_approval -> queued -> running -> completed | failed | stopped`

计划任务从 `queued` 直接进入 `running`；可写任务必须明确批准后执行；拒绝为 `rejected`。服务启动时，所有 `queued`、`running`、`awaiting_approval` 历史状态被标记为 `interrupted`。过期任务队列被清空，**不会自动恢复**。

## 手动重试规则

- 仅 `failed` 与 `interrupted` 可由用户显式重新提交；完成、已拒绝和主动停止的历史任务不自动重试。
- 新任务使用独立的 job ID，并在 `retryOf` 字段记录源任务；重新验证源项目、附件路径及文件大小。
- `edit` 模式不继承任何以前的批准，仍进入 `awaiting_approval` 状态；隔离 worktree 模式会新建工作区，**不会继续使用旧工作区**。
- 即使之前显示“失败/中断”，模型可能已在失败前修改过项目。用户应先确认当前文件内容；再次运行可能造成重复副作用。

## 本地 HTTP API

`GET /api/sessions/:sessionId/runs?limit=20&offset=0`：返回 `{total,limit,offset,items}`，其中 `limit` 为 1–50，`offset` 为非负整数且不大于 150。`retryable` 由服务端根据历史状态和原消息是否仍存在计算。

`POST /api/sessions/:sessionId/runs/:runId/retry`：请求体为 `{}`，必须传启动时得到的 `X-AgentDock-Token`。不提供直接恢复原授权的选项。返回 202 + 新任务 ID，失败或过期消息返回 409。

`GET /api/sessions/:sessionId/workspaces/:workspaceId/diff?path=...`：只读单文件差异；必须是当前 `git status` 中的文件。已跟踪文件显示 `HEAD` 到当前 worktree 的差异，未跟踪文件小于 36 KiB 时显示有限文本行。二进制、符号链接、大文件和非变更路径不输出内容。UI 使用 `textContent` 显示差异，不解析为 HTML。

> 本应用仅限 `127.0.0.1` 本机使用。任务级授权与 Git worktree 并不是系统沙箱，不能防御拥有本机进程执行权限的恶意程序。
