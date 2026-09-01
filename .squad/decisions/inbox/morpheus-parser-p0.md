# Parser P0 Fixes — Multi-Section Roster + Owner/Lead Context Keys

- **Author:** Morpheus (Backend / Integration Dev)
- **Requested by:** Eric De Carufel
- **Date:** 2026-09-01
- **Scope:** `src/team/parser.ts` only (issues #1, #2)

## Decision

Implemented both P0 parser bugs from Switch's grooming matrix as a single surgical change to
`src/team/parser.ts`, on branch `morpheus/parser-roster-context-fix` → **PR #20**
(`https://github.com/decarufe/vscode-squad/pull/20`), targeting `main`.

### #1 — Multi-section roster
`parseTeamFile` now extracts `## Coordinator`, `## Members`, and `## Coding Agent` as independent
sections (via `extractSection`, unchanged). A new header-aware column map (`parseHeaderColumns` +
generalized `parseMembersTable(tableSection, forcedSection)`) reads each table's own header row
instead of assuming a fixed `Name | Role | Charter | Status | Notes` order — required because the
`## Coordinator` table in this repo's `team.md` is `Name | Role | Notes` (no Charter/Status
columns). Rows in a dedicated section are assigned that section directly; when no
`## Coordinator`/`## Coding Agent` heading exists at all, the single `## Members` table is parsed
with `forcedSection = null` and each row falls back to the original `classifyMember` role/name
heuristic — preserving legacy single-table `team.md` files.

**Verified:** parsing this repo's `.squad/team.md` yields exactly 1 coordinator (Squad) + 7
members (Neo, Trinity, Morpheus, Switch, Tank, Scribe, Ralph) + 1 coding agent (@copilot), matching
the issue's acceptance criteria. A hand-built legacy fixture (single `## Members` table with mixed
Coordinator/Architect/Coding Agent rows) still classifies correctly.

### #2 — Owner/Lead context keys
`parseProjectContext` now maps `Owner` and `Lead` keys to `projectContext.user`, alongside the
existing `user` alias (`building`/`description` and `tech stack`/`stack` aliases untouched).

**Verified:** this repo's `team.md` (`- **Owner:** Ami Hollander`) now resolves
`projectContext.user = "Ami Hollander"`, alongside `description` and `techStack`.

## Validation

- `pnpm run compile` — passes, no new TS errors.
- `pnpm run lint` — **could not run**: `eslint` is not in `devDependencies` and is not installed in
  this working tree (pre-existing gap, unrelated to this change). Did not add it — out of scope
  and would violate the zero-new-runtime-dependency rule if done carelessly; flagging for Switch/
  Neo since #19 (CI compile+lint+test) will need this resolved.
- Manual runtime verification via the compiled parser (`node -e ...` against `out/team/parser.js`)
  as described above; no automated test harness exists yet (#10 is a separate, unowned-by-me
  prerequisite for #11).

## Scope discipline

Only `src/team/parser.ts` was staged/committed. The working tree at the time of this change had
substantial unrelated in-progress edits from other workstreams (state architecture #5 in
`teamState.ts`/`squadRegistry.ts`, watcher #4 in `watcher.ts`, layout files, command handlers,
config/docs). None of these were touched, staged, or committed as part of this PR — they remain
exactly as the working tree had them for their respective owners to commit.

## Handoff

PR #20 is open against `main` and ready for Switch's acceptance-criteria review (parser/serializer
gate: round-trip proven on the real `.squad/team.md`, exact headings preserved — confirmed, no
serializer changes were needed or made).
