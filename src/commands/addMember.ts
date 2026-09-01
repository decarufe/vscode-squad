import * as vscode from 'vscode';
import { log } from '../utils/logger';
import { TeamRosterProvider } from '../views/rosterTreeProvider';
import { squadRegistry } from '../core/squadRegistry';
import { Member, scaffoldAgentDir } from '../team/teamState';

export async function handleAddMember(
  context: vscode.ExtensionContext,
  rosterProvider?: TeamRosterProvider
): Promise<void> {
  log('Command: squad.addMember called');
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    vscode.window.showWarningMessage('No active squad. Create one first.');
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Enter member name',
    placeHolder: 'e.g., Alice',
  });
  if (!name) { return; }

  const roleOptions = [
    'Coordinator', 'Backend Dev', 'Frontend Dev', 'Full-Stack Dev',
    'Tester', 'Designer', 'Architect', 'Security Agent',
    'Session Logger', 'Work Monitor',
    'Coding Agent', 'DevOps Agent', 'Custom...'
  ];
  const rolePick = await vscode.window.showQuickPick(roleOptions, {
    placeHolder: 'Select member role',
  });
  if (!rolePick) { return; }

  let role = rolePick;
  if (rolePick === 'Custom...') {
    const custom = await vscode.window.showInputBox({ prompt: 'Enter custom role' });
    if (!custom) { return; }
    role = custom;
  }

  const member: Member = {
    name,
    role,
    section: role.toLowerCase().includes('coordinator') ? 'coordinator'
           : (name.toLowerCase().includes('@copilot') || role.toLowerCase().includes('coding agent')) ? 'codingAgent'
           : 'members',
  };

  const state = { ...ctx.teamState };
  switch (member.section) {
    case 'coordinator': state.coordinator = member; break;
    case 'codingAgent': state.codingAgent = member; break;
    default: state.members = [...state.members, member]; break;
  }

  await squadRegistry.applyTeamState(ctx.squadDir, state);
  scaffoldAgentDir(ctx.squadDir, name, role);
  vscode.window.showInformationMessage(`Squad: Added ${name} as ${role}`);
}
