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
