# Trinity History

## Learnings
- Build webview UI that mirrors Squad Desktop interaction style.
- Prioritize team roster visibility, command queue clarity, and manageability.
- Coordinate with extension host APIs for real-time state updates.

## 2026-09-01 — Issue #9: roster emoji derivation (fix, not new feature)
- `buildAgentMap()` in `src/core/squadRegistry.ts` was hardcoding every regular
  member's `AgentRuntime.emoji` to `👤`, even though `team.md`'s `## Members`
  Status column already encodes each identity's emoji (e.g. Scribe `📋 Silent`,
  Ralph `🔄 Monitor`) — the runtime was silently discarding that data.
- Fix: added `deriveMemberEmoji(member)` which reads the leading emoji token
  from `member.status`, falls back to name-based identity for Scribe/Ralph
  (in case status text changes/omits the emoji), then `👤` as last resort.
  Coordinator (`🏗️`) and Coding Agent (`🤖`, from the `## Coding Agent` section
  — covers `@copilot`) emoji assignment were already correct and untouched.
- Scope discipline: touched only `src/core/squadRegistry.ts`. Did not touch
  `src/team/parser.ts` (#1/#2, Morpheus), layout/state unification (#3/#5,
  Neo), the team.md file watcher (#4, Tank), executor reliability (#8, Tank),
  or the test harness (#10, Switch).
- Validation: `npm run compile` is clean. No dedicated unit test target
  exists yet for `squadRegistry.ts` (test harness itself is issue #10, owned
  by Switch, not in scope here) — compile + manual review of the emoji
  derivation logic against `team.md`'s actual Status column values was the
  narrowest available check.
- Gotcha: `eslint src` currently fails repo-wide with "couldn't find
  eslint.config.*" (ESLint 10 requires flat config, repo still has legacy
  `.eslintrc.*` setup) — pre-existing/unrelated to this change, left alone.

