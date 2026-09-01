# Event Bus Integration Fixes — Agent-Status Roster Sync + StatsEngine Wiring

- **Author:** Morpheus (Backend / Integration Dev)
- **Requested by:** Eric De Carufel
- **Date:** 2026-09-01
- **Scope:** `src/core/squadRegistry.ts`, `src/commands/setAgentStatus.ts`, `src/extension.ts`,
  `src/monitoring/statsEngine.ts`, `src/test/suite/statsEngine.test.ts` (issues #6, #7)

## Decision

Implemented both integration fixes as a single cohesive change, branch
`morpheus/events-stats-sync` → **PR #28** (`https://github.com/decarufe/vscode-squad/pull/28`),
targeting `main`. They shared the same root cause class (an event is emitted on `eventBus` but no
listener does the follow-through work), so fixing them together kept the write-path for agent
runtime state single-sourced instead of introducing a second, competing mutation path.

### #6 — `agent-status` → active roster state
Before this change, only `setAgentStatus.ts` wrote `AgentRuntime.status`/`lastActivity` directly on
`ctx.agents`, and `extension.ts` never refreshed the roster `TreeView` on `agent-status` at all
(only on `team-changed`/`squad-activated`). Two problems: (1) `copilotExecutor.ts`,
`squadChatParticipant.ts`'s `/complete`, and `dashboardPanel.ts` all emit `agent-status` too, but
never mutated `ctx.agents` themselves, so their status changes were invisible to the roster; (2)
even `setAgentStatus.ts`'s own mutation never repainted the sidebar because nothing called
`rosterProvider.refresh()` on that event.

Fix: `squadRegistry`'s constructor now registers a single `agent-status` listener that updates
`status`/`lastActivity` on the matching `AgentRuntime` in *every* context that has that agent name
(events don't carry a `squadPath`, so we can't scope to one context). `setAgentStatus.ts` now only
broadcasts the event. `extension.ts` calls `rosterProvider.refresh()` on `agent-status`.

### #7 — statsEngine wired to real events
`statsEngine.recordTaskStart/recordTaskComplete/recordTaskFailure` existed but had **zero
callers** anywhere in the codebase, `stats-updated` was **never emitted** anywhere, and
`ctx.statistics` was only ever set once at `emptyStatistics()` (registration time) and on
`totalAgents` in `applyStateToContext` — `healthScore` stayed locked at its default `100` and
`totalTasks`/`completedTasks` stayed `0` forever, regardless of real task activity. Confirmed via
`grep` before making any change (see citations).

Fix: `statsEngine.ts` now listens to `command-queued` (→ `recordTaskStart`) and
`command-completed` (→ `recordTaskComplete`/`recordTaskFailure`, duration computed from the queue
item's real `startedAt ?? createdAt` → `completedAt ?? now`), then a shared
`refreshSquadStatistics(agentName)` helper pushes the refreshed `AgentStatistics` onto the
matching `AgentRuntime.statistics` and recomputes `ctx.statistics = statsEngine.getSquadStats(...)`
for every context that has the agent, emitting `stats-updated` each time. Also listens to
`agent-status` so `healthScore`'s utilization/freshness components stay live between task
completions, not just self-consistent immediately after one.

**Bug caught by the added test, fixed before commit:** the first version of
`refreshSquadStatistics` unconditionally set `runtime.lastActivity = latestAgentStats.lastActiveAt`
(the statsEngine-tracked, task-driven timestamp). Since the `agent-status` listener also calls
`refreshSquadStatistics`, this **regressed** a fresher status-driven `lastActivity` (just set by
squadRegistry's own listener) with a stale task timestamp whenever a status changed without a
matching task event in between. Fixed by taking `Math.max` of the two timestamps instead of
last-writer-wins.

## Validation

- `pnpm run compile` — clean, no new TS errors, no circular-import issues from `statsEngine.ts`
  now importing `squadRegistry.ts` (verified: `squadRegistry.ts` does not import `statsEngine.ts`
  or `commandQueue.ts`, so no cycle).
- `pnpm run test` — full suite, **47 passing** (44 pre-existing parser/serializer + 3 new
  `statsEngine.test.ts` command-queue-lifecycle tests + 2 new `agent-status` propagation tests),
  run inside the real `@vscode/test-electron` Extension Host (cached VS Code 1.135.0 binary in
  `.vscode-test/`). Initially caught and fixed the `lastActivity` regression above via a failing
  assertion before it reached the PR.
- New tests use a throwaway nested-layout squad fixture under
  `<repo>/.stats-engine-test-fixture/.squad/squads/statsfixture/team.md`, created in
  `suiteSetup`/removed in `suiteTeardown` — not an OS temp dir, consistent with this suite's
  existing convention of resolving fixture paths relative to `__dirname`.

## Scope discipline

Working tree had unrelated in-progress work from other agents at the time (a `switch/*` branch
with staged `whoOwns.ts`/test changes, later committed to their own branch as `acdedb0` while I was
still investigating — see history.md note on shared-checkout branch switches). Branched from local
`main` (post-#23 merge) instead of the dirty feature branch I found checked out, and staged/
committed only the 5 files listed above. Did not touch `ctx.commandQueue` (a pre-existing unused
field on `SquadContext` — same dead-state smell as the two bugs fixed here, but out of scope) or
any PR #24/#25 concerns.

## Handoff

PR #28 is open against `main`, ready for review. Both issues are cross-cutting on the same
event-bus/registry/stats-engine files, so a second PR was not warranted.
