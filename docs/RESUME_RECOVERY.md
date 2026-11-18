# V0.6 - Manual CLI continuation recovery

## Why reset is explicit

A resumed CLI task can fail for many reasons: authentication, incompatible CLI version, stale remote ID, permissions, a tool failure, or an interrupted process. AgentDock never guesses the root cause from stderr and never silently repeats a failed task. A previous task may already have edited files or consumed model tokens.

## Recovery procedure

1. Inspect the failed task's status and any changes in the project/worktree.
2. Check the CLI locally (`npm run diagnose -- --json`) and test vendor login with its own tooling.
3. Wait for any running/queued/awaiting-approval tasks to finish, or stop them.
4. In the header select **Reset CLI continuation**, review the confirmation, then approve the reset.
5. The local AgentDock chat/history stays intact. The saved vendor CLI ID is cleared; the next CLI invocation starts a fresh context.
6. To retry a failed or interrupted job, manually choose **Retry**. An editable task requires fresh approval and can cause duplicate side effects.

The reset endpoint is `POST /api/sessions/:id/reset-remote` with JSON body `{ "expectedRemoteId": "<current-id>" }` and the standard local `X-AgentDock-Token` header. If another window has updated that ID, the request returns HTTP 409. A running, queued or pending-approval task also returns 409. Reset is not a vendor-side account logout or history deletion.

## Patch export boundary

An optional per-file patch export is read-only and size-limited. Never auto-apply a downloaded patch; check what files it changes in a trusted local Git client before applying.

## Status

Implemented and covered by local unit/integration tests. Real vendor CLI authentication, official app session sharing and native multiwindow file drag remain outside tested scope.
