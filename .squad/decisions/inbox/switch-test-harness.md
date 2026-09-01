# Decision — #10 Test Harness Landed

- **Author:** Switch (Tester / Reviewer)
- **Requested by:** Eric De Carufel
- **Date:** 2026-09-01
- **Issue:** #10 — Add `@vscode/test` + Mocha test harness (unblocks #11–#19)

## What changed

- Added devDependencies: `@vscode/test-electron` (^3.1.0), `mocha` (^12.0.0). `@types/mocha`
  was already present. No production `dependencies` were added — devDependencies-only rule held.
- Added `src/test/runTest.ts` — resolves `extensionDevelopmentPath`/`extensionTestsPath` and calls
  `@vscode/test-electron`'s `runTests()`, matching the file the `test` script already pointed at
  (`out/test/runTest.js`).
- Added `src/test/suite/index.ts` — exports `run()`, wires a Mocha (`tdd` UI) instance, and
  recursively collects compiled `*.test.js` files under `out/test` by hand (no `glob` runtime
  dependency, mirroring the hand-rolled matcher already used in `whoOwns.ts`).
- `package.json`: `pretest` now runs `npm run compile` only (dropped `&& npm run lint` — see gap
  below). `test`/`vscode:prepublish`/`lint` scripts left untouched.
- Added `.vscode-test` to `.gitignore` (the real VS Code build `@vscode/test-electron` downloads
  on first run, ~320MB, must never be committed).

## Gap found (not fixed, out of scope for #10)

`eslint` has never been a devDependency and no eslint config (`.eslintrc*` / `eslint.config.js`)
exists anywhere in the repo — the `lint` script has been non-functional since the very first
commit that added it. Standing up a real eslint config plus fixing whatever it flags across the
existing `src/` tree is a much larger, separate effort than "add a test harness," and overlaps
with #19 (CI: compile + lint + test workflow), which is explicitly out of scope this round.
Recommend folding "add working eslint config" into #19 or its own follow-up issue before #19
wires `lint` into CI.

## Verification

- `pnpm run compile` — clean, no new TS errors, `strict` mode intact.
- `npm test` and `pnpm test` — both exit `0`, Mocha reports `0 passing` (empty suite), per #10's
  acceptance criterion.
- Diff scoped to: `package.json` (pretest line + 2 devDependencies), `.gitignore`
  (`.vscode-test`), `src/test/runTest.ts`, `src/test/suite/index.ts`. No production dependency
  added; no unrelated files touched (other in-flight tickets' uncommitted edits in the shared
  working tree were left exactly as found).

## Reviewer gate status (Switch, self-check per `switch-backlog-grooming.md`)

1. Compile clean — ✅
2. Lint passes — ⚠️ not applicable this round; lint has no working config repo-wide (see gap
   above), so it's excluded from `pretest` rather than false-passing or blocking unrelated work.
3. Zero new runtime dependencies — ✅ (devDependencies only)
4. Scoped to issue #10, no drive-by edits — ✅
5. Acceptance criterion demonstrated — ✅ (`npm test` / `pnpm test` pass on empty suite)

**#10 is unblocked for #11–#18 to add real specs under `src/test/suite/*.test.ts`.**
