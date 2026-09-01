# Runtime Roster Emoji Derivation (Issue #9)

- **Author:** Trinity (Frontend Dev)
- **Requested by:** Eric De Carufel
- **Date:** 2026-09-01
- **Scope:** `src/core/squadRegistry.ts` only (issue #9)

## Problem

`buildAgentMap()` (the function that turns a parsed `TeamState` into the
`Map<string, AgentRuntime>` consumed by the roster/dashboard views) hardcoded
`emoji: '👤'` for every entry under `## Members`. This discarded the identity
emoji already encoded in team.md's Status column, so Scribe (`📋 Silent`) and
Ralph (`🔄 Monitor`) rendered identically to every other member in the running
extension, even though the source-of-truth file had the right glyphs.

## Decision

Added `deriveMemberEmoji(member: TeamState['members'][number]): string` in
`src/core/squadRegistry.ts`:

1. Read the leading whitespace-delimited token of `member.status` (e.g.
   `"📋 Silent"` → `"📋"`) and use it if it contains an emoji code point.
2. Fall back to a name-based lookup for well-known identities (`scribe` →
   `📋`, `ralph` → `🔄`) in case status text ever omits the leading emoji.
3. Otherwise fall back to the generic `👤`.

`buildAgentMap()` now calls `deriveMemberEmoji(member)` instead of the
hardcoded literal. The Coordinator (`🏗️`) and Coding Agent (`🤖` — covers
`@copilot`, sourced from the dedicated `## Coding Agent` section) branches
were already correct and are unchanged.

Branch: `trinity/issue-9-roster-emoji` → PR (opened this session), targeting
`main`.

## Why this shape

- Keeps `team.md` as the single source of truth for identity emoji instead of
  introducing a second hardcoded name→emoji table that could drift.
- Name-based fallback is a safety net only, not the primary mechanism, so
  adding new members with a status emoji "just works" with no code change.
- Minimal blast radius: one new pure function + one call-site change, no
  changes to `TeamState`/parser, watcher, or `AgentRuntime` shape.

## Out of scope (explicitly not touched)

- `src/team/parser.ts` (#1/#2 — Morpheus)
- Layout/state unification (#3/#5 — Neo)
- `team.md` file watcher (#4 — Tank)
- Copilot executor reliability (#8 — Tank)
- Test harness scaffolding (#10 — Switch)

## Follow-ups for other squad members

- Once the test harness (#10) lands, a good first unit test target is
  `deriveMemberEmoji`/`buildAgentMap` in `squadRegistry.ts`: assert Scribe →
  `📋`, Ralph → `🔄`, an unlisted member with an emoji status → that emoji, a
  member with no emoji in status → `👤`, and `@copilot` → `🤖`.
- Repo-wide `npm run lint` is currently broken (ESLint 10 needs
  `eslint.config.*`; repo still ships a legacy `.eslintrc.*`). Not caused by
  this change, but worth a CI ticket (relates to #19).
