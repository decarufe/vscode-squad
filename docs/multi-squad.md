# Multi-Squad Workflow

VS Code Squad supports multiple squads per workspace. Each squad has its own roster, agents, charters, decisions, and ceremony history — completely independent of each other.

## Directory Layout

```
your-workspace/
├── .squad/
│   └── squads/
│       ├── frontend-team/
│       │   ├── team.md
│       │   ├── agents/
│       │   ├── decisions.md
│       │   └── ...
│       ├── backend-team/
│       │   ├── team.md
│       │   ├── agents/
│       │   ├── decisions.md
│       │   └── ...
│       └── devops/
│           ├── team.md
│           ├── agents/
│           └── ...
├── src/
└── package.json
```

A workspace may also contain a flat `.squad/team.md` squad alongside `.squad/squads/` — see [Supported Layouts](#supported-layouts).

## Creating Multiple Squads

Run `Squad: Create New Squad` multiple times. Each time you'll be prompted for a unique squad name. The extension validates that no two squads share the same name within a workspace folder.

```
Squad: Create New Squad  →  "frontend-team"  →  Full-Stack AI Team template
Squad: Create New Squad  →  "backend-team"   →  Code Review Squad template
Squad: Create New Squad  →  "devops"         →  Empty Squad template
```

## Switching Squads

### From the Sidebar
Click a squad in the **Squads** panel to switch to it.

### From the Command Palette
```
Squad: Switch Active Squad
```
Pick from the list of all detected squads.

### From the Status Bar
Click the squad name in the status bar to open the squad picker.

### From Chat
```
@squad /switch frontend-team
@squad /switch devops
```

## What Changes When You Switch

When you switch the active squad:

- **Roster** updates to show the new squad's agents
- **Dashboard** refreshes with the new squad's health score and activity
- **Status bar** shows the new squad name
- **Agent Detail** panels close (re-open from the new roster)
- **Commands** (Add Member, Enqueue, etc.) target the new active squad

## Searching Across Squads

You don't need to switch to find something. `Squad: Search Across Squads` searches all squads:

```
Squad: Search Across Squads  →  "backend"
```

Results show: `[squad-name] Agent Name — Role` for every match.

You can also use chat:

```
@squad /status         → shows current squad
@squad /switch other   → switch and check
```

## Deleting a Squad

```
Squad: Delete Squad
```

Pick the squad to delete. Only the selected squad's directory is removed — other squads are untouched.

## Supported Layouts

Two on-disk layouts are **both first-class**, and they may coexist in the same workspace folder:

| Layout | Path | Use |
|--------|------|-----|
| **Nested (canonical)** | `.squad/squads/<name>/team.md` | Multiple squads per workspace. Created by `Squad: Create New Squad`. |
| **Flat (interop)** | `.squad/team.md` | A single squad at the root of `.squad/`. Written by the `squad` coordinator/CLI and used by many existing repos. |

```
your-workspace/
├── .squad/
│   ├── team.md              ← flat squad (registered)
│   ├── agents/
│   ├── decisions.md
│   └── squads/
│       ├── frontend-team/   ← nested squad (registered)
│       │   └── team.md
│       └── backend-team/    ← nested squad (registered)
│           └── team.md
```

A workspace like the one above shows **three** squads in the Squads panel. Discovery rules:

- Every directory under `.squad/squads/` that contains a `team.md` is registered.
- `.squad/team.md` is registered too — the presence of `.squad/squads/` no longer hides it.
- The flat squad is named after the workspace folder (it would otherwise be called `.squad`); nested squads use their directory name.
- Deleting a flat squad removes only its own files (`team.md`, `agents/`, `decisions*`, `routing.md`, `ceremonies*`, `casting/`, `log/`, `orchestration-log/`, `skills/`) — `.squad/squads/` is preserved.

**Which layout should I use?** New squads created from the extension use the canonical nested layout. Keep an existing flat squad as-is: it interoperates with the coordinator agent and CLI, and the extension edits it in place without migrating it.

## Tips

- **Name squads by responsibility** — `frontend-team`, `security-squad`, `data-pipeline` — not by project name
- **Use different templates** for different squad types — Code Review Squad for quality, Full-Stack for feature work
- **Cross-squad search** is great for finding which squad owns a particular domain
- Each squad's decisions and ceremony logs are independent — useful for team-specific retrospectives
