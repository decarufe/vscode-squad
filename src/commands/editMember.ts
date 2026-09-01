import * as vscode from 'vscode';
import { log } from '../utils/logger';
import { TeamRosterProvider } from '../views/rosterTreeProvider';
import { squadRegistry } from '../core/squadRegistry';

export async function handleEditMember(
  context: vscode.ExtensionContext,
  rosterProvider?: TeamRosterProvider
): Promise<void> {
  log('Command: squad.editMember called');
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    vscode.window.showWarningMessage('No active squad');
    return;
  }

  const allNames = [...ctx.agents.keys()];
  if (allNames.length === 0) {
    vscode.window.showWarningMessage('No members to edit');
    return;
  }

  const memberName = await vscode.window.showQuickPick(allNames, {
    placeHolder: 'Select member to edit',
  });
  if (!memberName) { return; }

  const field = await vscode.window.showQuickPick(['Role', 'Charter', 'Status', 'Notes'], {
    placeHolder: 'What do you want to edit?',
  });
  if (!field) { return; }

  const newValue = await vscode.window.showInputBox({
    prompt: `Enter new ${field.toLowerCase()}`,
    placeHolder: field === 'Role' ? 'e.g., Frontend Dev' : undefined,
  });
  if (newValue === undefined) { return; }

  const state = { ...ctx.teamState };
  const findAndUpdate = (name: string) => {
    const allMembers = [
      state.coordinator, ...state.members, state.codingAgent
    ].filter(Boolean);
    const m = allMembers.find(m => m!.name === name);
    if (m) {
      const key = field.toLowerCase() as 'role' | 'charter' | 'status' | 'notes';
      (m as unknown as Record<string, unknown>)[key] = newValue || undefined;
    }
  };
  findAndUpdate(memberName);

  await squadRegistry.applyTeamState(ctx.squadDir, state);
  vscode.window.showInformationMessage(`Squad: Updated ${memberName}'s ${field.toLowerCase()}`);
}
