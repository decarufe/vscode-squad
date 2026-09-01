# Tank History

## Learnings
- Extension must bootstrap Squad team quickly in each repository.
- UI should expose hire/fire/manage actions with minimal friction.
- Integrate with workspace folders and repository context consistently.

## 2026-09-01 — Issue #4: external team.md watcher fix
- Root cause: `registerSquad` built the watcher glob from
  `new vscode.RelativePattern(vscode.Uri.file(teamFilePath), '')` — an empty
  pattern string never matches, so `onDidChange`/`onDidCreate` never fired for
  hand-edited `team.md`. Fix: `new vscode.RelativePattern(squadDir, 'team.md')`,
  matching exactly the file, watched relative to the squad directory.
- Neo's PR #21 (merged, #3/#5) had already built everything the fix needed:
  `reloadSquad`/`applyStateToContext` (reparse + rebuild `ctx.agents` + emit
  `team-changed`) and `team/watcher.ts`'s `consumeInternalChange` suppression
  for self-authored writes. Issue #4 was reduced to the one invalid
  `RelativePattern` call — no parser or executor changes needed.
- Validated with a throwaway Node harness (stubbed `vscode` module, same
  pattern Neo used for #3/#5): confirmed the constructed pattern is
  `(squadDir, 'team.md')`, and that firing the registered `onDidChange`
  callback after an external edit reparses the file, rebuilds `ctx.agents`,
  and emits `team-changed`. Harness deleted after the run; `tsc -p ./` is the
  durable validation (repo has no working `eslint` config yet — pre-existing,
  tracked separately).
- Kept the change to a single file/hunk in `src/core/squadRegistry.ts` and a
  separate branch/PR from #23 (executor reliability) per Eric's request.
- Issue #8: `workbench.action.chat.open` only pre-fills the chat input box —
  it does not send/await a request, so anything depending on the model's
  reply coming back as a new `@squad`-addressed chat message (the old
  `/progress`/`/complete` convention) will effectively never resolve. Use
  `vscode.lm.selectChatModels()` + `LanguageModelChat.sendRequest()` instead
  when the extension needs a deterministic, awaitable completion signal from
  Copilot — the stream ending *is* the signal, no chat round-trip needed.
- `vscode.lm.selectChatModels({ vendor: 'copilot' })` returning `[]` is the
  correct, direct way to detect "Copilot Chat unavailable" (not installed /
  signed out / disabled) without checking extension IDs manually.
- Any code path that flips a queue/task item to "running" should pair with a
  watchdog/timeout that force-resolves it — never leave a terminal-state
  transition solely dependent on an external callback that might not fire.
- `pnpm run lint` is currently broken repo-wide: `eslint` is not listed in
  `devDependencies` at all, so `eslint src --ext ts` fails with "not
  recognized" regardless of code changes. Pre-existing, not introduced by any
  single task — flagged for Switch's CI/test-harness workstream (#10/#19).

## 2026-09-01 — Dashboard "Send does nothing" bug (PR #33)
- Reproduced end-to-end: two independent bugs stacked to fully silence the
  Send button.
  1. `media/dashboard/dashboard.js`: the agent-list cards and the command
     bar's `#cmd-agent-selector` `<select>` were unsynchronized "selected
     agent" sources. `selectAgent()` (card click) never wrote to the
     `<select>`, so `updateSendState()` (gated on `cmdAgentSelector.value`)
     kept the Send button `disabled` whenever a user picked an agent via the
     more natural card UI instead of the dropdown. A disabled button
     swallows clicks with zero signal — no postMessage, no error, no queue
     entry: exactly the reported symptom.
  2. `src/webview/dashboardPanel.ts`: even with (1) fixed, the host's
     `enqueue-command` handler only called `commandQueueManager.enqueue(...)`
     — it never dispatched to `copilotExecutor` (unlike the equivalent
     command-palette flow in `enqueueCommand.ts`), so a sent command sat at
     `"queued"` forever with no log output, and no `command-queued` /
     `command-completed` listeners existed to push live queue updates to the
     webview at all.
- Fix: added `syncCommandBarAgentSelection()` in `dashboard.js` (called from
  both the card-click and dropdown-`change` paths) plus wired
  `copilotExecutor.executeTask(...)` dispatch + `command-queued` /
  `command-completed` event listeners in `dashboardPanel.ts`. Failures from
  the dispatch call itself (as opposed to normal task failures, which
  `copilotExecutor` already surfaces) are now logged via `logError` and
  shown with `vscode.window.showErrorMessage` so a broken send path is never
  silent again.
- Added `src/test/suite/dashboardPanel.test.ts`: registers this repo's own
  `.squad/team.md` fixture, invokes `DashboardPanel`'s private
  `handleWebviewMessage` (cast to `any` — there is no public API for
  in-process webview message injection, and adding one solely for tests
  would widen the class's contract) with an `enqueue-command` message, and
  asserts the queue item progresses past `"queued"` — proving dispatch
  happens instead of stalling forever. Full suite: 74 passing.
- Observed this working directory is actively shared by other concurrent
  agent sessions (branch checkouts and file edits interleaved mid-task on
  `C:\git-decarufe\vscode-squad`). Did all edit/compile/test/commit work in
  an isolated `git worktree` (this session's own workspace) instead, to
  avoid racing another agent's checkout/reset and losing work.
