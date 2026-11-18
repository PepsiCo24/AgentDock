# AgentDock V0.6 测试与验收说明

最后本地测试：2026-11-17 · Linux · Node.js v22.16.0。

## 自动化验证

```bash
npm run check
npm test
npm run diagnose
```

测试覆盖：V0.3 原有 35 项 + V0.4 的执行历史/重启中断/显式重试/重新授权/附件重新验证/单文件 Git 差异/HTTP 分页及权限等测试。最终通过数与具体命令输出以本次生成的测试报告为准。

## 本地 HTTP 验收

- `GET /api/health` 应返回 `{"status":"ok","version":"0.6.0"}`。
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

## V0.5 最终验收结果（2026-11-18）

- `npm run check` 通过。
- `npm test`：64/64 通过，涵盖 CLI 续接参数、UTF-8 NDJSON、缺失任务终结事件、SSE 广播及进程标识。
- GitHub Actions 本版 CI 成功。
- 只完成本地模拟与接口测试，真实厂商 CLI 的登录及执行仍待验收。

## V0.6 acceptance

Use `npm run check && npm test`, plus `npm run diagnose -- --json`. Verify reset endpoint requires the local write token and matching expected remote ID, does not erase local messages, and refuses running/queued/pending approvals. Verify a mock resumed CLI failure emits a warning without auto-replay. A complete exported text patch must pass `git apply --check` in a clean test repository without changing the source. The production system must not auto-apply or merge patches. Vendor CLI authentication and real desktop sessions have not been validated.
