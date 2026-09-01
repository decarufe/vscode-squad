# Decision — Layout Interop (#3) & Single Source of Truth for Team State (#5)

**Author:** Neo (Lead / Architect)
**Requested by:** Eric De Carufel
**Date:** 2026-09-01
**Issues:** decarufe/vscode-squad#3 (P0, layout), decarufe/vscode-squad#5 (P0, state)
**Status:** Implemented — awaiting review (Switch gate)

---

## 1. Context

Two P0 defects sat under the same architectural root: *what is a squad, and where does its
state live?*

- **#3** — `scanWorkspaceFolders` treated `.squad/team.md` as a fallback: it was registered
  **only if `.squad/squads/` did not exist**. A repo that has both (this one, and any repo where
  the `squad` coordinator/CLI created the flat layout and someone then ran
  `Squad: Create New Squad`) silently lost the flat squad.
- **#5** — Two unsynchronized state holders existed: `SquadContext` in `core/squadRegistry.ts`
  and the `currentTeamState` module singleton in `team/teamState.ts`. Member commands wrote via
  `updateTeamState` (disk + singleton) and emitted `team-changed`, but the registry context was
  never updated and the event handler ignored its payload — the tree re-rendered *from stale
  context*, so add/edit/remove appeared only after reload. `team/watcher.ts` (`setupWatcher` with
  `fs.watch`) was dead code, and its `markInternalChange()` guard protected nothing.

## 2. Decisions

### D1 — Both layouts are first-class; nested is canonical for *new* squads

| Layout | Path | Role |
|--------|------|------|
| Nested | `.squad/squads/<name>/team.md` | **Canonical** for squads created by the extension; supports N squads per workspace folder |
| Flat | `.squad/team.md` | **First-class**, not "legacy": the interop layout produced by the `squad` coordinator/CLI |

Discovery registers *every* `.squad/squads/*/team.md` **and** `.squad/team.md`. Coexistence is
the expected state, not an edge case. `SquadContext.layout: 'flat' | 'nested'` records the shape
so behavior that genuinely differs can branch on it explicitly.

*Rejected:* auto-migrating flat → nested. Migration mutates a repo the CLI/coordinator also
writes, breaks external tooling that hardcodes `.squad/team.md`, and is unrecoverable from the
UI. Interop beats normalization.

*Rejected:* making flat canonical. It cannot express multiple squads, which is a shipped feature.

Consequences handled:
- A flat squad would display as `.squad`; it is named after the **workspace folder** instead.
- `rootPath` derivation is layout-aware (`..` for flat, `../../..` for nested) — the old fixed
  three-level `path.resolve` produced a wrong root for flat squads.
- `deleteSquad` on a flat squad previously would have `rm -rf`'d `.squad/`, taking every nested
  squad with it. It now deletes only the flat squad's own entries and preserves `squads/`.
- The Squads panel disambiguates same-named entries by appending the squad name when the label
  comes from `Project Context → Building`.

### D2 — `SquadContext` is the single source of truth; `teamState.ts` becomes stateless I/O

- Deleted `currentTeamState`, `getTeamState()`, `loadTeamState()`.
- `teamState.ts` now exports only types plus pure helpers: `readTeamState(squadDir)`,
  `writeTeamState(state)`, `teamFilePathFor(squadDir)`, `scaffoldAgentDir(...)`.
- New single mutation entry point: **`squadRegistry.applyTeamState(squadDir, state)`** — persists
  through the serializer, then updates `ctx.teamState`, rebuilds `ctx.agents`, refreshes
  `statistics.totalAgents`, and emits `team-changed`. `addMember` / `editMember` / `removeMember`
  now call it and no longer emit events themselves.
- `reloadSquad(squadDir)` is the external-edit path used by the registry file watcher.

*Rejected:* keeping both stores in sync via `team-changed` listeners. Two writable stores plus a
sync listener is the same bug with extra steps; the fix is to delete one store.

*Rejected:* having commands re-`registerSquad()` after a write. It disposes/recreates the
watcher, drops the log ring buffer, command queue, and statistics, and re-emits
`squad-activated` — losing runtime state on every roster edit.

### D3 — The dead watcher module is repurposed, not deleted

`team/watcher.ts` no longer owns an `fs.watch` loop (that duplicated the registry's
`FileSystemWatcher`). It now owns **path-keyed internal-change suppression**:
`markInternalChange(teamFilePath)` (called by `writeTeamState`) and `consumeInternalChange(path)`
(called by the registry watcher callback). Suppression is per-file, so a write to one squad no
longer suppresses a concurrent external edit to another — the old boolean+`setTimeout` flag was
global. The documented `markInternalChange` convention is therefore preserved and now actually
wired.

Boundary respected: the `RelativePattern` construction in `registerSquad` is **untouched** — that
is #4 (Tank).

## 3. Canonical layout, documented

`docs/multi-squad.md` gains a **Supported Layouts** section (table, coexistence diagram,
discovery + naming + deletion rules, and "which layout should I use"). `docs/squad-protocol.md`
now states that a squad directory is either `.squad/squads/<name>/` or `.squad/` with identical
contents. `README.md` and `.github/copilot-instructions.md` were updated to match, including the
"never write `team.md` from a command — call `applyTeamState`" rule.

## 4. Validation

`npx tsc -p ./` (TypeScript strict) clean. Behavior was verified with a throwaway Node harness
that loaded the compiled `out/` registry against a stubbed `vscode` module and a scratch workspace
containing **both** layouts — 19/19 checks passed (both layouts registered simultaneously,
layout-aware root/name derivation, idempotent rescan, add/edit/remove immediately reflected in
`ctx.teamState`/`ctx.agents`/statistics with `team-changed` emitted, flat mutation leaving the
nested squad untouched, internal writes suppressed in the watcher, external edits reloading). The
harness was deleted after the run; `pnpm run lint` cannot execute in this repo (ESLint 10 requires
a flat `eslint.config.*` and none exists — pre-existing gap, owned by Switch's CI issue #19).

## 5. Follow-ups (not in this change)

1. **#4 (Tank)** — the `new vscode.RelativePattern(teamFileUri, '')` watcher pattern is still
   invalid; `applyTeamState` keeps the UI correct meanwhile, and `consumeInternalChange` is
   already in place for when the watcher starts firing correctly.
2. **#13 (Switch)** — layout discovery is now deterministic and directly testable via
   `scanWorkspaceFolder(rootPath)`; the 19 checks above are the test spec.
3. **#17 (Switch)** — add/edit/remove tests should assert against `ctx.agents`, not disk.
4. Consider offering a layout choice in `Squad: Create New Squad` when a workspace already uses
   the flat layout (currently always nested).
