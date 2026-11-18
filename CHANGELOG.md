# Changelog

## 0.6.0 · 2026-11-18

- Added explicit remote CLI continuation reset; local chat/history stays intact. Reject stale-window resets and resets while running, queued or awaiting approval.
- Record a non-causal advisory for failed resumed runs. Do not auto-retry or automatically reset possibly mutating work.
- Export complete bounded single-file text Git patches for manual review. Refuse symlinks, binary, large/truncated and unsupported files. Never auto-apply.
- Add machine-readable local CLI version diagnostic report; login credentials and authenticated vendor CLI compatibility are not examined.
- Restored full SSE catalog sync and boot-id based multi-window reconnect in the published browser app.
- Local source package passed 75 automated checks; GitHub CI verifies repository tests separately. Real CLI and OS-native drag remain unverified.

## 0.5.0 · 2026-11-18

- 新增 UTF-8 安全的有界 NDJSON 解析器和协议异常/无终结事件检测，原始异常输出不出现在 UI。
- 规范 Codex、Claude Code、Antigravity 会话续接参数；验证远程会话 ID，防止其成为命令行选项或路径。
- 增加 Claude Code `text_delta` 增量事件处理，记录 `resumeMode`、`resumedFrom` 与远程会话 ID。
- 工具活动显示脱敏后的工具类别与阶段，不展示原始工具调用、参数和 stderr。
- 通过 SSE 广播项目/会话目录变更，使用 `bootId` 判断服务重启并同步状态与写入令牌。
- 本地 64 项测试通过，GitHub Actions CI 通过；真实登录的厂商 CLI 尚未验证。

## 0.4.0 · 2026-11-17

- 新增执行历史（每会话最多 150 条）：排队、待审批、运行、完成、失败、拒绝、停止和重启中断，支持分页。
- 支持失败/中断任务的**人工**重试，重新校验附件，记录原任务关系；可写任务不继承历史批准。
- 重启时将历史运行中和排队中的任务标为 interrupted，避免旧会话显示仍在排队。
- 新增隔离工作区的**只读逐文件 diff**，包括 Git 暂存/工作树变更、受限的新建文本文件，拒绝越界、二进制、符号链接内容和大文件。
- UI 展示执行历史、主动重试与逐文件差异；新增自动化测试和验收文档。
- **不包含**厂商真实 CLI 登录环境验收、官方 App 共享会话、逐工具调用审批、自动合并或后台自动重试。

# Changelog

## 0.3.0 (2026-11-17)

- Added opt-in detached Git worktrees for approved edit tasks, preserving uncommitted changes in the source project.
- Added per-session worktree inventory, changed-file listing and local reveal action.
- Kept original CLI session IDs separate from isolated-worktree CLI sessions.
- Added a global concurrency limit (default 3), queueing extra sessions and allowing queued-job cancellation.
- Added non-authenticating CLI version diagnostics via UI and `npm run diagnose`.
- Added real Git worktree tests; CLI tests remain mocked and do not validate live vendor authentication.
- Documented isolation limits and manual worktree review/cleanup.

## 0.2.0 (2026-11-17)

- Added task-scoped approval for project-editing Agent runs.
- Added explicit plan/edit execution modes and safe rejected/stale approval handling.
- Added recent run activity, duration and CLI-reported token usage.
- Added opening sessions in separate browser windows.
- Added project filename search and bounded file download.
- Added mock NDJSON process integration tests and HTTP security tests.
- Ensured approvals and queued work are never restarted automatically.
- Verified `npm run check`, `npm test` (25/25) and local health endpoint.

Limitations: real authenticated Agent CLI compatibility and vendor desktop-app session sync are not verified.
