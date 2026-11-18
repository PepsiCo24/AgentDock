# AgentDock V0.10 — quality assurance

## Baseline and changes

- Based on GitHub main at commit `e89da69e59c58b65d3c444e14697fabe505e1645` (V0.9).
- UI changes: duplicate creation guards; streaming DOM reuse; coordinated mobile drawers; project-safe drag and drop.
- No migration of user state or changes to vendor CLI flags.
- The project remains bound to `127.0.0.1` and requires task-level authorization for editing.

## Verified in isolated source workspace

- `npm run check`: passed (Node.js 22).
- `npm test`: 93/93 passed before remote extra-test reconciliation.
- Isolated HTTP health check returned `{"status":"ok","version":"0.10.0"}`.
- A Demo Agent task created a session, returned HTTP 202 on submit and finished with a user+assistant message.
- Static brand SVGs served successfully from loopback.
- Browser automation of loopback address was blocked by execution-environment policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). **Not** counted as successful live UI acceptance.
- Authenticated Codex, Claude Code and Antigravity integrations remain **not tested** on the owner's machine.

## Suggested manual QA on the owner's computer

1. Double-click new-session and project-create controls; verify only one item appears.
2. Run a long streaming task, select/copy an older message, and check that text selection is not reset.
3. At a narrow viewport, open project drawer, then inspector; ensure the previous drawer closes and the backdrop/Escape close the active one.
4. Drag a project file into the task composer; switch projects before drop and verify the cross-project attachment is rejected.
5. Verify downloads, approvals, stopping jobs, and SSE reconnects still work.

## Scope

No remote deployment, no automatic application of Git patches, and no claim of real vendor desktop-session sharing.
