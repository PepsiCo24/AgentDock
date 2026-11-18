# CLI 兼容性与真机验收清单

2026-11-17 · AgentDock 0.3.0

AgentDock 通过非交互 CLI 进程运行用户现有的 AI 编程工具。`npm test` 使用受控的 NDJSON 模拟 CLI，并不构成**已登录厂商 CLI**的真实验收。

| Agent | 程序 | 读取/计划模式 | 编辑模式 | 会话续接 | 验证状态 |
| --- | --- | --- | --- | --- | --- |
| OpenAI Codex | `codex exec` | `--sandbox read-only` | `--sandbox workspace-write` | `codex exec resume <id>` | 命令形式与官方文档核对；真实账号未测 |
| Anthropic Claude Code | `claude -p` | `--permission-mode plan` | `--permission-mode acceptEdits` | `--resume <id>` | 命令形式与官方文档核对；真实账号未测 |
| Google Antigravity CLI | `agy -p` | `--mode plan` | `--mode accept-edits` | `--conversation <id>` | 命令形式与官方文档核对；真实账号未测 |

**重要：**厂商版本变化可能影响参数、认证流程、权限模型、JSONL 事件或恢复会话行为。`installed` 只代表命令在 `PATH` 可用，不代表已登录、有权限或已通过版本兼容性验收。

## 本机核查

```bash
npm run diagnose  # 显示可执行程序检测与 --version，不检查登录状态
npm run check
npm test
npm start
```

在 UI 中也可点击左下角「检查 Agent CLI」。此操作不会查询凭据或打印环境变量、命令路径，但某些厂商 CLI 的 `--version` 可能执行自己的启动逻辑。

**逐平台真实验收**：使用独立测试仓库、最低授权模型，分别执行只读任务、用户批准后的可写任务、输出流、Token 统计、停止、超时、故障、会话续接与隔离工作区任务。记录实际版本号、系统平台及测试结果。失败时不要把它标为“兼容通过”。

参考资料：
- [Codex CLI 命令行选项](https://learn.chatgpt.com/docs/cli/reference)
- [Claude Code CLI 参考](https://code.claude.com/docs/en/cli-reference)
- [Antigravity CLI 参考](https://antigravity.google/docs/cli/reference/)

## V0.6 version diagnostics and recovery boundary

`npm run diagnose -- --json` emits a safe local metadata summary (platform, architecture, Node version and CLI version), not a credentials or authentication audit. CLI install and version do **not** imply end-to-end compatibility.

After a resumed run fails, inspect changes and manually choose the reset control if needed. It clears only AgentDock's stored remote CLI continuation ID. Local chat and run history remain; no failed job is automatically replayed. Running, queued and awaiting-approval tasks block reset.
