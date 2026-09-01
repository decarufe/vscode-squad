<div align="center">

# 🎖️ VS Code Squad

**Manage AI agent teams directly from VS Code.**\
Define roles, assign tasks, track decisions, and run ceremonies — powered by a human-readable Markdown protocol.

[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.96.0-007ACC?logo=visual-studio-code&logoColor=white)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

[![GitHub stars](https://img.shields.io/github/stars/amih90/vscode-squad?style=social)](https://github.com/amih90/vscode-squad/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/amih90/vscode-squad?style=social)](https://github.com/amih90/vscode-squad/network/members)
[![GitHub issues](https://img.shields.io/github/issues/amih90/vscode-squad?color=green)](https://github.com/amih90/vscode-squad/issues)

---

*No databases. No servers. No lock-in. Just Markdown files in your repo.*

</div>

## What is Squad?

Squad turns your VS Code workspace into a **command center for AI agent teams**. Each squad lives in a `.squad/` directory as plain Markdown files — version-controlled, human-readable, and fully portable. You define agents, their roles, and what they own. Squad handles the rest.

<table>
<tr>
<td width="25%" align="center">

**📄 File-First**\
Everything is Markdown — `team.md`, `charter.md`, `decisions.md`. Git-friendly by design.

</td>
<td width="25%" align="center">

**👥 Multi-Squad**\
Run multiple squads per workspace, each with its own roster and protocol.

</td>
<td width="25%" align="center">

**💬 Chat-Native**\
Use `@squad` in VS Code Chat to switch squads, assign tasks, and query agents.

</td>
<td width="25%" align="center">

**⚡ Zero Config**\
Pick a template, get a squad. Start working immediately.

</td>
</tr>
</table>

## Quick Start

```
1. Install the extension
2. Cmd+Shift+P → "Squad: Create New Squad"
3. Pick a template (Full-Stack, Code Review, Solo + Copilot, Full Squad, or Empty)
4. Check the Squad panel in the Activity Bar ✨
```

Or jump straight into chat: **`@squad /status`**

## Features

<details>
<summary><b>🏗️ Squad Management</b> — Create, switch, search, and manage multiple squads</summary>

- **Create squads** from 5 built-in templates with pre-configured agents and charters
- **Multiple squads** per workspace — switch between them instantly
- **Search across squads** for agents, roles, and skills
- **Delete squads** when they're no longer needed

</details>

<details>
<summary><b>🤖 Agent Roster</b> — Define agents with roles, charters, and ownership</summary>

- **Add/remove/edit** agents with roles, charters, and status
- **Agent charters** — auto-generated role-specific Markdown files defining scope, owned files, and boundaries
- **Status tracking** — Active, Working, Idle, Error, Offline
- **Alumni archive** — removed agents are preserved, not deleted
- **Who Owns This File?** — right-click any file to find the responsible agent

</details>

<details>
<summary><b>📋 Task Queue</b> — Assign tasks to agents or broadcast to the team</summary>

- **Enqueue commands** for individual agents or the entire squad
- **Track status** — queued → running → completed / failed
- **View and clear** the command queue from the Activity panel

</details>

<details>
<summary><b>📊 Dashboard & Views</b> — Real-time visibility into your squad</summary>

- **Squad Dashboard** — webview panel with health score, agent grid, activity feed
- **Agent Detail** — deep-dive into any agent's charter, stats, and task queue
- **Activity panel** — real-time log stream with filtering
- **Status bar** — squad name, health score, quick actions

</details>

<details>
<summary><b>🗳️ Decisions & Ceremonies</b> — Structured team alignment</summary>

- **Record decisions** with author, reasoning, and timestamps
- **Run ceremonies** — Standup, Sprint Planning, Retrospective, Design Review
- **Generated ceremony notes** with per-agent sections, saved as dated Markdown files

</details>

<details>
<summary><b>💬 Chat Participant</b> — <code>@squad</code> in VS Code Chat</summary>

| Command | Description |
|---------|-------------|
| `/status` | Squad overview with health and agent table |
| `/switch [name]` | Switch active squad |
| `/assign [task]` | Assign to whole squad or `@agent` |
| `/roster` | Detailed roster view |
| `/agents [name]` | List agents or drill into one |

</details>

<details>
<summary><b>📁 Squad Protocol Files</b> — The Markdown protocol behind it all</summary>

| File | Purpose |
|------|---------|
| `team.md` | Agent roster — roles, status, charters |
| `charter.md` | Per-agent scope, boundaries, owned files |
| `decisions.md` | Shared decision log |
| `routing.md` | File pattern → agent routing rules |
| `ceremonies.md` | Ceremony templates and schedules |
| `history.md` | Per-agent session learnings |

</details>

## Squad Directory Structure

<details>
<summary>Click to expand</summary>

```
.squad/
└── squads/
    └── my-squad/
        ├── team.md               # Agent roster (Markdown table)
        ├── decisions.md          # Decision log
        ├── ceremonies.md         # Ceremony templates
        ├── routing.md            # Task routing rules
        ├── agents/
        │   ├── lead/
        │   │   ├── charter.md    # Role, scope, owned files
        │   │   └── history.md    # Session learnings
        │   ├── backend/
        │   │   ├── charter.md
        │   │   └── history.md
        │   └── _alumni/          # Archived agents
        ├── decisions/
        │   └── inbox/            # Agent decision drops
        ├── casting/              # Identity policy & registry
        ├── log/                  # Session archives
        ├── orchestration-log/    # Spawn & execution records
        ├── ceremonies/           # Generated ceremony notes
        └── skills/               # (reserved)
```

Squad also reads and writes the flat layout — the same files directly under `.squad/` (`.squad/team.md`, `.squad/agents/…`) as produced by the `squad` coordinator/CLI. Both layouts are first-class and can coexist in one workspace; see [Multi-Squad Workflow](docs/multi-squad.md#supported-layouts).

</details>

## Templates

| Template | Agents | Best For |
|----------|:------:|----------|
| 🚀 **Full-Stack AI Team** | 7 | Web applications — Lead, Backend, Frontend, Tester, Scribe, Ralph, @copilot |
| 🔍 **Code Review Squad** | 5 | Code quality — Lead, Security, Tester, Scribe, @copilot |
| 🧑‍💻 **Solo + Copilot** | 3 | Solo devs — Lead, Scribe, @copilot |
| 🏢 **Full Squad** | 8 | Complex projects — Lead, Backend, Frontend, Tester, Designer, Architect, Scribe, Ralph |
| 📦 **Empty Squad** | 0 | Build your own from scratch |

## Commands

> 33 commands available — see [docs/commands.md](docs/commands.md) for the full reference.

| Command | Description |
|---------|-------------|
| `Squad: Create New Squad` | Create from template |
| `Squad: Switch Active Squad` | Switch between squads |
| `Squad: Add Member` | Add an agent |
| `Squad: Enqueue Agent Command` | Assign a task |
| `Squad: Open Dashboard` | Open squad dashboard |
| `Squad: Run Ceremony` | Run standup / retro / planning |
| `Squad: Who Owns This File?` | Find the owning agent |
| `Squad: Getting Started` | Open the walkthrough |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `squad.logBufferSize` | `1000` | Max log entries in memory |
| `squad.autoOpenDashboard` | `false` | Auto-open dashboard on squad detection |
| `squad.notifications.enabled` | `true` | Show agent event notifications |
| `squad.notifications.errors` | `true` | Show agent error notifications |
| `squad.healthScore.enabled` | `true` | Show health score in status bar |

## Documentation

| Guide | |
|-------|-------------|
| 📖 [Getting Started](docs/getting-started.md) | First-time setup and walkthrough |
| 🔧 [Commands Reference](docs/commands.md) | All 33 commands with usage |
| 💬 [Chat Participant](docs/chat-participant.md) | Using `@squad` in VS Code Chat |
| 👥 [Multi-Squad Workflow](docs/multi-squad.md) | Running multiple squads |
| 📊 [Dashboard & Views](docs/dashboard-and-views.md) | UI panels and sidebar |
| 📁 [Squad Protocol](docs/squad-protocol.md) | File format and directory structure |

## Requirements

- **VS Code** ^1.96.0 (or VS Code Insiders)
- No additional dependencies — zero runtime overhead

## Contributing

Contributions are welcome! Please read our **[Contributing Guide](CONTRIBUTING.md)** for details on:

- 🛠️ Development setup and build commands
- 📁 Project structure overview
- 🔀 Pull request workflow
- 🐛 How to report bugs and request features

Please note that this project follows a **[Code of Conduct](CODE_OF_CONDUCT.md)**. By participating, you agree to uphold a welcoming and inclusive environment.

## Security

For information about reporting vulnerabilities, see our **[Security Policy](SECURITY.md)**.

## License

This project is licensed under the **[MIT License](LICENSE)**.

---

<div align="center">

**[⭐ Star this repo](https://github.com/amih90/vscode-squad)** if you find it useful!

Made with ❤️ for the AI-powered development community.

**[Contributing](CONTRIBUTING.md)** · **[Code of Conduct](CODE_OF_CONDUCT.md)** · **[Security](SECURITY.md)** · **[License](LICENSE)**

</div>
