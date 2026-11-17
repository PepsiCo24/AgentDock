# AgentDock · 本地多 AI Agent 工作台

[![CI](https://github.com/PepsiCo24/AgentDock/actions/workflows/ci.yml/badge.svg)](https://github.com/PepsiCo24/AgentDock/actions/workflows/ci.yml)

**V0.4 MVP / local-first / Node.js 20+ / 零生产 npm 依赖**

AgentDock 是一个多 Agent 本地工作台：在同一个网页或多个独立浏览器窗口中管理项目与 CLI 会话，查看任务进度，搜索和拖拽文件。支持 Demo、Codex CLI、Claude Code CLI、Antigravity CLI（`agy`）。使用 CLI 已登录的凭据，AgentDock 本身不上传 API Key、不代售模型额度。

> 这是独立实现的原型，不是原版 Agent Frontdesk 的镜像或 fork。**不保证**与官方桌面 App 的历史会话共享、逐工具实时审批或任务执行中真正插话。不同 CLI 权限模式的限制也不等同于容器隔离。

## 1. 本地启动

```bash
# 需要 Node.js >=20
npm run check
npm test
npm run diagnose
npm start
```

打开 **http://127.0.0.1:4173**。首次启动自动出现 Demo 项目和会话；可先使用 Demo 测试所有 UI 流程。

在 macOS/Linux 可使用 `PORT=4300 npm start` 改端口；`AGENTDOCK_DATA_DIR=/some/dir npm start` 选择独立状态目录。数据默认保存在 `~/.agentdock/state.json`，仅监听本机 `127.0.0.1`。

## 2. 接入实际 Agent

先在**运行 AgentDock 的同一台电脑**安装、登录并测试相应 CLI（任选已拥有的服务）：

```bash
codex --version
claude --version
agy --version
```

网页会检测它们是否位于 PATH；左下角「检查 Agent CLI」只检查版本，不检查是否登录。选择 Agent，点击「添加本地项目」，输入受信任项目的**绝对路径**，然后新建会话、输入任务。

- **计划/受限模式（默认）**：Codex 使用 `--sandbox read-only`；Claude 使用 `--permission-mode plan`；Antigravity 使用 `--mode plan`。这些参数的**实际安全限制由各 CLI 自行实现**，不是 AgentDock 实现的 OS 级隔离。
- **允许修改项目**：先提交任务，AgentDock 将进入“等待授权”状态。需要点击“批准本次执行”才会启动 CLI；或点击拒绝/停止。Codex 使用 `workspace-write`；Claude 使用 `acceptEdits`；Antigravity 使用 `accept-edits`。**这是每个任务执行前的人工确认，不是对每条工具调用的审批**；不要对不可信项目开启可写模式。
- 从不使用 `--dangerously-skip-permissions`、`danger-full-access` 等危险绕过选项。第三方 Agent 仍可能有它们自己的配置、网络权限或高权限工具。建议使用独立系统账户、Git 工作区等防护。

参考官方说明：[Codex CLI](https://learn.chatgpt.com/docs/cli/reference)、[Claude Code CLI](https://code.claude.com/docs/en/cli-reference)、[Antigravity CLI](https://antigravity.google/docs/cli/headless/)。

## 3. V0.4 功能与状态

| 功能 | 说明 |
| --- | --- |
| 多 Agent / 项目 / 会话 | Agent、项目和会话独立管理；全局默认最多 3 个同时执行的任务，超出的排队 |
| Git worktree 隔离写入 | 可写任务可选从 Git HEAD 新建独立 worktree；完成后可查看路径、变更和打开文件管理器，**不自动合并** |
| 逐文件差异审查 | 在 Git 隔离工作区点击变更文件即可查看**只读且有上限**的文本差异；不显示符号链接目标文件内容、二进制及大型未跟踪文件；不自动应用改动 |
| 持久化执行历史 | 保存最近 150 条任务元数据（状态、耗时、Token 使用量和关联消息）；历史分页加载，每次最多 50 条 |
| 显式故障重试 | 失败或重启中断的任务可人工点击重试。编辑任务**重新要求授权**；重试前提醒原任务可能已发生部分文件修改 |
| 重启恢复边界 | 启动时将旧的运行中、排队中、等待批准任务统一标记为中断，不自动重放任务或复用过期批准 |
| CLI 诊断 | 只检查 PATH 与 `--version`，不读取密钥、不承诺登录成功 |
| 独立窗口 | 会话右上角 ↗ 打开独立浏览器窗口；不是原生桌面 App 窗口 |
| 消息队列 | 同一会话新任务排在上一任务后；**不是**实时打断式插话 |
| 任务停止 | 发送停止信号、超时强制结束，清空待执行队列 |
| 可写任务授权 | 执行前必须逐次明确批准，不通过 HTTP 直接绕过 |
| 运行状态 | 从 CLI JSONL 读取执行阶段、工具**类别**、错误；不展示工具参数/机密输出 |
| Token 统计 | 仅展示 CLI 回传的最近一次 Token 值；不推断价格或订阅余额 |
| 文件交互 | 浏览、搜索、拖拽上传（每文件 10 MB、每次最多 12 个）、文本/图片侧边预览 |
| 文件操作 | 在原生文件管理器中定位，或下载小于 30 MB 的副本 |
| 持久化 | 会话消息和 Agent session ID 写入本机 JSON；重启后授权/排队全部失效，避免意外重跑 |

**实际验证状态**：`npm test` 在本地测试环境验证了 Demo、HTTP 路由、安全校验、持久化/迁移、Git 差异和三类 CLI 的**模拟 NDJSON 进程**。没有完成真实的 Codex/Claude/Antigravity 登录 CLI 端到端验证，因此真实厂商执行与官方 App 接续**尚未验收**。

## 4. 项目结构

```text
src/core.mjs             状态、项目、历史分页/迁移、目录范围保护和文件名搜索
src/agents.mjs           Agent 适配、并发限流、执行队列、显式重试、授权和运行状态
src/worktrees.mjs        Git worktree 创建、附件镜像、变更列表及只读单文件 diff
src/server.mjs           127.0.0.1 本地 HTTP/SSE API、上传/预览/下载
public/                  浏览器工作台 UI（原生 JS/CSS，无前端框架）
test/                    单元、HTTP 集成、真实 Git 仓库和模拟 CLI 进程测试
docs/DEVELOPMENT_PLAN.md 路线图与验收边界
docs/WORKTREE.md        worktree 的安全边界与手动回收
docs/RUN_HISTORY.md     历史持久化、重试和 HTTP 接口说明
docs/CLI_COMPATIBILITY.md CLI 真实环境验收矩阵
scripts/diagnose.mjs    非认证式 CLI 版本诊断
.github/workflows/ci.yml Node 20 / Node 22 CI
```

## 5. 安全注意事项

1. 这是**单用户、本机工具**，不支持公网部署或多用户权限。不要用反向代理将 4173 端口暴露到互联网。
2. HTTP 写入采用随机启动令牌，检查 Host 和 Origin；文件路径在项目边界内进行真实路径检查，拒绝越界符号链接。Token 可以由同源本地页面获取，**不能**抵御拥有本机执行权限的恶意软件。
3. 拖入文件会创建副本到项目 `<project>/.agentdock/uploads/`。文件不会自动上传至 AgentDock 的任何远程服务器，但**所选 Agent CLI 可能按用户指令把文件内容发送给其模型服务**。
4. 进程的实际文件、网络权限仍遵循本机 OS、CLI 和其插件配置。多 Agent 对同一工作区并发修改时可能互相覆盖，建议使用内置的可选 Git worktree 模式，但它仍不是操作系统沙箱。
5. 文件路径搜索只检查文件名（不是全局全文索引），忽略 `.git`、`node_modules`、`.agentdock` 等目录，限制最多 100 条结果。
6. 不保存 CLI 登录密钥、不主动查询浏览器 Cookie，也不绕过订阅平台限制。

## 6. 验收与后续

```bash
npm run check
npm test
npm run dev
```

- **已验收**：Demo 流程、HTTP 接口、消息排队/停止、任务前授权、路径保护、模拟三种 CLI 的事件/Token/错误/中断。
- **待真机验收**：在 macOS、Windows、Linux 安装对应 CLI 后对每个适配器分别跑真实任务；核查不同版本 `resume` 参数、权限模式和远端 ID。
- **后续**：如官方协议支持，再开发逐工具审批和真正的执行中插话；研究与官方 App 共享/导入会话；从官方允许的接口获取额度；可选 Tauri 原生多窗口打包。

开发计划见 [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)。隔离工作区详细说明见 [docs/WORKTREE.md](docs/WORKTREE.md)，执行历史与安全重试见 [docs/RUN_HISTORY.md](docs/RUN_HISTORY.md)，厂商 CLI 的真实验收清单见 [docs/CLI_COMPATIBILITY.md](docs/CLI_COMPATIBILITY.md)。
