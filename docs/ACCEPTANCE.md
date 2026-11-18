# AgentDock V0.7 测试与验收说明

最后本地测试：2026-11-17 · Linux · Node.js v22.16.0。

## 自动化验证

```bash
npm run check
npm test
npm run diagnose
```

测试覆盖：V0.3 原有 35 项 + V0.4 的执行历史/重启中断/显式重试/重新授权/附件重新验证/单文件 Git 差异/HTTP 分页及权限等测试。最终通过数与具体命令输出以本次生成的测试报告为准。

## 本地 HTTP 验收

- `GET /api/health` 应返回 `{"status":"ok","version":"0.7.0"}`。
- `GET /api/sessions/:id/runs` 可分页，不把完整待执行队列作为 HTTP 响应公开。
- 未带正确 `X-AgentDock-Token` 的 POST 重试返回 403；不可重试任务返回 409。
- 重试可写任务需要再次批准；重启前的队列/批准全部失效。
- `GET /api/sessions/:id/workspaces/:worktreeId/diff?path=...` 仅返回当前工作区的已变更文件；越界路径、符号链接内容、二进制/大型文件受限。

## 需要设备端手工确认

- 已安装并登录真实 Codex、Claude Code、Antigravity CLI 的命令格式、事件流与续接协议。
- Windows/macOS 浏览器 UI、多窗口操作、原生 Finder/Explorer。
- 原生桌面 App 与 CLI 的会话是否真的能共用（当前不保证）。
- 执行历史、逐文件差异的真实用户体验；自动测试不等于真机视觉验收。
- 工具逐次授权、正在运行中插话、订阅余额监控（暂未实现）。

## 安全边界

`plan` 不代表 OS 沙箱。`edit` 仅是执行前的一次任务授权。重试可能重复触发已部分完成的操作；故障自动重试被明确禁止。工作区审查只读，**不会自动合并**。

## V0.5 补充验收

- [x] 解析跨 chunk 中文/Emoji NDJSON，输出限制与非法记录隔离。
- [x] 用 mock CLI 运行 Codex/Claude/Antigravity，测试 session ID 续接、权限参数、部分输出与最终结果。
- [x] 终结事件缺失、全无 JSON 的进程即使退出码 0 也报失败。
- [x] 在 HTTP 层测试 SSE `ready.bootId`、新会话与重命名目录广播。
- [x] 前端静态合约测试确认连接标识和安全文本节点。
- [ ] 真正登录的 Codex/Claude/Antigravity CLI 版本、认证、消耗额度与续接需用户电脑实机验收。
- [ ] 官方桌面 App 双向历史同步与厂商逐工具权限审批尚未实现。

## V0.5 最终验收结果（2026-11-18）

- `npm run check` 通过。
- `npm test`：64/64 通过，包括协议适配、UTF-8 NDJSON 解析、缺失最终事件处理、SSE 目录广播及进程标识刷新。
- 以上仅证明本地模拟与协议逻辑；未使用真实已登录的厂商 CLI。
- GitHub Actions 本版运行通过。

## V0.6 release checks

- `npm run check` passes; `npm test` includes session reset, stale windows, running/queued reset refusal, simulated resumed-task failure, CLI JSON metadata and HTTP route checks.
- `git apply --check` validates complete exported text patches against a clean sample Git repository. No automatic apply/merge is executed.
- Manual reset preserves local chat history, clears only the remote CLI continuation ID, and does not re-run any task. A subsequent edit still needs task-level approval.
- Demo and mock CLI tests do not establish that authenticated vendor CLI versions work end to end. Verify externally before treating an agent as production-ready.

## V0.7 local acceptance (2026-11-18)

- `npm run check`: passed (server and browser ES modules).
- `npm test`: 89/89 passed, including stream burst throttling, startup selection, upload capacity, active-slot edit approval and safe file explorer limits.
- Separate-process smoke test on port 43173 with an isolated data directory: health `0.7.0`, browser helper module HTTP 200, Demo task completed.
- GitHub publication and CI are independent steps: this local checklist does not claim the user's currently running local browser has been upgraded.
- Authentic Codex/Claude/Antigravity sign-in and model execution still require testing on the installed device.
