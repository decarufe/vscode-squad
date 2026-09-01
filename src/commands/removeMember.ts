import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../utils/logger';
import { TeamRosterProvider } from '../views/rosterTreeProvider';
import { squadRegistry } from '../core/squadRegistry';

export async function handleRemoveMember(
  context: vscode.ExtensionContext,
  rosterProvider?: TeamRosterProvider
): Promise<void> {
  log('Command: squad.removeMember called');
  const ctx = squadRegistry.activeContext;
  if (!ctx) {
    vscode.window.showWarningMessage('No active squad');
    return;
  }

  const allNames = [...ctx.agents.keys()];
  if (allNames.length === 0) {
    vscode.window.showWarningMessage('No members to remove');
    return;
  }

  const memberName = await vscode.window.showQuickPick(allNames, {
    placeHolder: 'Select member to remove',
  });
  if (!memberName) { return; }

  const confirm = await vscode.window.showWarningMessage(
    `Remove ${memberName} from team? Agent files will be moved to _alumni/.`,
    { modal: true },
    'Remove'
  );

  if (confirm === 'Remove') {
    // Move agent directory to alumni
    const slug = memberName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const agentDir = path.join(ctx.squadDir, 'agents', slug);
    const alumniDir = path.join(ctx.squadDir, 'agents', '_alumni');
    const alumniTarget = path.join(alumniDir, slug);

    if (fs.existsSync(agentDir)) {
      fs.mkdirSync(alumniDir, { recursive: true });
      if (fs.existsSync(alumniTarget)) {
        // If alumni already exists, append timestamp to avoid collision
        const timestamped = `${slug}-${Date.now()}`;
        fs.renameSync(agentDir, path.join(alumniDir, timestamped));
      } else {
        fs.renameSync(agentDir, alumniTarget);
      }
    }

    const state = { ...ctx.teamState };
    if (state.coordinator?.name === memberName) { state.coordinator = null; }
    else if (state.codingAgent?.name === memberName) { state.codingAgent = null; }
    else { state.members = state.members.filter(m => m.name !== memberName); }

    await squadRegistry.applyTeamState(ctx.squadDir, state);
    vscode.window.showInformationMessage(`Squad: Moved ${memberName} to alumni`);
  }
}
