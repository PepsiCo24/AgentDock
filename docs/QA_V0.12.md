# AgentDock V0.12 · navigation and file-preview QA

## Scope
- Agent rail, project selector and session rows preserve their DOM identity across live SSE refresh when IDs/order are unchanged.
- Session search supports keyboard navigation and explicit query clearing, scoped to the selected project/Agent.
- File panel shows loading/result counts and handles preview failures inline with retry.
- No change to CLI permissions, task execution, persistent data schema or network exposure.

## Verified in local isolated workspace (2026-11-18)
- npm run check: passed.
- npm test: 101/101 passed.
- GET /api/health: status ok, version 0.12.0.
- Demo Agent: POST session 201, POST message 202, two messages (user + assistant), terminal idle.
- GET /, /app.js, /apple-hig.css, /appearance.mjs, /ui-state.mjs, /brands/codex.svg: HTTP 200.

## Owner-device manual checks (not yet automated)
1. Keep focus in a session row while a task streams; focus should not jump.
2. Open native project selector while another session runs; live updates should not close it.
3. In search: ArrowDown/ArrowUp, Home/End, Enter, Escape, Clear, Cmd/Ctrl+K; also try no-match and 200% zoom.
4. Switch project or Agent with an active search filter: query resets.
5. Preview text, image, missing, binary, and oversized files: expect loading/error/retry and disabled actions on failure.
6. Check light/dark/system, 390/660/1024/1440px widths and reduced motion.

## Limits
No live owner-browser interaction or authenticated Codex, Claude Code, Antigravity CLI was verified. An SSH-tunneled or public server is not supported; the application remains loopback-only.
