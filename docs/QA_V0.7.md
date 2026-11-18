# AgentDock V0.7 - frontend/backend stabilization

## Scope and evidence

This iteration uses the V0.6 source archive as an isolated starting point and reconciles with the GitHub `main` branch before publication. The connected user browser tab at `http://127.0.0.1:4173/` was readable but not interactive in Chat mode. Therefore local HTTP, Node tests, source review, and mock CLI runs are **not** a substitute for clicking through the user's running macOS instance.

## Reproduced and addressed

| Symptom | Root cause | Fix / verification |
| --- | --- | --- |
| Duplicate tasks via Enter or button while a send is pending | `sendMessage` had no request-level lock | Lock the submission, snapshot session and prompt, retain a newly typed draft; UI contract checks |
| Switching sessions could send a previous session's draft | One shared textarea, no per-session draft ownership | Tab-local in-memory per-session drafts, disable composer during navigation |
| Switching project/agent could show stale file results and preview | Awaited fetch response applied without comparing the view | Request epochs and project/directory/query guards, pure helper unit tests |
| Reload could create an unsolicited Demo session | Startup defaulted to Demo even when other sessions existed | Restore URL/sessionStorage choice; reuse existing session, create Demo only when all sessions are empty |
| Uploading >12 attachments created unnecessary files | UI checked the count after sending a POST | Enforce capacity before uploading, single upload batch lock, avoid cross-project attachment |
| Newly installed CLI still shown unavailable | Diagnostics displayed a toast but never refreshed catalog | Refresh bootstrap after checking CLI versions |
| Narrow screens could not open project/session list | CSS entirely hid sidebar below 660px | Mobile drawer, backdrop, Escape support; inspector hidden until explicitly opened |
| Worktree edit authorization delayed by full worker pool | Authorization happened after concurrency check | Prompt approval independently of worker slot, then wait to execute; test with concurrent Demo tasks |
| Long CLI output caused excessive synchronous disk writes | One `Store.save` and SSE emit for every NDJSON text fragment | Coalesce progress publication to 120ms, retain final durable state; burst stream test |
| Project files missing from large folders | First 300 entries were selected before sorting | Sort directories first, then cap; regression test with 300+ files |
| Runtime console displayed a stale version | Server start message was hard-coded | Version source unified with API V0.7 |

## Test strategy

- `npm run check`: JavaScript syntax of server and browser modules.
- `npm test`: core state, HTTP + security, CLI protocol mock, bounded NDJSON, SSE, worktree/patch export, run history, startup selection and upload capacity.
- Smoke-run on an isolated data directory and alternate local port to prevent contamination of the user's macOS data.
- Verify `GET /api/health` and `GET /ui-state.mjs`, plus a Demo request and final run status.
- Verify GitHub Actions after publication; do not label remote CI as passing until the workflow result is returned.

## Not verified

- A live click-through of the user's browser tab, console warnings, layout pixel alignment and drag/drop on their machine.
- Real signed-in Codex/Claude/Antigravity CLI compatibility, including model access and continuation behavior.
- System-native windowing and OS file-drop integration.

## Update a running local instance safely

1. Back up `~/.agentdock/state.json` and inspect `git status` before pulling.
2. Stop **only** the AgentDock process on port 4173. Do not terminate unrelated services.
3. Pull the verified GitHub commit into the local checkout, or unpack the published source ZIP into a fresh directory.
4. Run `npm run check && npm test && npm start` in that directory.
5. In the browser, hard-refresh the local page, verify V0.7, create a Demo task, switch sessions, drag a small file, and test mobile-width navigation.

Never expose the local service through a public reverse proxy; task-level approvals are not OS-level sandbox isolation.
