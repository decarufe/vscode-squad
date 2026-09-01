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
import { readTeamState, teamFilePathFor, writeTeamState } from '../team/teamState';
import { consumeInternalChange, clearInternalChanges } from '../team/watcher';
import { log } from '../utils/logger';

/**
 * On-disk shape of a squad directory.
 * - `nested`  — canonical multi-squad layout: `.squad/squads/<name>/team.md`
 * - `flat`    — interoperable single-squad layout: `.squad/team.md`
 *
 * Both are first-class and may coexist in the same workspace folder.
 */
export type SquadLayout = 'flat' | 'nested';

export interface SquadContext {
  rootPath: string;
  squadDir: string;
  squadName: string;
  layout: SquadLayout;
  teamState: TeamState;
  agents: Map<string, AgentRuntime>;
  logBuffer: RingBuffer<LogEntry>;
  commandQueue: CommandQueueItem[];
  statistics: SquadStatistics;
  watcher: vscode.Disposable;
}

const SQUAD_DIR_NAME = '.squad';
const SQUADS_SUBDIR_NAME = 'squads';

/** A directory is a flat squad when it is the `.squad` directory itself. */
function detectLayout(squadDir: string): SquadLayout {
  return path.basename(squadDir) === SQUAD_DIR_NAME ? 'flat' : 'nested';
}

/**
 * Workspace root for a squad directory.
 * flat:   <root>/.squad                    → up 1
 * nested: <root>/.squad/squads/<name>      → up 3
 */
function deriveRootPath(squadDir: string, layout: SquadLayout): string {
  return layout === 'flat'
    ? path.resolve(squadDir, '..')
    : path.resolve(squadDir, '..', '..', '..');
}

/**
 * Display name for a squad. Nested squads use their directory name; a flat
 * squad would otherwise be called ".squad", so it takes the workspace folder
 * name instead.
 */
function deriveSquadName(squadDir: string, layout: SquadLayout, rootPath: string): string {
  if (layout === 'nested') {
    return path.basename(squadDir);
  }
  return path.basename(rootPath) || SQUAD_DIR_NAME;
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
export function deriveMemberEmoji(member: TeamState['members'][number]): string {
  const statusEmoji = member.status?.trim().split(/\s+/)[0];
  // '✅' is the generic default status glyph for ordinary "Active" members
  // (see serializer.ts: `m.status ?? '✅ Active'`) — it is not an identity
  // marker like Scribe's '📋' or Ralph's '🔄', so it must not be honored
  // here or every plain active member would incorrectly render '✅'.
  if (statusEmoji && statusEmoji !== '✅' && /\p{Emoji}/u.test(statusEmoji)) {
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
    const teamFilePath = teamFilePathFor(squadDir);
    if (!fs.existsSync(teamFilePath)) {
      return;
    }
    if (this.contexts.has(squadDir)) {
      return;
    }

    const teamState = readTeamState(squadDir);
    if (!teamState) {
      return;
    }
    const agents = buildAgentMap(teamState);

    const stats = emptyStatistics();
    stats.totalAgents = agents.size;

    // Watch exactly `team.md` inside this squad directory. An empty glob
    // (the previous implementation) never matches anything, so external
    // edits silently failed to refresh the roster.
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(squadDir, 'team.md'),
    );

    const onTeamFileChange = () => {
      if (consumeInternalChange(teamFilePath)) {
        return;
      }
      this.reloadSquad(squadDir);
    };

    fileWatcher.onDidChange(onTeamFileChange);
    fileWatcher.onDidCreate(onTeamFileChange);

    const layout = detectLayout(squadDir);
    const rootPath = workspaceRoot ?? deriveRootPath(squadDir, layout);
    const squadName = deriveSquadName(squadDir, layout, rootPath);

    const context: SquadContext = {
      rootPath,
      squadDir,
      squadName,
      layout,
      teamState,
      agents,
      logBuffer: new RingBuffer<LogEntry>(1000),
      commandQueue: [],
      statistics: stats,
      watcher: fileWatcher,
    };

    this.contexts.set(squadDir, context);
    log(`Registered ${layout} squad "${squadName}" at ${squadDir}`);

    if (!this._activeSquadPath) {
      this._activeSquadPath = squadDir;
    }

    eventBus.emit('squad-activated', { squadPath: squadDir });
  }

  /**
   * Re-read `team.md` from disk into the existing context. Used by the file
   * watcher when a squad is edited outside the extension.
   */
  reloadSquad(squadDir: string): void {
    const ctx = this.contexts.get(squadDir);
    if (!ctx) {
      return;
    }
    const newState = readTeamState(squadDir);
    if (!newState) {
      return;
    }
    this.applyStateToContext(ctx, newState);
  }

  /**
   * Single mutation entry point: persist `state` to disk and update the
   * in-memory context (team state, agent map, statistics) in one step, then
   * notify listeners. Commands must use this instead of writing `team.md`
   * directly so the UI reflects changes immediately.
   */
  async applyTeamState(squadDir: string, state: TeamState): Promise<void> {
    const ctx = this.contexts.get(squadDir);
    if (!ctx) {
      log('applyTeamState called for unknown squad', squadDir);
      return;
    }
    if (!state.filePath) {
      state.filePath = teamFilePathFor(squadDir);
    }
    await writeTeamState(state);
    this.applyStateToContext(ctx, state);
  }

  private applyStateToContext(ctx: SquadContext, state: TeamState): void {
    ctx.teamState = state;
    ctx.agents = buildAgentMap(state);
    ctx.statistics.totalAgents = ctx.agents.size;
    eventBus.emit('team-changed', { squadPath: ctx.squadDir, state });
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

  /** Unregister every squad discovered under a workspace folder. */
  unregisterFolder(rootPath: string): void {
    for (const ctx of this.allContexts) {
      if (ctx.rootPath === rootPath) {
        this.unregisterSquad(ctx.squadDir);
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
      await this.scanWorkspaceFolder(folder.uri.fsPath);
    }
  }

  /**
   * Discover every squad in a workspace folder. Both supported layouts are
   * first-class and are registered even when they coexist:
   *   - nested: `.squad/squads/<name>/team.md` (canonical, multi-squad)
   *   - flat:   `.squad/team.md` (single squad, CLI/coordinator interop)
   */
  async scanWorkspaceFolder(rootPath: string): Promise<void> {
    const squadRoot = path.join(rootPath, SQUAD_DIR_NAME);
    if (!fs.existsSync(squadRoot)) {
      return;
    }

    // Nested layout: .squad/squads/<name>/team.md
    const squadsDir = path.join(squadRoot, SQUADS_SUBDIR_NAME);
    if (fs.existsSync(squadsDir) && fs.statSync(squadsDir).isDirectory()) {
      for (const entry of fs.readdirSync(squadsDir).sort()) {
        const candidateDir = path.join(squadsDir, entry);
        if (fs.statSync(candidateDir).isDirectory()) {
          await this.registerSquad(candidateDir, rootPath);
        }
      }
    }

    // Flat layout: .squad/team.md — registered alongside any nested squads.
    await this.registerSquad(squadRoot, rootPath);
  }

  dispose(): void {
    for (const context of this.contexts.values()) {
      context.watcher.dispose();
    }
    this.contexts.clear();
    this._activeSquadPath = undefined;
    clearInternalChanges();
  }
}

export const squadRegistry = new SquadRegistry();
