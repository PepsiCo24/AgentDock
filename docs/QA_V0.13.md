# AgentDock V0.13 QA (2026-11-19)

## Regressions tested

1. Start uploading a file in session A, switch to session B in the same project before completion. Confirm the late upload is not attached to session B. The bytes may remain in the original project's uploads folder.
2. Expand a Git worktree change list and a file diff. While the Agent updates activity and Token usage, confirm the expanded content stays open. Switching sessions must replace it.
3. If a previewed image disappears or is unreadable, show a retryable error and disable attach/download/reveal.
4. With a Chinese IME, Enter used to choose a candidate must not submit a task.
5. While an attachment uploads, disable send and show the upload state.

## Automated validation

- `npm run check` and `npm test`.
- Pure-state tests for project/session/epoch upload scope and activity identities.
- DOM regression harness executes `renderActivity()` and verifies preservation of expanded worktree nodes.
- Independent HTTP health check and Demo task on isolated local data.

## Outstanding manual acceptance

- Real keyboard, drag/drop and mobile visual interactions in the owner's browser
- Authenticated Codex, Claude Code, and Antigravity execution in the owner's environment

No changes to persisted session schema, provider CLI flags, task approvals, or server network exposure.
