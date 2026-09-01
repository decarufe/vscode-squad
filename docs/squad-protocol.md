# Squad Protocol & File Formats

This guide describes every file and directory inside a squad directory. These files define how your AI agent squad is configured, operates, and records its work.

A squad directory is either `.squad/squads/<name>/` (canonical, multi-squad) or `.squad/` itself (flat, single squad — used by the `squad` coordinator/CLI). Both layouts contain the same files, are read and written identically by the extension, and may coexist in one workspace. See [Multi-Squad Workflow](multi-squad.md#supported-layouts).

## Directory Structure

```
.squad/squads/<squad-name>/     # or .squad/ for the flat layout
├── team.md                 # Roster — agent names, roles, status
├── decisions.md            # Shared decision log all agents read
├── decisions/
│   └── inbox/              # Drop-box for parallel decision writes
├── routing.md              # Who handles what work
├── ceremonies.md           # Team meetings configuration
├── agents/
│   ├── <agent-slug>/
│   │   ├── charter.md      # Agent's mission, skills, boundaries
│   │   └── history.md      # Agent's task history
│   └── ...
├── casting/
│   ├── casting-policy.json
│   ├── casting-history.json
│   └── casting-registry.json
├── skills/
│   └── squad-conventions/
│       └── SKILL.md
├── log/                    # Session logs (written by Scribe)
├── orchestration-log/      # Coordinator orchestration records
└── copilot-instructions.md # Auto-generated instructions for Copilot
```

## team.md

The roster file. This is the source of truth for who's on the squad.

### Format

```markdown
# Team Roster

## Project Context

- **Building:** VS Code extension for managing AI squads
- **Tech Stack:** TypeScript, VS Code Extension API, Node.js
- **User:** Ami Hollander

## Members

| Name | Role | Charter | Status | Notes |
|------|------|---------|--------|-------|
| Squad | Coordinator | — | ✅ Active | Routes work |
| Neo | Lead / Architect | `.squad/agents/neo/charter.md` | ✅ Active | |
| Trinity | Frontend Dev | `.squad/agents/trinity/charter.md` | ✅ Active | |
| @copilot | Coding Agent | — | 🤖 Coding Agent | |
```

### Sections Parsed

| Section | Purpose |
|---------|---------|
| `## Project Context` | Metadata — description, tech stack, owner |
| `## Members` | Main roster table |
| `## Coordinator` | Optional dedicated section for the coordinator |
| `## Coding Agent` | Optional section for @copilot with capability profile |

### Member Classification

Members are classified by role keywords:

| Section | Detection |
|---------|-----------|
| `coordinator` | Role contains "coordinator" |
| `codingAgent` | Name contains "@copilot" or role contains "coding agent" |
| `members` | Everything else |

### Status Values

Common status strings used in the Status column:

| Status | Meaning |
|--------|---------|
| `✅ Active` | Ready for work |
| `📋 Silent` | Background agent (e.g. Scribe) |
| `🔄 Monitor` | Monitoring agent (e.g. Ralph) |
| `🤖 Coding Agent` | Copilot integration |
| `⏸ Paused` | Temporarily inactive |

## charter.md (Agent Charter)

Each agent gets a charter at `agents/<slug>/charter.md`. This defines the agent's identity, responsibilities, and boundaries.

### Template Structure

```markdown
# {Name} — {Role}

> {One-line personality statement}

## Identity
- **Name:** {Name}
- **Role:** {Role title}
- **Expertise:** {2-3 specific skills}
- **Style:** {Communication style}

## What I Own
- {Responsibility 1}
- {Responsibility 2}

## How I Work
- {Approach or principle}

## Boundaries
**I handle:** {types of work}
**I don't handle:** {out of scope}
**When I'm unsure:** I say so and suggest who might know.

## Model
- **Preferred:** auto
- **Rationale:** Coordinator selects based on task type

## Collaboration
Before starting work, read `.squad/decisions.md`.
After making a decision, write it to `.squad/decisions/inbox/{my-name}-{slug}.md`.

## Voice
{Personality description — specific, opinionated, distinctive}
```

## history.md (Agent History)

Records project-level learnings at `agents/<slug>/history.md`.

```markdown
# Project Context

- **Owner:** {user name}
- **Project:** {project description}
- **Stack:** {languages, frameworks, tools}
- **Created:** {timestamp}

## Learnings

<!-- Append new learnings below -->
```

## decisions.md

The shared decision log. All agents read this before starting work.

```markdown
# Decisions

## 2026-02-28 — API Response Format

- **Who:** Neo, Morpheus
- **What:** Use JSON:API format for all REST endpoints
- **Why:** Consistency with existing services

## 2026-02-28 — Test Coverage Threshold

- **Who:** Switch
- **What:** Minimum 80% coverage for new code
- **Why:** Regression prevention
```

### decisions/inbox/

Agents write decisions here in parallel. The Scribe agent periodically merges inbox files into the main `decisions.md`, deduplicating overlapping entries.

File naming: `{agent-name}-{brief-slug}.md`

## routing.md

Defines who handles what type of work.

### Routing Table

```markdown
# Work Routing

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Frontend UI | Trinity | Components, styling, responsive layout |
| Backend API | Morpheus | Endpoints, database, integration |
| Architecture | Neo | System design, tech decisions |
| Code review | Switch | Review PRs, check quality |
| Session logging | Scribe | Automatic — never needs routing |
| Well-defined bugs | @copilot 🤖 | Clear repro, bounded scope |
```

### Issue Routing

Labels map to agents:
- `squad` — untriaged, goes to Lead
- `squad:{name}` — assigned to specific agent
- `squad:copilot` — assigned to @copilot

### Routing Rules

1. **Eager by default** — spawn all agents who could start work
2. **Scribe always runs** after substantial work (background mode)
3. **Quick facts** — coordinator answers directly, no agent needed
4. **"Team, ..."** — fan-out to all relevant agents in parallel
5. **Anticipate downstream** — spawn testers alongside feature builders

## ceremonies.md

Configures team meetings that happen before or after work.

### Ceremony Format

```markdown
## Design Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | multi-agent task involving 2+ agents |
| **Facilitator** | lead |
| **Participants** | all-relevant |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. Review the task and requirements
2. Agree on interfaces and contracts
3. Identify risks and edge cases
4. Assign action items
```

### Built-in Ceremony Types

| Ceremony | When | Trigger Condition |
|----------|------|-------------------|
| Design Review | before | Multi-agent task, 2+ agents on shared systems |
| Retrospective | after | Build failure, test failure, or reviewer rejection |

## casting/ Directory

Agent spawning and management records:

| File | Purpose |
|------|---------|
| `casting-policy.json` | Rules for when to spawn/retire agents |
| `casting-history.json` | Log of all agent spawn/retire events |
| `casting-registry.json` | Current active agent registry |

## skills/ Directory

Custom Copilot skills scoped to the squad. The `squad-conventions` skill teaches Copilot about the squad's file layout and conventions.

## orchestration-log/

Records of coordinator orchestration — which agents were spawned, in what order, and the routing decisions made.

## copilot-instructions.md

Auto-generated file that configures GitHub Copilot with squad-specific context. Tells Copilot to:
- Read `team.md` for the roster
- Follow conventions in `decisions.md`
- Write decisions to `decisions/inbox/`

## Tips

- **Edit team.md carefully** — the parser is lenient but relies on Markdown table format with `|` delimiters
- **Agent slugs** are auto-generated from names: lowercased, non-alphanumeric chars replaced with `-`
- **Charter files are auto-scaffolded** when you add a member through the extension
- **decisions/inbox/** is a safe concurrent write location — multiple agents can write simultaneously without conflicts
- Use `Squad: View Decisions` to read the merged decision log from the command palette
