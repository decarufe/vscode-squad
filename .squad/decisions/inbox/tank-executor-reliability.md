# Tank — Executor Reliability (Issue #8)

**Author:** Tank (VS Code Extension Dev)
**Requested by:** Eric De Carufel
**Date:** 2026-09-01

## Problem

`CopilotExecutor.sendToCopilot` only called `workbench.action.chat.open`, which
pre-fills the Copilot Chat input box — it does not send/await anything. The
prompts then instructed the model to reply with `@squad /progress` /
`@squad /complete` chat messages, and `commandQueueManager` only ever left
`queued`/`running` items in a terminal state (`completed`/`failed`) if that
convention actually happened to fire. Since nothing sends the model's own
markdown reply back into chat as a new `@squad`-addressed message, this almost
never happened — queue items were effectively stuck `running` forever. There
was also no check for Copilot Chat being unavailable (not installed / signed
out): `workbench.action.chat.open` would open an empty/default chat panel with
no visible error, and the queue item would still hang.

## Decision

Replace the "open chat UI and hope the model calls back" flow with a direct,
in-process round trip against the `vscode.lm` Language Model API
(`vscode.lm.selectChatModels` + `LanguageModelChat.sendRequest`), awaited by
the extension itself:

1. **`CopilotExecutor.sendToCopilot`** now selects a Copilot chat model,
   sends the prompt via `sendRequest`, and awaits the full `response.text`
   stream. Resolution is driven by the stream ending — a real completion
   signal — not by parsing chat messages for a magic command.
2. **Availability check is explicit and immediate**: if
   `vscode.lm.selectChatModels({ vendor: 'copilot' })` returns no models (not
   installed / signed out / disabled), a `CopilotUnavailableError` is thrown
   immediately, the queue item(s) are marked `failed` right away, and
   `vscode.window.showErrorMessage` surfaces a clear message to the user.
   Any `vscode.LanguageModelError` (no permission, blocked, not found) is
   mapped to the same clear failure path.
3. **Bounded wait, not unbounded**: a `CancellationTokenSource` cancels the
   request after `squad.execution.timeoutSeconds` (default 120s, new
   setting), so a hung/slow model call can't block a queue item forever.
4. **`commandQueueManager` watchdog (defense in depth)**: `markRunning` now
   arms a timer using the same setting; if nothing calls
   `markCompleted`/`markFailed` for that id before it fires, the watchdog
   force-fails the item with a clear "timed out" reason. This protects the
   queue's own guarantee independent of any particular executor code path,
   and both terminal-state methods are now idempotent (no-op once an item is
   `completed`/`failed`) to avoid a race between the watchdog and a real
   result landing at nearly the same time.
5. `parseOutcome` still recognizes an optional `RESULT: SUCCESS|FAILURE`
   line in the model's reply to refine completed-vs-failed, but this is
   best-effort only — the item is resolved either way as soon as the model
   finishes responding.

The `@squad /complete` and `@squad /progress` chat commands in
`squadChatParticipant.ts` are left in place unmodified as an optional manual
reporting path (a user can still type them), but nothing depends on them
anymore for a queued execution to resolve.

## Why not X

- **Keep depending on chat replies, just add a timeout in the chat
  participant:** doesn't fix the root cause (the model's own text response
  was never actually delivered back as a new `@squad`-addressed chat
  message), and duplicates timeout logic in two places.
- **Only add a queue-level watchdog, keep `workbench.action.chat.open`:**
  would silently "succeed" (timeout failure) for every single execution in
  practice, since the open-chat call never reliably signals completion at
  all — it doesn't address the actual reliability gap, only bounds it.

## Files changed

- `src/monitoring/copilotExecutor.ts` — rewritten to use `vscode.lm` directly;
  added `CopilotUnavailableError`; removed the `/progress`/`/complete`
  protocol text from prompts.
- `src/monitoring/commandQueue.ts` — added the watchdog timer, idempotent
  `markCompleted`/`markFailed`, and a `dispose()` to clear timers.
- `src/extension.ts` — call `commandQueueManager.dispose()` on deactivation.
- `package.json` — new `squad.execution.timeoutSeconds` setting.

## Validation

- `pnpm run compile` — passes.
- `pnpm run lint` — fails with `'eslint' is not recognized...`; confirmed via
  `git stash` that this is pre-existing (eslint isn't in `devDependencies` at
  all yet) and unrelated to this change.
- No test harness exists yet (`out/test/runTest.js` is not present; tracked
  separately under WS5 / issue #10), so no automated test coverage could be
  added for this change in this pass.

## Risks / follow-ups

- `vscode.lm.sendRequest` shows a one-time user consent dialog per extension;
  the very first queued execution in a session may pause on that prompt.
  This is expected VS Code API behavior, not a regression.
- Headless model access means the user no longer sees the live Copilot Chat
  panel driving the task; progress is now visible via the "Squad" output
  channel / Activity view log entries and a completion/failure notification
  instead. If a chat-UI-visible experience is wanted later, it would need a
  chat participant/session-based flow that still awaits `stream` completion
  in-process (not `workbench.action.chat.open`).
- `squad.execution.timeoutSeconds` default (120s) is a guess; may need
  tuning once real task durations are observed.
