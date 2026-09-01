import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import type {
  AgentRuntime,
  AgentStatistics,
  CommandQueueItem,
  LogEntry,
  SquadStatistics,
} from './types';
import { eventBus } from './eventBus';
import { RingBuffer } from './ringBuffer';
import type { TeamState } from '../team/teamState';
import { parseTeamFile } from '../team/parser';

export interface SquadContext {
  rootPath: string;
  squadDir: string;
  squadName: string;
  teamState: TeamState;
  agents: Map<string, AgentRuntime>;
  logBuffer: RingBuffer<LogEntry>;
  commandQueue: CommandQueueItem[];
  statistics: SquadStatistics;
  watcher: vscode.Disposable;
}

function emptyStatistics(): SquadStatistics {
  return {
    totalAgents: 0,
    activeAgents: 0,
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    healthScore: 100,
    lastActivityAt: 0,
  };
}

function emptyAgentStatistics(): AgentStatistics {
  return {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    averageDuration: 0,
    lastActiveAt: 0,
    decisionsCount: 0,
    linesChanged: 0,
  };
}

/**
 * Derives a roster emoji for a member. Prefers the leading emoji found in the
 * member's `status` column (e.g. "📋 Silent", "🔄 Monitor") since that is the
 * source of truth defined in team.md. Falls back to well-known identities
 * (Scribe, Ralph) by name, then a generic person emoji.
 */
function deriveMemberEmoji(member: TeamState['members'][number]): string {
  const statusEmoji = member.status?.trim().split(/\s+/)[0];
  if (statusEmoji && /\p{Emoji}/u.test(statusEmoji)) {
    return statusEmoji;
  }
  const lower = member.name.toLowerCase();
  if (lower === 'scribe') {
    return '📋';
  }
  if (lower === 'ralph') {
    return '🔄';
  }
  return '👤';
}

function buildAgentMap(teamState: TeamState): Map<string, AgentRuntime> {
  const agents = new Map<string, AgentRuntime>();
  for (const member of teamState.members) {
    agents.set(member.name, {
      name: member.name,
      role: member.role,
      emoji: deriveMemberEmoji(member),
      charter: member.charter,
      status: 'idle',
      statistics: emptyAgentStatistics(),
    });
  }
  if (teamState.coordinator) {
    agents.set(teamState.coordinator.name, {
      name: teamState.coordinator.name,
      role: teamState.coordinator.role,
      emoji: '🏗️',
      charter: teamState.coordinator.charter,
      status: 'idle',
      statistics: emptyAgentStatistics(),
    });
  }
  if (teamState.codingAgent) {
    agents.set(teamState.codingAgent.name, {
      name: teamState.codingAgent.name,
      role: teamState.codingAgent.role,
      emoji: '🤖',
      charter: teamState.codingAgent.charter,
      status: 'idle',
      statistics: emptyAgentStatistics(),
    });
  }
  return agents;
}

class SquadRegistry {
  private contexts = new Map<string, SquadContext>();
  private _activeSquadPath: string | undefined;

  get activeContext(): SquadContext | undefined {
    if (!this._activeSquadPath) {
      return undefined;
    }
    return this.contexts.get(this._activeSquadPath);
  }

  get allContexts(): SquadContext[] {
    return [...this.contexts.values()];
  }

  get activeSquadPath(): string | undefined {
    return this._activeSquadPath;
  }

  async registerSquad(squadDir: string, workspaceRoot?: string): Promise<void> {
    const teamFilePath = path.join(squadDir, 'team.md');
    if (!fs.existsSync(teamFilePath)) {
      return;
    }

    const content = fs.readFileSync(teamFilePath, 'utf-8');
    const teamState = parseTeamFile(content, teamFilePath);
    const agents = buildAgentMap(teamState);

    const stats = emptyStatistics();
    stats.totalAgents = agents.size;

    const teamFileUri = vscode.Uri.file(teamFilePath);
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(teamFileUri, ''),
    );

    const onTeamFileChange = () => {
      const updated = fs.readFileSync(teamFilePath, 'utf-8');
      const newState = parseTeamFile(updated, teamFilePath);
      const ctx = this.contexts.get(squadDir);
      if (ctx) {
        ctx.teamState = newState;
        ctx.agents = buildAgentMap(newState);
        ctx.statistics.totalAgents = ctx.agents.size;
        eventBus.emit('team-changed', { squadPath: squadDir, state: newState });
      }
    };

    fileWatcher.onDidChange(onTeamFileChange);
    fileWatcher.onDidCreate(onTeamFileChange);

    const rootPath = workspaceRoot ?? path.resolve(squadDir, '..', '..', '..');
    const squadName = path.basename(squadDir);

    const context: SquadContext = {
      rootPath,
      squadDir,
      squadName,
      teamState,
      agents,
      logBuffer: new RingBuffer<LogEntry>(1000),
      commandQueue: [],
      statistics: stats,
      watcher: fileWatcher,
    };

    this.contexts.set(squadDir, context);

    if (!this._activeSquadPath) {
      this._activeSquadPath = squadDir;
    }

    eventBus.emit('squad-activated', { squadPath: squadDir });
  }

  unregisterSquad(squadDir: string): void {
    const context = this.contexts.get(squadDir);
    if (context) {
      context.watcher.dispose();
      this.contexts.delete(squadDir);
      eventBus.emit('squad-deactivated', { squadPath: squadDir });

      if (this._activeSquadPath === squadDir) {
        const remaining = this.contexts.keys().next();
        this._activeSquadPath = remaining.done ? undefined : remaining.value;
      }
    }
  }

  setActiveSquad(squadDir: string): void {
    if (this.contexts.has(squadDir)) {
      this._activeSquadPath = squadDir;
      eventBus.emit('squad-activated', { squadPath: squadDir });
    }
  }

  getContext(squadDir: string): SquadContext | undefined {
    return this.contexts.get(squadDir);
  }

  async scanWorkspaceFolders(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return;
    }
    for (const folder of folders) {
      const rootPath = folder.uri.fsPath;

      // New layout: .squad/squads/<name>/team.md
      const squadsDir = path.join(rootPath, '.squad', 'squads');
      if (fs.existsSync(squadsDir)) {
        for (const entry of fs.readdirSync(squadsDir)) {
          const candidateDir = path.join(squadsDir, entry);
          if (fs.statSync(candidateDir).isDirectory() && !this.contexts.has(candidateDir)) {
            await this.registerSquad(candidateDir, rootPath);
          }
        }
      }

      // Legacy layout: .squad/team.md (single squad per folder)
      const legacyDir = path.join(rootPath, '.squad');
      const legacyTeam = path.join(legacyDir, 'team.md');
      if (fs.existsSync(legacyTeam) && !fs.existsSync(squadsDir) && !this.contexts.has(legacyDir)) {
        await this.registerSquad(legacyDir, rootPath);
      }
    }
  }

  dispose(): void {
    for (const context of this.contexts.values()) {
      context.watcher.dispose();
    }
    this.contexts.clear();
    this._activeSquadPath = undefined;
  }
}

export const squadRegistry = new SquadRegistry();
