# Decision — #14 + #16 Landed (Command Queue Lifecycle & whoOwns Ownership Tests)

- **Author:** Switch (Tester / Reviewer)
- **Requested by:** Eric De Carufel
- **Date:** 2026-09-01
- **Issues:** #14 (command queue lifecycle tests), #16 (whoOwns glob/ownership tests)
- **Depends on:** #10 (test harness, merged — see `switch-test-harness.md`)
- **PR:** https://github.com/decarufe/vscode-squad/pull/26 (branch `switch/queue-ownership-tests-14-16`)

## What changed

### #14 — `src/test/suite/commandQueue.test.ts`
Exercises `commandQueueManager` (`src/monitoring/commandQueue.ts`) directly against the real
`vscode`/`eventBus` singletons provided by the extension-host test harness:
- `enqueue` — default `status: 'queued'`, `args: []` when omitted, emits `command-queued`.
- `markRunning` — `queued -> running`, sets `startedAt`, unknown-id is a no-op.
- `markCompleted` — `running -> completed`, sets `result`/`completedAt`, emits `command-completed`
  with `result: 'success'`; idempotent once terminal (second call doesn't re-emit or overwrite).
- `markFailed` — `running -> failed`, sets `error`/`completedAt`, emits `command-completed` with
  `result: 'failure'`; does not override an already-`completed` item.
- `getPending` — returns only `queued`/`running` items.
- `clearCompleted` — removes only `completed` items; `queued`/`running`/`failed` remain (this is
  the **existing behavior**, not changed — documented via test rather than "fixed", since #14's
  scope is testing, not redesigning queue semantics; flagging it below as a possible follow-up).
- `getQueue` — returns a defensive copy (mutating the returned array doesn't affect internal state).

**Test isolation:** `commandQueueManager` is a module-level singleton with no full-reset API.
Each test uses a uniquely generated agent name (timestamp + random suffix) and scopes assertions
via `getQueueForAgent`, cleaning up any item it leaves behind with `markFailed` so state never
leaks across tests despite the shared singleton.

### #16 — `src/test/suite/whoOwns.test.ts` + minimal `src/commands/whoOwns.ts` refactor
Covers, as separate suites:
- `matchGlobSimple` — exact match, single `*` (segment-scoped, no `/` crossing), `**`
  (cross-segment), `?` (single char), backslash-path normalization, regex-special-char escaping.
- `parseOwnedFilesSection` — `## Owned Files` bullet parsing (`-` and `*` bullets), blank-line and
  parenthetical-note filtering, missing-section handling, stopping at the next `##` heading.
- `resolveAgentNameFromEntry` — slugified charter-directory name → roster display name (including
  names with spaces/punctuation), fallback to the raw entry name when unmatched.
- `findOwnersForFile` — end-to-end resolution against real `charter.md` fixtures written to a
  temp directory (`fs.mkdtempSync` + `teardown()` cleanup): single owner, multiple owners, no
  match, missing `agents` dir, missing `charter.md`, missing `## Owned Files` section.

**Production change (minimal, behavior-preserving):** `handleWhoOwns` previously inlined all glob
matching / charter parsing / agent-name resolution logic directly inside the command handler,
which also drives interactive VS Code UI (`showInputBox`, `showInformationMessage`) that cannot be
driven headlessly in the Mocha/`@vscode/test-electron` harness. Extracted the pure logic into four
exported functions in `src/commands/whoOwns.ts` (`matchGlobSimple`, `parseOwnedFilesSection`,
`resolveAgentNameFromEntry`, `findOwnersForFile`); `handleWhoOwns` now calls them with the same
control flow as before. **No behavioral change** — same regex, same charter format, same fallback
rules — verified by compile + full test pass.

## Gap found (not fixed, flagged for follow-up)

`clearCompleted()` only clears items with `status === 'completed'`; `failed` items accumulate in
the singleton's queue array forever with no equivalent "clear failed" or "clear all terminal"
method. Not fixed here since it's a behavior/design question for the queue owner, not a test-harness
bug, and #14's scope is "test the existing transitions," not "redesign queue cleanup." Recommend a
follow-up issue (e.g. "clearCompleted should also clear failed items, or add a separate
clearFailed()") if this is unintended.

## Verification

- `npm run compile` — clean, no new TS errors, `strict` mode intact.
- `npm test` — **31 passing**, 0 failing (11 command-queue tests + 20 whoOwns tests).
- Diff scoped to: `src/commands/whoOwns.ts` (pure-function extraction only, no behavior change),
  `src/test/suite/commandQueue.test.ts` (new), `src/test/suite/whoOwns.test.ts` (new). No
  production dependency added; no unrelated files touched.

## Reviewer gate status (Switch, self-check per `switch-backlog-grooming.md`)

1. Compile clean — ✅
2. Lint — ⚠️ still not applicable repo-wide (no working eslint config; see `switch-test-harness.md`
   gap, unchanged by this PR).
3. Zero new runtime dependencies — ✅ (test-only changes, no `dependencies` touched)
4. Scoped to issues #14/#16, no drive-by edits — ✅ (whoOwns.ts touched only to make its existing
   logic testable, not to change behavior)
5. Acceptance criteria demonstrated — ✅ (`npm test` → 31 passing covering both issues' scopes)

**#14 and #16 are closed via PR #26.**
