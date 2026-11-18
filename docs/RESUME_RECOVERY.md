# AgentDock V0.6: Manual CLI continuation recovery

A failed resumed CLI task might have already modified project files. AgentDock does not infer that the saved session ID caused the failure, auto-clear the ID or replay the task.

1. Review the previous task's result and Git changes.
2. Check the real CLI separately; \`npm run diagnose -- --json\` only reports version and never verifies login.
3. Finish or stop all running, queued and pending-approval work.
4. Choose **Reset CLI continuation** in the current AgentDock session header and confirm.
5. AgentDock clears its saved remote CLI ID while retaining all local chat and run history. The next task starts a fresh vendor context.
6. If required, explicitly retry the failed or interrupted task. Edit tasks require new approval and may have duplicate side effects.

Endpoint: POST /api/sessions/:id/reset-remote with the local X-AgentDock-Token header and JSON body {"expectedRemoteId":"<id>"}.
A stale ID or a busy session yields HTTP 409. No vendor logout or deletion occurs.

Patch export is read-only, bounded and manually reviewed; never auto-applies code. Authentic vendor CLI and desktop-app session continuity remain unverified.
