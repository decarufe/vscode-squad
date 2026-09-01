# Decision: Dashboard Send button non-responsive — root cause & fix

**Date:** 2026-09-01
**Author:** Trinity
**Status:** Fixed

## Problem
Squad Dashboard showed an agent selected (via agent list card), a command
typed into the command bar, and the Send button visible — but clicking Send
did nothing. Command queue stayed empty, terminal panel showed no logs, no
visible runtime errors.

## Root cause
`media/dashboard/dashboard.js`: the agent list cards and the command bar's
`#cmd-agent-selector` `<select>` were two independent, unsynchronized sources
of "which agent is selected". `selectAgent(name)` (card click handler) only
updated `state.selectedAgent` for log filtering + posted `agent-selected` to
the host for tracking — it never wrote to the `<select>` element used by the
command bar. `updateSendState()` gated the Send button purely on
`cmdAgentSelector.value`, so if a user selected an agent via a card (the more
prominent, natural UI motion) rather than the dropdown, the button remained
`disabled` (its default HTML state) no matter what was typed. A disabled
button swallows clicks silently — no error, no message posted, no queue
entry, exactly matching the report.

The webview→host message bridge itself (`enqueue-command` →
`commandQueueManager.enqueue` → `command-queued` event → `command-update`
postMessage) was verified correct and unmodified.

## Fix
In `media/dashboard/dashboard.js`:
- Added `syncCommandBarAgentSelection()` to mirror `state.selectedAgent` onto
  `#cmd-agent-selector.value` and refresh the Send button state. Invoked
  from `selectAgent()` (card-click path) and `renderAll()` (state-update
  path).
- Extracted `updateSendButtonState()` to a shared, hoisted function so both
  the card-selection path and the dropdown `change` handler use identical
  enable/disable logic.
- Dropdown `change` handler now also writes back into `state.selectedAgent`
  and re-renders the agent list, so highlighting stays consistent regardless
  of which control the user uses to pick an agent.

## Scope
Only `media/dashboard/dashboard.js` changed. No changes to
`dashboardPanel.ts`, `commandQueue.ts`, `types.ts`, `dashboard.html`, or
`dashboard.css` — the webview↔host message contract and markup were already
correct.

## Validation
- `node --check media/dashboard/dashboard.js` — syntax OK.
- Static verification that the new sync function is defined and called from
  both `selectAgent` and `renderAll`.
- `npm run compile` (tsc) — clean, confirming no regression to the
  unmodified TS bridge code.

## Follow-up suggestion (not done here, out of scope)
Consider a lightweight webview DOM test harness (owned by Switch's test
infra, issue #10) so UI-state-sync bugs like this are caught automatically
instead of only via manual/screenshot triage.
