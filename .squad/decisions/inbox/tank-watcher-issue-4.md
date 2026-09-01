# Decision — External `team.md` Watcher Fix (#4)

**Author:** Tank (VS Code Extension Dev)
**Requested by:** Eric De Carufel
**Date:** 2026-09-01
**Issue:** decarufe/vscode-squad#4 (P0, squad:tank)
**Status:** Implemented — awaiting review (Switch gate)

---

## 1. Context

`squadRegistry.ts#registerSquad` created the roster's file watcher as:

```ts
const teamFileUri = vscode.Uri.file(teamFilePath);
const fileWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(teamFileUri, ''),
);
```

`RelativePattern`'s second argument is a **glob pattern relative to the base**, not an
already-fully-qualified file path — an empty string glob never matches anything. As a result,
`onDidChange`/`onDidCreate` never fired, so hand-editing `team.md` on disk (the extension's core
"file-first" promise) silently failed to refresh the sidebar roster. It only appeared to work via
`squadRegistry.applyTeamState`, which commands call after writing through the extension itself.

Neo's PR #21 (#3/#5, merged) had already built every downstream piece this fix needed:
`reloadSquad(squadDir)` / `applyStateToContext` reparse `team.md`, rebuild `ctx.agents`, refresh
`ctx.statistics.totalAgents`, and emit `team-changed`; and `team/watcher.ts` exports
`consumeInternalChange`/`markInternalChange` so the extension's own writes (via
`writeTeamState`) don't cause a redundant reload. Neo explicitly flagged the invalid
`RelativePattern` as out of scope for #21 and left it for #4.

## 2. Decision

Construct the watcher pattern directly against the squad directory and the literal filename:

```ts
const fileWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(squadDir, 'team.md'),
);
```

This is the exact form the issue prescribes (`RelativePattern(dir, 'team.md')`). No other logic
changed: `onDidChange`/`onDidCreate` still route through the existing
`consumeInternalChange` → `reloadSquad` pipeline, which already reparses, rebuilds the agent map,
and emits `team-changed` — that pipeline just never used to run for external edits.

*Rejected:* globbing on `vscode.Uri.file(teamFilePath)` with pattern `'**'` or similar broad glob.
Matching the directory base with the exact filename is the tightest, most explicit pattern and
avoids watching unrelated files that might later live alongside `team.md`.

*Rejected:* adding an `onDidDelete` handler or touching `team/watcher.ts` /
`team/parser.ts` / executor code. Out of scope for #4 — the issue is specifically the invalid
glob, and parser (#1/#2) and executor (#8, PR #23) are owned by other in-flight work.

## 3. Validation

`npx tsc -p ./` (strict) clean — only file touched is `src/core/squadRegistry.ts` (1 hunk, net
+4/-2 lines). `npm run lint` cannot run in this repo (ESLint config gap, pre-existing — see Neo's
`neo-layout-state-p0.md` decision record and Switch's CI issue #19).

Behavior verified with a throwaway Node harness (stubbed `vscode` module, deleted after the run,
same approach Neo used for #3/#5): loaded the compiled `out/core/squadRegistry.js` against a
scratch flat-layout squad and asserted:
1. `RelativePattern` is constructed as `(squadDir, 'team.md')` — not the old empty-glob form.
2. Exactly one `onDidChange`/`onDidCreate` listener is registered per squad.
3. Simulating an external edit (rewriting `team.md` on disk, then invoking the captured
   `onDidChange` callback with no prior `markInternalChange`) reparses the file, grows
   `ctx.agents` from 1 to 2 members, and emits `team-changed`.

All checks passed.

## 4. Scope / follow-ups

- Kept to a single file, separate branch (`tank/4-team-watcher`) and PR from #23
  (executor reliability, issue #8), per Eric's request.
- No changes to `team/parser.ts` (#1/#2) or executor code (#8).
- Acceptance criterion from the issue — "editing `team.md` on disk updates the sidebar roster" —
  is now satisfied end-to-end via `onTeamFileChange` → `reloadSquad` → `applyStateToContext` →
  `team-changed` → `rosterProvider.refresh()` (wired in `extension.ts`).
