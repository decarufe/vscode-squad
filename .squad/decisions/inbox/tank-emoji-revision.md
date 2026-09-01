# Roster Emoji Regression Revision (Issue #9, reopened)

- **Author:** Tank (VS Code Extension Dev)
- **Requested by:** Eric De Carufel
- **Date:** 2026-09-01
- **Scope:** `src/core/squadRegistry.ts` only (narrow regression fix on top of
  Trinity's merged PR #24)
- **Lockout:** Reviewer (Switch) rejected PR #24's merged behavior and
  reopened #9 with Trinity locked out of producing the revision; Tank took it
  over per reviewer rejection lockout.

## Problem

PR #24 added `deriveMemberEmoji()`, which reads the leading
whitespace-delimited token of `member.status` and uses it verbatim if it
matches `/\p{Emoji}/u`. This correctly surfaced Scribe's `📋 Silent` and
Ralph's `🔄 Monitor` statuses. However, `src/team/serializer.ts` defaults
every ordinary member's status to `'✅ Active'` when no explicit status is
set, and `✅` is itself a valid emoji code point. The result: every plain
active member (Neo, Trinity, Morpheus, Switch, Tank, ...) rendered `✅`
instead of the intended generic `👤`, because the "just a placeholder"
checkmark was indistinguishable, from the regex's point of view, from a real
identity glyph.

## Decision

Added a single, explicit exclusion to the existing fast path in
`deriveMemberEmoji`:

```ts
if (statusEmoji && statusEmoji !== '✅' && /\p{Emoji}/u.test(statusEmoji)) {
  return statusEmoji;
}
```

When the status-derived token is exactly `✅` (the generic default), the
function falls through to the pre-existing name-based fallback
(`scribe` → `📋`, `ralph` → `🔄`) and finally the generic `👤`, unchanged
from PR #24.

`🏗️` (coordinator, hardcoded in `buildAgentMap`) and `🤖` (`@copilot` /
coding agent, hardcoded in `buildAgentMap`) branches were not touched — they
were already correct and are out of scope for issue #9.

## Acceptance verified

- Scribe → `📋`
- Ralph → `🔄`
- `@copilot` → `🤖`
- Neo / Trinity / Morpheus / Switch / Tank (ordinary `✅ Active` members) →
  `👤`
- Coordinator → `🏗️` (unaffected)

## Why this shape

- Single-line, denylist-style fix keeps the blast radius minimal and directly
  targets the collision between "generic placeholder emoji" and "identity
  emoji" without restructuring `deriveMemberEmoji`'s control flow.
- Avoids reintroducing a second name→emoji table or changing `TeamState`
  shape; the source-of-truth precedence (status emoji > name fallback >
  generic) from PR #24 is preserved, just guarded against the one known
  collision.
- If a *different* generic placeholder status is ever introduced (e.g. a
  default "⏸️ Idle"), the same pattern applies: exclude the specific glyph,
  don't remove the whole status-emoji fast path, since real per-agent status
  emoji (Scribe/Ralph, and any future identity-bearing status) still need it.

## Testing

Added `src/test/suite/squadRegistry.test.ts` (new file — no test previously
existed for `squadRegistry.ts`) exporting and exercising `deriveMemberEmoji`
directly:
- Scribe/Ralph via name fallback (no status emoji present)
- Scribe/Ralph via explicit status emoji (`📋 Silent`, `🔄 Monitor`)
- All five ordinary-member names from the acceptance criteria with
  `'✅ Active'` status → `👤`
- A genuinely distinct status emoji (not `✅`) is still honored
- A member with no status at all → `👤`

Verified in an isolated `git worktree` (the shared team working directory
had another agent's branch checked out mid-task) against a fresh
`origin/main` checkout:
- `npm run compile` — clean
- `npm test` — 80/80 passing, 0 failing

Reverting just the fix (keeping the new test file) reproduces exactly 4
failing assertions (Scribe/Ralph name-fallback and explicit-status cases),
confirming the test suite actually detects the PR #24 regression rather than
passing vacuously.

## Out of scope (explicitly not touched)

- `src/team/parser.ts`, `src/team/serializer.ts` (status-string format itself)
- Coordinator (`🏗️`) / coding-agent (`🤖`) branches in `buildAgentMap`
- Any other issue in the backlog (#1–#8, #10, #19, etc.)

## Follow-ups

- If team.md ever grows more generic default statuses beyond `✅ Active`,
  revisit whether an allowlist (only trust *specific* known identity glyphs)
  is more robust than a denylist (exclude *specific* known placeholder
  glyphs). Deferred here to keep the fix minimal and match the reopened
  issue's exact acceptance criteria.
- PR: `tank/9-roster-emoji-active-regression` → decarufe/vscode-squad#29,
  targeting `main`, references and closes #9.
