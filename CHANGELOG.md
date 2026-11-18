# Changelog

## 0.10.0 (2026-11-18)

- Guard session and project creation against repeated clicks, retaining the current navigation context when a request finishes.
- Reuse historical message DOM during streamed updates, preserving scroll and selections instead of rebuilding the full chat on every event.
- Coordinate the mobile project and file drawers with accessible toggle state, backdrop and Escape close behavior.
- Reject cross-project internal file drags to avoid attaching a same-named path from the wrong workspace.
- Add deterministic UI-state and interface-contract regression tests. Real remote CLI authentication and owner-device browser testing remain pending.


## 0.9.0 (2026-11-18)

- Replace placeholder Agent initials with locally served Codex, Claude Code and Antigravity identification marks; document provenance and trademark limits.
- Improve agent rail, provider subtitles, unavailable/selected states and composer focus contrast; respect reduced motion.
- Add contextual empty-session create/diagnose action and strict same-origin SVG serving.
- Add UI and HTTP brand route regression tests; existing CLI permissions and local data persistence remain unchanged.
- Local UI build tests 90/90 passing. Real desktop-browser validation and vendor CLI login compatibility are pending.

## 0.7.0 (2026-11-18)

- Fixed session/project/agent navigation races and prevented sending a task to the previous session while switching.
- Restored tab-local session selection and isolated per-session drafts; stopped automatic Demo-session creation when any session already exists.
- Prevented duplicate submits and preflight-checked attachment limits; blocked cross-project attachment after asynchronous upload.
- Refreshed CLI installation status after diagnosis; added a responsive mobile sidebar and inspector toggle.
- Exposed edit authorization while global CLI slots are full; approved jobs wait for a slot rather than bypassing concurrency limits.
- Throttled high-frequency CLI stream persistence and SSE to prevent file-system overload.
- Fixed directory sorting before the 300-item cap and corrected the runtime version label.
- Expanded UI, backend, streaming, HTTP and navigation regression tests. Full live-browser and authenticated vendor CLI testing remain pending.


## 0.6.0 (2026-11-18)

- Explicitly disconnect a stale remote CLI session ID without deleting AgentDock message history. A stale-tab ID is rejected, and reset is blocked while any task is running, queued, or pending approval.
- A failure during a resumed CLI task now records an advisory warning. It does not imply the resume ID was the cause, and it never silently clears context or retries possibly mutating work.
- Worktree review can export **one complete, bounded, text-only Git patch** for manual inspection. It refuses binary files, symlinks, oversized/unreadable files, unsupported path quoting and truncated diffs. No automatic apply/merge occurs.
- `npm run diagnose -- --json` exports a limited local compatibility preflight report. No credentials/authentication probe; vendor CLI acceptance must still run on a device with the vendor installed and signed in.
- Added reset/retry, Git patch validity (`git apply --check`), HTTP authorization and diagnostic tests. Vendor CLI E2E and desktop-app session sharing remain unverified.

## 0.5.0 · 2026-11-18

- 新增 UTF-8 安全的有界 NDJSON 解析器和协议异常/无终结事件检测，异常原始输出不出现在 UI。
- 规范 Codex、Claude Code、Antigravity 会话续接参数；验证远程会话 ID，防止其作为命令行选项或路径使用。
- 增加 Claude Code `text_delta` 流事件处理，并记录 `resumeMode`、`resumedFrom` 和实际返回的远程会话 ID。
- 工具活动显示脱敏后的工具类别与阶段；不展示原始工具调用、参数和 stderr。
- 通过 SSE 广播项目/会话目录变更，使用 `bootId` 判断服务重启，浏览器重连后同步最新快照与本地写令牌。
- 新增协议、NDJSON、安全和 SSE 测试。64 项本地测试通过，并在 GitHub Actions CI 通过。
- 仍未验证真实厂商 CLI 的登录与模型运行环境；原生 App 会话共享、实时逐工具审批和系统级多窗口拖放不在本版范围内。

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
