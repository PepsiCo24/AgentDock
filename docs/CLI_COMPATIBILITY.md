# CLI 兼容性与真机验收清单

2026-11-17 · AgentDock 0.5.0

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

## V0.5 已做的协议层改进

- `codex exec --json ... resume <session-id> -`：使用上一轮收到的 `thread.started.thread_id`；任务必须收到 `turn.completed` 才判为协议完成。
- `claude -p --verbose --output-format stream-json --include-partial-messages ... --resume <session-id>`：使用 `session_id` 续接，只收集 `text_delta` 和顶层 `result`；不展示 raw `tool_use.input` 或 `stderr`。
- `agy -p ... --output-format stream-json ... --conversation <session-id>`：使用 `conversation_id`，根据最终 `result.status` 判断成功或失败；`cache_read_tokens` 可作为实际用量字段。
- 三种 CLI 的返回事件以模拟 fixture 做自动测试，**不是**厂商账号现场验收。CLI 输出若缺少可识别终结事件会标记为失败并提供本地排查提示。
- CLI 非交互调用的授权模式不等于进程沙箱；未经严格验证的插件、Hook、MCP 工具仍可能执行副作用，强烈建议仅对可信仓库授权并优先使用 worktree。

来源：
- [Codex CLI 官方命令参数](https://learn.chatgpt.com/docs/cli/reference)
- [Claude Code 官方 CLI 参数](https://code.claude.com/docs/en/cli-reference)
- [Antigravity 官方 headless 说明](https://antigravity.google/docs/cli/headless/)

## V0.6 local version report and manual resume reset

`npm run diagnose -- --json` prints a JSON metadata report with platform, architecture, Node.js and CLI `--version` summaries. It intentionally does **not** check authentication, list credentials, inspect environment variables or run a task. Treat all installed vendor CLI compatibility as `not-verified` until tested on the target system.

If a resumed task fails, AgentDock records `resumeWarning` but cannot infer whether the remote ID caused the failure. Users may explicitly disconnect CLI continuation using the header reset control after all running, queued and pending tasks finish. Local AgentDock history remains, and the next task starts a fresh remote conversation. This is not an automatic replay or a guarantee that official desktop app history will be available.
