import * as vscode from 'vscode';
import { squadRegistry, SquadContext } from '../core/squadRegistry';
import { commandQueueManager } from '../monitoring/commandQueue';
import { copilotExecutor } from '../monitoring/copilotExecutor';
import { eventBus } from '../core/eventBus';
import { logStore } from '../monitoring/logStore';
import { log } from '../utils/logger';
import type { AgentRuntime } from '../core/types';

const PARTICIPANT_ID = 'squad.chat';

/**
 * Pure parsing/matching helpers extracted from the chat command handlers so
 * they can be unit-tested without spinning up the VS Code chat UI (`stream`,
 * `request`, etc.). Behavior is unchanged from the inline logic they replace.
 */

/** Result of matching a `/switch` query against the known squads. */
export type SquadQueryMatch<T> =
  | { kind: 'exact' | 'partial-single'; match: T }
  | { kind: 'ambiguous'; matches: T[] }
  | { kind: 'none' };

/**
 * Match a `/switch` query against known squads: exact name match first, then
 * a case-insensitive substring match. Mirrors the original inline logic in
 * `handleSwitch` (exact -> single-partial -> ambiguous -> none).
 */
export function matchSquadByQuery<T extends { squadName: string }>(
  squads: T[],
  query: string,
): SquadQueryMatch<T> {
  const q = query.toLowerCase();

  const exact = squads.find((s) => s.squadName.toLowerCase() === q);
  if (exact) {
    return { kind: 'exact', match: exact };
  }

  const partial = squads.filter((s) => s.squadName.toLowerCase().includes(q));
  if (partial.length === 1) {
    return { kind: 'partial-single', match: partial[0] };
  }
  if (partial.length > 1) {
    return { kind: 'ambiguous', matches: partial };
  }

  return { kind: 'none' };
}

/** Parsed `@agent task` mention used by `/assign`. */
export interface AssignMention {
  agentName: string;
  task: string;
}

/** Parse an `@agentName task text` mention out of an `/assign` prompt. */
export function parseAssignMention(prompt: string): AssignMention | null {
  const match = prompt.match(/^@(\S+)\s+(.+)$/);
  if (!match) {
    return null;
  }
  return { agentName: match[1], task: match[2] };
}

/** Parsed `/complete @agent success|failure [summary]` arguments. */
export interface CompleteArgs {
  agentName: string;
  isSuccess: boolean;
  summary?: string;
}

/** Parse the arguments of a `/complete` command. */
export function parseCompleteArgs(prompt: string): CompleteArgs | null {
  const match = prompt.match(/^@?(\S+)\s+(success|failure|done|error)(?:\s+(.*))?$/i);
  if (!match) {
    return null;
  }
  const [, agentName, statusRaw, summary] = match;
  const isSuccess = statusRaw.toLowerCase() === 'success' || statusRaw.toLowerCase() === 'done';
  return { agentName, isSuccess, summary: summary || undefined };
}

/** Parsed `/progress @agent message` arguments. */
export interface ProgressArgs {
  agentName: string;
  message: string;
}

/** Parse the arguments of a `/progress` command. */
export function parseProgressArgs(prompt: string): ProgressArgs | null {
  const match = prompt.match(/^@?(\S+)\s+(.+)$/s);
  if (!match) {
    return null;
  }
  const [, agentName, message] = match;
  return { agentName, message };
}

/**
 * Find an agent by exact name match first, then case-insensitive substring
 * match, mirroring the original inline logic in `handleAgents`.
 */
export function findAgentByQuery(
  agents: [string, AgentRuntime][],
  query: string,
): [string, AgentRuntime] | undefined {
  const q = query.toLowerCase();
  return agents.find(([name]) => name.toLowerCase() === q || name.toLowerCase().includes(q));
}

export function registerChatParticipant(context: vscode.ExtensionContext): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');

  return participant;
}

const handler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> => {
  const command = request.command;

  if (command === 'status') {
    return handleStatus(stream);
  }

  if (command === 'switch') {
    return handleSwitch(request, stream);
  }

  if (command === 'assign') {
    return handleAssign(request, stream);
  }

  if (command === 'roster') {
    return handleRoster(stream);
  }

  if (command === 'agents') {
    return handleAgents(request, stream);
  }

  if (command === 'complete') {
    return handleComplete(request, stream);
  }

  if (command === 'progress') {
    return handleProgress(request, stream);
  }

  // Default: show help & squad context summary
  return handleDefault(request, stream);
};

