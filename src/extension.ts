import * as vscode from 'vscode';
import { log } from './utils/logger';
import { squadRegistry } from './core/squadRegistry';
import { eventBus } from './core/eventBus';
import { TeamRosterProvider } from './views/rosterTreeProvider';
import { SquadSelectorProvider } from './views/squadSelectorProvider';
import { ActivityProvider } from './views/activityProvider';
import { registerCommands } from './commands/index';
import { registerChatParticipant } from './chat/squadChatParticipant';
import { commandQueueManager } from './monitoring/commandQueue';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Squad');
  log('VS Code Squad extension v2 activated');

  // Scan workspace folders for squads
  await squadRegistry.scanWorkspaceFolders();

  // Create tree view providers
  const selectorProvider = new SquadSelectorProvider();
  const rosterProvider = new TeamRosterProvider();
  const activityProvider = new ActivityProvider();

  // Register tree views
  const selectorView = vscode.window.createTreeView('squad.squadSelector', {
    treeDataProvider: selectorProvider,
  });
  const rosterView = vscode.window.createTreeView('squad.rosterView', {
    treeDataProvider: rosterProvider,
  });
  const activityView = vscode.window.createTreeView('squad.activityView', {
    treeDataProvider: activityProvider,
  });

  // Status bar items
  const squadNameItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  squadNameItem.command = 'squad.switchSquad';
  const healthItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  healthItem.command = 'squad.openDashboard';
  const actionsItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );
  actionsItem.text = '$(zap) Agent';
  actionsItem.tooltip = 'Squad: Agent Actions';
  actionsItem.command = 'squad.agentActions';
  updateStatusBar(squadNameItem, healthItem, actionsItem);

  // Event listeners
  eventBus.on('team-changed', () => {
    rosterProvider.refresh();
    selectorProvider.refresh();
    updateStatusBar(squadNameItem, healthItem, actionsItem);
  });
  eventBus.on('squad-activated', () => {
    rosterProvider.refresh();
    selectorProvider.refresh();
    updateStatusBar(squadNameItem, healthItem, actionsItem);
  });
  eventBus.on('log-entry', () => {
    activityProvider.refresh();
  });
  eventBus.on('stats-updated', () => {
    updateStatusBar(squadNameItem, healthItem, actionsItem);
  });

  // Workspace folder changes
  const folderWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
    async (e) => {
      for (const added of e.added) {
        await squadRegistry.scanWorkspaceFolder(added.uri.fsPath);
      }
      for (const removed of e.removed) {
        squadRegistry.unregisterFolder(removed.uri.fsPath);
      }
      selectorProvider.refresh();
      rosterProvider.refresh();
    },
  );

  // Register all commands
  const commandDisposables = registerCommands(context, rosterProvider);

  // Auto-open dashboard if configured
  const autoOpen = vscode.workspace
    .getConfiguration('squad')
    .get<boolean>('autoOpenDashboard', false);
  if (autoOpen && squadRegistry.activeContext) {
    vscode.commands.executeCommand('squad.openDashboard');
  }

  // First-run: open walkthrough
  const hasSeenWalkthrough = context.globalState.get<boolean>('squad.hasShownWalkthrough', false);
  if (!hasSeenWalkthrough) {
    context.globalState.update('squad.hasShownWalkthrough', true);
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      'squad.squad#squad.gettingStarted',
      false,
    );
  }

  // Push all disposables
  context.subscriptions.push(
    outputChannel,
    selectorView,
    rosterView,
    activityView,
    squadNameItem,
    healthItem,
    actionsItem,
    folderWatcher,
    ...commandDisposables,
    registerChatParticipant(context),
    {
      dispose: () => {
        squadRegistry.dispose();
        eventBus.dispose();
        commandQueueManager.dispose();
      },
    },
  );
}

function updateStatusBar(
  nameItem: vscode.StatusBarItem,
  healthItem: vscode.StatusBarItem,
  actionsItem: vscode.StatusBarItem,
): void {
  const ctx = squadRegistry.activeContext;
  if (ctx) {
    nameItem.text = `$(people) ${ctx.teamState.projectContext?.description ?? 'Squad'}`;
    nameItem.show();
    const score = ctx.statistics.healthScore;
    const emoji =
      score >= 80 ? '$(pass)' : score >= 50 ? '$(warning)' : '$(error)';
    healthItem.text = `${emoji} ${score}`;
    healthItem.tooltip = `Squad Health Score: ${score}/100`;
    healthItem.show();
    actionsItem.show();
  } else {
    nameItem.hide();
    healthItem.hide();
    actionsItem.hide();
  }
}

export function deactivate() {
  log('VS Code Squad extension deactivated');
}
