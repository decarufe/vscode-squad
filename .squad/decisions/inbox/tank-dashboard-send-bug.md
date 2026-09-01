# Decision: Dashboard Send button does nothing — end-to-end fix (PR #33)

**Date:** 2026-09-01
**Author:** Tank
**Status:** Fixed

## Problem
Squad Dashboard: user selects an agent, types a command, clicks **Send** —
nothing happens. Command queue stays empty, terminal/log panel shows no
entries, no visible errors. Reported against a squad under
`.squad/squads/master-of-the-niverse` with "Backend" (Morpheus's role)
selected.

## Root cause — two independent bugs stacked
1. **`media/dashboard/dashboard.js`** — the agent list cards and the command
   bar's `#cmd-agent-selector` `<select>` were two unsynchronized "which
   agent is selected" sources. `selectAgent(name)` (the card click handler)
   only updated `state.selectedAgent` for log filtering and posted
   `agent-selected` for tracking — it never wrote to the `<select>` element
   that gates the Send button. `updateSendState()` disabled Send whenever
   `cmdAgentSelector.value` was empty, so picking an agent via the card (the
   more prominent, natural motion) left Send `disabled` regardless of typed
   text. A disabled button swallows clicks with zero signal: no
   `postMessage`, no queue entry, no log — exactly the report.
2. **`src/webview/dashboardPanel.ts`** — even once (1) is fixed and
   `enqueue-command` reaches the host, the handler only called
   `commandQueueManager.enqueue(message.agent, message.command)`. Unlike the
   equivalent command-palette flow (`src/commands/enqueueCommand.ts`), it
   never dispatched the item to `copilotExecutor.executeTask(...)`. Result:
   the item sits at `"queued"` forever, no log entries are ever produced
   (only `copilotExecutor` writes to `logStore`), and — separately — the
   panel had no `command-queued` / `command-completed` event listeners, so
   even a successfully enqueued item wouldn't live-update the webview's
   Command Queue panel without a full `state-update` refresh.

## Fix
- `dashboard.js`: added `syncCommandBarAgentSelection()` — mirrors
  `state.selectedAgent` onto `#cmd-agent-selector.value` and refreshes the
  Send button's enabled state. Called from both `selectAgent()` (card path)
  and `renderAll()` (state-update path). The dropdown's own `change` handler
  now also writes back into `state.selectedAgent` and re-renders the agent
  list, so card highlighting and the dropdown never drift apart regardless
  of which control the user uses.
- `dashboardPanel.ts`: `enqueue-command` now calls
  `copilotExecutor.executeTask(message.agent, message.command, item.id)`
  after enqueueing. `copilotExecutor` already surfaces normal failures
  (Copilot unavailable, no active squad, unknown agent) via
  `vscode.window.showErrorMessage` and marks the queue item failed — the
  `.catch` added here only guards against the dispatch call itself
  rejecting unexpectedly, logging via `logError` and also showing an error
  message so a broken send path is never silent. Added `command-queued` /
  `command-completed` event listeners so the Command Queue panel updates
  live as items are queued, run, and resolve.

## Validation
- `npm run compile` (tsc) — clean.
- `npm test` (full existing suite via `@vscode/test-electron`) — 74 passing,
  including a new regression test `src/test/suite/dashboardPanel.test.ts`
  that registers this repo's own `.squad/team.md`, drives
  `DashboardPanel.handleWebviewMessage` with a synthetic `enqueue-command`
  message, and asserts the resulting queue item progresses past `"queued"`
  (proving dispatch happens) instead of stalling forever.
- `node --check media/dashboard/dashboard.js` — syntax OK.
- `npm run lint` is broken repo-wide (no `eslint` devDependency) —
  pre-existing gap, not introduced or fixed here; already tracked in Tank's
  history and flagged for Switch's CI workstream (#10/#19).

## Process note
This working directory (`C:\git-decarufe\vscode-squad`) was actively shared
by other concurrent agent sessions during this task — branch checkouts and
file edits landed mid-task, and the intended fix appeared, disappeared, and
reappeared in that shared tree several times. To avoid racing another
agent's checkout/reset and losing work, all edit/compile/test/commit work
for this fix was done in an isolated `git worktree`
(`fix/dashboard-send-selection`, this session's own workspace) instead of
the shared root. PR #33 opened from that branch.

## Scope
Changed: `media/dashboard/dashboard.js`, `src/webview/dashboardPanel.ts`,
`src/test/suite/dashboardPanel.test.ts`. No changes to `commandQueue.ts`,
`copilotExecutor.ts`, `types.ts`, `dashboard.html`, `dashboard.css`, or
unrelated in-flight work (`src/core/squadRegistry.ts`'s emoji-derivation fix
was left untouched — separate, unrelated change already in progress).
