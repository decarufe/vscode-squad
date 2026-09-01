# Tank History

## Learnings
- Extension must bootstrap Squad team quickly in each repository.
- UI should expose hire/fire/manage actions with minimal friction.
- Integrate with workspace folders and repository context consistently.
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
