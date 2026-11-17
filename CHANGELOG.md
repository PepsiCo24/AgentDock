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
