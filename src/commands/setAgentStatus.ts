import * as vscode from 'vscode';
import { squadRegistry } from '../core/squadRegistry';
import { eventBus } from '../core/eventBus';
import type { AgentStatus } from '../core/types';

export async function handleSetAgentStatus(): Promise<void> {
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    vscode.window.showWarningMessage('No active squad');
    return;
  }

  const names = [...ctx.agents.keys()];
  if (names.length === 0) {
    vscode.window.showWarningMessage('No agents in squad');
    return;
  }

  const name = await vscode.window.showQuickPick(names, {
    placeHolder: 'Select agent',
  });
  if (!name) { return; }

  const statuses: { label: string; value: AgentStatus }[] = [
    { label: '$(circle-filled) Active', value: 'active' },
    { label: '$(tools) Working', value: 'working' },
    { label: '$(clock) Idle', value: 'idle' },
    { label: '$(error) Error', value: 'error' },
    { label: '$(circle-slash) Offline', value: 'offline' },
  ];

  const pick = await vscode.window.showQuickPick(
    statuses.map(s => ({ label: s.label, value: s.value })),
    { placeHolder: `Set status for ${name}` }
  );
  if (!pick) { return; }

  // Broadcasting the event is enough: squadRegistry listens for
  // `agent-status` and updates the runtime status/lastActivity for this
  // agent in every context that has it, keeping the sidebar roster (and
  // any other listener) in sync from a single source of truth.
  eventBus.emit('agent-status', { agentName: name, status: pick.value });
  vscode.window.showInformationMessage(`${name} is now ${pick.value}`);
}