export function handleStatus(stream: vscode.ChatResponseStream): vscode.ChatResult {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    stream.markdown('No active squad. Use `/switch` to pick one, or create a squad first.');
    stream.button({ command: 'squad.createSquad', title: 'Create Squad' });
    return {};
  }

  const agents = [...ctx.agents.values()];
  stream.markdown(`## $(organization) ${ctx.squadName}\n\n`);
  stream.markdown(`**Agents:** ${agents.length}  \n`);
  stream.markdown(`**Health:** ${ctx.statistics.healthScore}/100  \n`);
  stream.markdown(`**Tasks:** ${ctx.statistics.completedTasks}/${ctx.statistics.totalTasks}  \n\n`);

  if (agents.length > 0) {
    stream.markdown('| Agent | Role | Status |\n|-------|------|--------|\n');
    for (const a of agents) {
      const statusIcon = a.status === 'active' ? '$(check)' : a.status === 'error' ? '$(error)' : '$(circle-outline)';
      stream.markdown(`| ${a.emoji} ${a.name} | ${a.role} | ${statusIcon} ${a.status} |\n`);
    }
  }

  stream.button({ command: 'squad.openDashboard', title: 'Open Dashboard' });
  return {};
}

export async function handleSwitch(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
  const squads = squadRegistry.allContexts;
  if (squads.length === 0) {
    stream.markdown('No squads found in the workspace.');
    stream.button({ command: 'squad.createSquad', title: 'Create Squad' });
    return {};
  }

  const query = request.prompt.trim().toLowerCase();

  if (query) {
    const result = matchSquadByQuery(squads, query);

    if (result.kind === 'exact' || result.kind === 'partial-single') {
      squadRegistry.setActiveSquad(result.match.squadDir);
      stream.markdown(`Switched to **${result.match.squadName}**`);
      stream.button({ command: 'squad.openDashboard', title: 'Open Dashboard' });
      return {};
    }

    if (result.kind === 'ambiguous') {
      stream.markdown(`Multiple squads match "${query}":\n\n`);
      for (const s of result.matches) {
        stream.markdown(`- **${s.squadName}**\n`);
      }
      stream.markdown('\nBe more specific or use the picker:');
      stream.button({ command: 'squad.switchSquad', title: 'Switch Squad' });
      return {};
    }

    stream.markdown(`No squad matching "${query}". Available squads:\n\n`);
    for (const s of squads) {
      stream.markdown(`- **${s.squadName}**\n`);
    }
    return {};
  }

  // No query — list available squads
  stream.markdown('Available squads:\n\n');
  const active = squadRegistry.activeContext;
  for (const s of squads) {
    const marker = active && s.squadDir === active.squadDir ? ' $(check) *active*' : '';
    stream.markdown(`- **${s.squadName}**${marker}\n`);
  }
  stream.button({ command: 'squad.switchSquad', title: 'Switch Squad' });
  return {};
}

export async function handleAssign(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    stream.markdown('No active squad. Switch to one first.');
    stream.button({ command: 'squad.switchSquad', title: 'Switch Squad' });
    return {};
  }

  const agents = [...ctx.agents.keys()];
  if (agents.length === 0) {
    stream.markdown('No agents in the active squad.');
    stream.button({ command: 'squad.addMember', title: 'Add Member' });
    return {};
  }

  const prompt = request.prompt.trim();
  if (!prompt) {
    stream.markdown('Usage: `@squad /assign <task description>` — assigns to the whole squad\n\n');
    stream.markdown('Or: `@squad /assign @agentName <task description>` — assigns to a specific agent');
    return {};
  }

  // Check if an @agent is specified
  const mention = parseAssignMention(prompt);
  if (mention) {
    const { agentName: targetName, task } = mention;
    const found = agents.find(a => a.toLowerCase() === targetName.toLowerCase());
    if (!found) {
      stream.markdown(`Agent **${targetName}** not found. Available agents:\n\n`);
      for (const a of agents) {
        stream.markdown(`- ${a}\n`);
      }
      return {};
    }
    const item = commandQueueManager.enqueue(found, task);
    stream.markdown(`$(check) Task assigned to **${found}**: *${task}*\n\nQueue ID: \`${item.id}\``);
    stream.markdown('\n\n$(sync~spin) Sending to Copilot...');
    
    // Execute via Copilot
    copilotExecutor.executeTask(found, task, item.id).catch(err => {
      log('Failed to execute task via Copilot:', err);
    });
    
    return {};
  }

  // No @agent — assign to whole squad
  const items = agents.map(a => commandQueueManager.enqueue(a, prompt));
  stream.markdown(`$(check) Task assigned to all **${items.length}** agents: *${prompt}*`);
  stream.markdown('\n\n$(sync~spin) Sending to Copilot...');
  
  // Execute via Copilot (squad task)
  copilotExecutor.executeSquadTask(prompt, items.map(i => i.id)).catch(err => {
    log('Failed to execute squad task via Copilot:', err);
  });
  
  return {};
}

