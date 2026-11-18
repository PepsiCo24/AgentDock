# AgentDock V0.11: Apple HIG-inspired UI review

Reference guidance (not Apple software):
- Community skill: https://github.com/629611312/apple-ui-design — `SKILL.md`, `profiles/web.md`, `profiles/admin.md`, and `references/{foundations,layout,typography,color,components,materials,motion}.md`.
- Official Apple HIG: https://developer.apple.com/design/human-interface-guidelines/designing-for-macos
- Official sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- Official layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Official toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars

**The skill is made by an independent community maintainer, not Apple.** We use its design rules, not its brand or any Apple proprietary assets.

## Primary use case and hierarchy

AgentDock's primary task is sending a coding task to the currently selected AI agent, watching its progress, and reviewing results. Project/session navigation and optional file inspection are supporting contexts. The workbench remains a desktop-oriented split view: Agent rail → scoped project/session list → conversation and composer → optional inspector. On compact screens, only one drawer is open at once.

## UI audit decisions

| Concern | Previously | Now |
|---|---|---|
| Hierarchy | Multiple competing color treatments and card shadows | Neutral navigation, opaque content, one primary Send action |
| Appearance | Dark only; low-contrast metadata | Semantic light/dark tokens, OS-following selection, accessible focus and state colors |
| Sessions | List required manual scan | Scoped search with visible result count and `⌘/Ctrl+K` shortcut |
| Density | Hard-coded 9–11px labels and multiple rounded wrappers | Regular 12–14px operational labels/body, 4/8-point rhythm, fewer heavy cards |
| Material | Decorative gradients and shadows in many persistent panels | Solid surfaces; limited elevation on composer and transient dialogs |
| Feedback | Selected state largely by color | Text/position and current markers plus distinct focus, hover, disabled and status styles |
| Accessibility | Focus only on some controls | Keyboard shortcut, native search, ARIA current/pressed, reduced motion, forced-color fallbacks |
| Assets | Brand marks from prior release | Keep provider-identifying assets only; do not add SF Symbols or Apple branding |

## Acceptance and limitations

- Verify locally with `npm run check`, `npm test` and HTTP assets.
- Validate manually on the owner's computer at widths ~1440, 1024, 660, and 390 CSS px, in light/dark/system mode. Ensure no toolbar clipping, lost approvals or inaccessible drawers.
- Test 200% text zoom, long session names, Chinese and English labels, keyboard-only navigation, focused search, screen-reader status, reduced motion and forced colors.
- Theme preference lives in the browser's localStorage and synchronizes via `storage` events; this does not change the user's AgentDock project database or CLI authentication.
- Headless Chromium in the isolated test container timed out with system DBus/zygote errors. Screenshot and owner-device input were **not** verified.
- Authenticated Codex / Claude Code / Antigravity end-to-end runs and native macOS windows are outside this design-only change.
