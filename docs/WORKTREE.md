# Git worktree 隔离模式（V0.3）

AgentDock 在可写任务中提供 **可选** `Git 隔离工作区`。启用后，批准的任务会基于仓库当前 `HEAD` 在 AgentDock 数据目录中创建全新的 *detached* Git worktree，然后从该目录启动 CLI。

**这不是 OS 安全沙箱，也不是 Git 的自动合并。** Agent CLI 仍以当前操作系统用户身份运行，它的终端工具或插件理论上可以读取、访问或修改隔离目录以外的资源。`plan`/`acceptEdits` 等权限模式由各厂商 CLI 负责。

## 使用流程

1. 本机已安装 Git，且添加到 AgentDock 的项目路径是 Git 仓库**顶层目录**，仓库至少有一个提交。
2. 选择 `允许修改项目`，勾选 `Git 隔离工作区`，发送任务。
3. 在出现的任务级授权面板确认后，AgentDock 在 `~/.agentdock/worktrees/<job-id>/` 创建工作区。
4. Agent 在新工作区执行；项目原目录的未提交更改、未跟踪文件**不会自动复制进去**。附件会复制到新工作区 `.agentdock/inputs/`。
5. 完成后在右侧「运行活动」查看隔离工作区路径、变更文件及打开文件管理器。检查更改后，按自己的版本控制流程选择是否应用至原项目。

## 重要说明

- 每次隔离写入任务**新建一个** worktree，并启动新的 CLI 对话。原目录的 CLI 远端会话 ID 不会被隔离任务覆盖。
- 项目处于 dirty 状态时，隔离工作区仍从已提交 `HEAD` 创建，所以可能与原目录当前内容不同。
- AgentDock 不自动执行 `git merge`、`git apply`、`git push`、`git reset`、`git clean` 或删除 worktree。
- 当前最多为一个会话保留 30 个工作区元数据；磁盘空间由使用者自行管理。删除工作区前先备份与审查未提交修改。
- 工作区内的复制附件不会被列入变更文件列表，避免用户误把辅助输入当作代码变更；它们仍实际存在于磁盘。

## 手动审查/回收示例

```bash
# 在 AgentDock 显示的 worktree 路径下检查具体内容
cd '/path/to/your/isolated/worktree'
git status --short
git diff

# 如果已经在其他地方保存或合并了工作区修改，
# 且 worktree 干净，可从原始仓库清理注册记录：
git -C '/path/to/original/repo' worktree remove '/path/to/your/isolated/worktree'
```

不要使用 `git worktree remove --force` 清理尚未处理的更改；该操作可能永久丢失成果。

## 安全边界

- 必须选择**受信任**仓库、安装的 CLI 以及 CLI 插件；本功能并不会限制网络或其他目录访问。
- 当前不会复制 `.env` 等未提交秘密到 worktree，这是有意为之；但 CLI 仍可能访问用户账户中其他位置的秘密。
- 若要求真正的隔离执行，请使用独立系统账户、容器、虚拟机或支持的操作系统沙箱，并配置最小权限。

## V0.4 逐文件差异（只读）

- 点击隔离工作区的「查看更改」展示文件状态；单击具体文件名调用 `GET /api/sessions/:id/workspaces/:id/diff?path=...`。
- 仅允许预览 `git status` 中当前真正变更的相对路径；已追踪文本文件对比 `HEAD`，未追踪文本文件有 36 KiB 原始大小限制，展示最多 72 Ki 字符。
- 不展开符号链接目标、不渲染二进制内容，也不自动合并、删除、恢复或清理任何文件。
- 如果显示截断或特殊类型提示，请使用本地 IDE 和 `git diff` 自行完整审查。