export function handleRoster(stream: vscode.ChatResponseStream): vscode.ChatResult {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    stream.markdown('No active squad.');
    stream.button({ command: 'squad.createSquad', title: 'Create Squad' });
    return {};
  }

  const agents = [...ctx.agents.values()];
  if (agents.length === 0) {
    stream.markdown(`**${ctx.squadName}** has no members yet.`);
    stream.button({ command: 'squad.addMember', title: 'Add Member' });
    return {};
  }

  stream.markdown(`## $(organization) ${ctx.squadName} — Roster\n\n`);
  for (const a of agents) {
    stream.markdown(`### ${a.emoji} ${a.name}\n`);
    stream.markdown(`**Role:** ${a.role}  \n`);
    stream.markdown(`**Status:** ${a.status}  \n`);
    if (a.charter) {
      stream.markdown(`**Charter:** ${a.charter}  \n`);
    }
    if (a.currentTask) {
      stream.markdown(`**Current Task:** ${a.currentTask}  \n`);
    }
    stream.markdown('\n');
  }

  stream.button({ command: 'squad.openDashboard', title: 'Open Dashboard' });
  return {};
}

export function handleAgents(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    stream.markdown('No active squad.');
    stream.button({ command: 'squad.createSquad', title: 'Create Squad' });
    return {};
  }

  const agents = [...ctx.agents.entries()];
  if (agents.length === 0) {
    stream.markdown(`**${ctx.squadName}** has no agents yet.`);
    stream.button({ command: 'squad.addMember', title: 'Add Member' });
    return {};
  }

  const query = request.prompt.trim().toLowerCase();

  // If a specific agent name was given, show detail for that agent
  if (query) {
    const match = findAgentByQuery(agents, query);
    if (match) {
      const [name, a] = match;
      stream.markdown(`## ${a.emoji} ${a.name}\n\n`);
      stream.markdown(`**Role:** ${a.role}  \n`);
      stream.markdown(`**Status:** ${a.status}  \n`);
      if (a.charter) {
        stream.markdown(`**Charter:** ${a.charter}  \n`);
      }
      if (a.currentTask) {
        stream.markdown(`**Current Task:** ${a.currentTask}  \n`);
      }
      stream.markdown(`\n**Stats:** ${a.statistics.completedTasks} completed, ${a.statistics.failedTasks} failed  \n`);

      const pending = commandQueueManager.getQueueForAgent(name).filter(i => i.status === 'queued' || i.status === 'running');
      if (pending.length > 0) {
        stream.markdown(`\n**Pending tasks (${pending.length}):**\n`);
        for (const item of pending) {
          stream.markdown(`- \`${item.id}\` ${item.command} *(${item.status})*\n`);
        }
      }

      stream.button({ command: 'squad.openAgentDetail', title: 'Open Detail', arguments: [name] });
      stream.button({ command: 'squad.editCharter', title: 'Edit Charter', arguments: [name] });
      return {};
    }

    stream.markdown(`No agent matching "${query}". Available agents:\n\n`);
    for (const [name, a] of agents) {
      stream.markdown(`- ${a.emoji} **${name}** — ${a.role}\n`);
    }
    return {};
  }

  // No query — list all agents as a pick-list
  stream.markdown(`## $(organization) ${ctx.squadName} — Agents\n\n`);
  for (const [name, a] of agents) {
    const statusIcon = a.status === 'active' ? '$(check)' : a.status === 'error' ? '$(error)' : a.status === 'working' ? '$(loading~spin)' : '$(circle-outline)';
    stream.markdown(`### ${a.emoji} ${name}\n`);
    stream.markdown(`${a.role} — ${statusIcon} ${a.status}\n\n`);
    stream.button({ command: 'squad.openAgentDetail', title: `Open ${name}`, arguments: [name] });
  }

  stream.markdown('\n---\nTip: Use `@squad /agents <name>` to see details for a specific agent.');
  return {};
}

