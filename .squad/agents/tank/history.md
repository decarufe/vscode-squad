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

## 2026-09-01 — Issue #9 (reopened): roster emoji regression from PR #24
- Root cause: `deriveMemberEmoji()` (added by Trinity in PR #24) treats the
  leading whitespace-delimited token of `member.status` as the identity emoji
  whenever it matches `/\p{Emoji}/u`. But `src/team/serializer.ts` defaults
  every ordinary member's status to `'✅ Active'`, and `✅` itself is a valid
  emoji code point — so the "generic active" placeholder was mistaken for an
  identity marker and every plain member (Neo/Trinity/Morpheus/Switch/Tank)
  rendered `✅` instead of the intended `👤`. Scribe/Ralph were unaffected
  because their real statuses (`📋 Silent`, `🔄 Monitor`) never collide.
- Fix: added a narrow denylist check (`statusEmoji !== '✅'`) to the existing
  fast path in `squadRegistry.ts` rather than restructuring the derivation
  logic — keeps the blast radius to one line plus a comment explaining why.
- Lesson: when a fallback/derivation function trusts a "leading emoji" signal
  from free text, always check what the *default* value of that text is
  before assuming any emoji present is meaningful. A generic placeholder
  glyph (checkmark, bullet, etc.) can silently outrank the intended fallback
  chain.
- Reviewer rejection lockout: Trinity (original PR #24 author) was locked out
  of producing this revision per reviewer state; Tank picked it up instead.
  Confirmed via a throwaway `git worktree` (not the shared working directory)
  that reverting just the export/fix reproduces the 4 failing acceptance
  cases — useful pattern for validating a regression fix is real, not a
  stale-build artifact, especially in a shared multi-agent working tree.
- Shared working directory caution: mid-task, the shared repo's checked-out
  branch changed under me (another agent's concurrent `git checkout`). Used
  `git worktree add ../vscode-squad-tank-9 origin/main -b <branch>` to build,
  test, commit, and push in complete isolation without touching or reverting
  any other agent's uncommitted changes in the primary working directory.
- PR #29 opened against `decarufe/vscode-squad` (not the `upstream` remote,
  which points at `amih90/vscode-squad` — `gh pr create` defaults to
  `upstream` if both remotes exist and repo isn't specified explicitly; use
  `--repo decarufe/vscode-squad` in this repo's `gh` invocations).