/**
 * Handle /complete — Copilot signals task completion
 * Usage: @squad /complete @AgentName [success|failure] [summary]
 */
export function handleComplete(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    stream.markdown('No active squad.');
    return {};
  }

  const prompt = request.prompt.trim();
  // Parse: @AgentName success|failure summary
  const parsed = parseCompleteArgs(prompt);

  if (!parsed) {
    stream.markdown('Usage: `@squad /complete @AgentName success|failure [summary]`\n\n');
    stream.markdown('Example: `@squad /complete @Backend success Implemented user authentication`');
    return {};
  }

  const { agentName, isSuccess, summary } = parsed;
  
  // Find the agent
  const agent = ctx.agents.get(agentName);
  if (!agent) {
    const agents = [...ctx.agents.keys()];
    stream.markdown(`Agent **${agentName}** not found. Available: ${agents.join(', ')}`);
    return {};
  }

  // Find running queue item for this agent
  const runningItems = commandQueueManager.getQueueForAgent(agentName)
    .filter(i => i.status === 'running');
  
  // Mark queue items as completed/failed
  for (const item of runningItems) {
    if (isSuccess) {
      commandQueueManager.markCompleted(item.id, summary || 'Completed');
    } else {
      commandQueueManager.markFailed(item.id, summary || 'Failed');
    }
  }

  // Update agent status to idle
  eventBus.emit('agent-status', { agentName, status: 'idle' });

  // Log the completion
  logStore.addEntry({
    agentName,
    level: isSuccess ? 'info' : 'error',
    message: summary || (isSuccess ? 'Task completed' : 'Task failed'),
    timestamp: Date.now(),
  });

  const icon = isSuccess ? '$(check)' : '$(error)';
  stream.markdown(`${icon} **${agentName}** task ${isSuccess ? 'completed' : 'failed'}`);
  if (summary) {
    stream.markdown(`\n\n> ${summary}`);
  }
  if (runningItems.length > 0) {
    stream.markdown(`\n\nMarked ${runningItems.length} queue item(s) as ${isSuccess ? 'completed' : 'failed'}.`);
  }

  return {};
}

/**
 * Handle /progress — Copilot reports progress during task execution
 * Usage: @squad /progress @AgentName message
 */
export function handleProgress(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    stream.markdown('No active squad.');
    return {};
  }

  const prompt = request.prompt.trim();
  const parsed = parseProgressArgs(prompt);

  if (!parsed) {
    stream.markdown('Usage: `@squad /progress @AgentName <progress message>`\n\n');
    stream.markdown('Example: `@squad /progress @Backend Setting up database connection...`');
    return {};
  }

  const { agentName, message } = parsed;
  
  // Verify agent exists
  const agent = ctx.agents.get(agentName);
  if (!agent) {
    const agents = [...ctx.agents.keys()];
    stream.markdown(`Agent **${agentName}** not found. Available: ${agents.join(', ')}`);
    return {};
  }

  // Log the progress
  logStore.addEntry({
    agentName,
    level: 'info',
    message: message,
    timestamp: Date.now(),
  });

  stream.markdown(`$(sync~spin) **${agentName}**: ${message}`);
  return {};
}

export function handleDefault(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const ctx = squadRegistry.activeContext;
  const squadInfo = ctx ? `Active squad: **${ctx.squadName}** (${[...ctx.agents.keys()].length} agents)` : 'No active squad';

  stream.markdown(`## $(organization) Squad Chat\n\n${squadInfo}\n\n`);
  stream.markdown('**Commands:**\n\n');
  stream.markdown('- `/status` — Show squad status and agents\n');
  stream.markdown('- `/switch [name]` — Switch active squad\n');
  stream.markdown('- `/assign [task]` — Assign task to all agents\n');
  stream.markdown('- `/assign @agent [task]` — Assign task to specific agent\n');
  stream.markdown('- `/roster` — Show detailed roster\n');
  stream.markdown('- `/agents [name]` — List agents or view a specific agent\n');
  stream.markdown('- `/complete @agent success|failure [summary]` — Signal task done\n');
  stream.markdown('- `/progress @agent [message]` — Report progress\n');

  if (!ctx) {
    stream.button({ command: 'squad.createSquad', title: 'Create Squad' });
  }
  return {};
}
