import * as vscode from 'vscode';
import { getNonce, getWebviewUri, getWebviewOptions } from './webviewBridge';
import { squadRegistry } from '../core/squadRegistry';
import { eventBus, type SquadEvents } from '../core/eventBus';
import { logStore } from '../monitoring/logStore';
import { logError } from '../utils/logger';
import { commandQueueManager } from '../monitoring/commandQueue';
import { copilotExecutor } from '../monitoring/copilotExecutor';
import { statsEngine } from '../monitoring/statsEngine';
import type {
  DashboardState,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../core/types';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'squadDashboard',
      'Squad Dashboard',
      column,
      getWebviewOptions(extensionUri),
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
    return DashboardPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => this.handleWebviewMessage(msg),
      null,
      this.disposables,
    );

    this.setupEventListeners();
    this.updateHtml();
  }

  private async updateHtml(): Promise<void> {
    this.panel.webview.html = await this.getHtmlContent(this.panel.webview);
  }

  private async getHtmlContent(webview: vscode.Webview): Promise<string> {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard', 'dashboard.html');
    const htmlBytes = await vscode.workspace.fs.readFile(htmlPath);
    let html = Buffer.from(htmlBytes).toString('utf-8');

    const nonce = getNonce();
    const cspSource = webview.cspSource;
    const cssUri = getWebviewUri(webview, this.extensionUri, ['media', 'dashboard', 'dashboard.css']);
    const themeUri = getWebviewUri(webview, this.extensionUri, ['media', 'shared', 'theme.css']);
    const resetUri = getWebviewUri(webview, this.extensionUri, ['media', 'shared', 'reset.css']);
    const scriptUri = getWebviewUri(webview, this.extensionUri, ['media', 'dashboard', 'dashboard.js']);

    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, cspSource);
    html = html.replace(/\{\{cssUri\}\}/g, cssUri.toString());
    html = html.replace(/\{\{themeUri\}\}/g, themeUri.toString());
    html = html.replace(/\{\{resetUri\}\}/g, resetUri.toString());
    html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  private sendStateUpdate(): void {
    const ctx = squadRegistry.activeContext;
    if (!ctx) {
      return;
    }

    const agents = [...ctx.agents.values()];
    const state: DashboardState = {
      squadName: ctx.teamState.projectContext?.description ?? ctx.squadName,
      squadPath: ctx.squadDir,
      agents,
      logs: logStore.getEntries(),
      commandQueue: commandQueueManager.getQueue(),
      statistics: statsEngine.getSquadStats(agents),
    };

    const message: HostToWebviewMessage = { type: 'state-update', data: state };
    this.panel.webview.postMessage(message);
  }

  private handleWebviewMessage(message: WebviewToHostMessage): void {
    switch (message.type) {
      case 'ready':
        this.sendStateUpdate();
        break;
      case 'request-state':
        this.sendStateUpdate();
        break;
      case 'run-command': {
        const args = message.args ?? [];
        vscode.commands.executeCommand(message.command, ...args);
        break;
      }
      case 'filter-logs': {
        const filtered = logStore.getEntries({
          agent: message.agent,
          level: message.level,
        });
        const logMsg: HostToWebviewMessage = {
          type: 'state-update',
          data: {
            squadName: squadRegistry.activeContext?.teamState.projectContext?.description ?? squadRegistry.activeContext?.squadName ?? 'Squad',
            squadPath: squadRegistry.activeContext?.squadDir ?? '',
            agents: [...(squadRegistry.activeContext?.agents.values() ?? [])],
            logs: filtered,
            commandQueue: commandQueueManager.getQueue(),
            statistics: statsEngine.getSquadStats(
              [...(squadRegistry.activeContext?.agents.values() ?? [])],
            ),
          },
        };
        this.panel.webview.postMessage(logMsg);
        break;
      }
      case 'select-agent': {
        vscode.commands.executeCommand('squad.openAgentDetail', message.name);
        break;
      }
      case 'clear-logs':
        logStore.clear();
        this.sendStateUpdate();
        break;
      case 'enqueue-command': {
        if ('agent' in message && 'command' in message) {
          const item = commandQueueManager.enqueue(message.agent, message.command);
          // Mirror the command-palette flow (enqueueCommand.ts): enqueueing
          // alone only records the item — it must also be dispatched to
          // Copilot, otherwise it sits at "queued" forever with no log
          // output, which is exactly the "Send does nothing" symptom.
          copilotExecutor.executeTask(message.agent, message.command, item.id).catch((error) => {
            logError(`Dashboard enqueue-command execution failed for ${message.agent}`, error);
          });
        }
        break;
      }
      case 'agent-selected':
        // Selection tracking only — no action needed on host
        break;
      case 'mark-queue-complete': {
        if (message.success) {
          commandQueueManager.markCompleted(message.id, message.result);
        } else {
          commandQueueManager.markFailed(message.id, message.result);
        }
        // Update agent status to idle
        const item = commandQueueManager.getQueue().find((i) => i.id === message.id);
        if (item) {
          eventBus.emit('agent-status', { agentName: item.agentName, status: 'idle' });
        }
        this.sendStateUpdate();
        break;
      }
      case 'mark-all-running-complete': {
        const running = commandQueueManager.getPending();
        const affectedAgents = new Set<string>();
        for (const item of running) {
          commandQueueManager.markCompleted(item.id, 'Marked complete by user');
          affectedAgents.add(item.agentName);
        }
        // Update all affected agents to idle
        for (const agentName of affectedAgents) {
          eventBus.emit('agent-status', { agentName, status: 'idle' });
        }
        this.sendStateUpdate();
        break;
      }
    }
  }

  private setupEventListeners(): void {
    const onLogEntry = (data: SquadEvents['log-entry']) => {
      const msg: HostToWebviewMessage = { type: 'log-entry', entry: data.entry };
      this.panel.webview.postMessage(msg);
    };

    const onAgentStatus = (data: SquadEvents['agent-status']) => {
      const msg: HostToWebviewMessage = { type: 'agent-status', name: data.agentName, status: data.status };
      this.panel.webview.postMessage(msg);
    };

    const onStatsUpdated = (_data: SquadEvents['stats-updated']) => {
      const ctx = squadRegistry.activeContext;
      if (ctx) {
        const agents = [...ctx.agents.values()];
        const msg: HostToWebviewMessage = { type: 'stats-update', stats: statsEngine.getSquadStats(agents) };
        this.panel.webview.postMessage(msg);
      }
    };

    const onCommandQueued = (data: SquadEvents['command-queued']) => {
      const msg: HostToWebviewMessage = { type: 'command-update', item: data.item };
      this.panel.webview.postMessage(msg);
    };

    const onCommandCompleted = (data: SquadEvents['command-completed']) => {
      const item = commandQueueManager.getQueue().find((queueItem) => queueItem.id === data.id);
      if (item) {
        const msg: HostToWebviewMessage = { type: 'command-update', item };
        this.panel.webview.postMessage(msg);
      }
    };

    const onTeamChanged = (_data: SquadEvents['team-changed']) => {
      this.sendStateUpdate();
    };

    eventBus.on('log-entry', onLogEntry);
    eventBus.on('agent-status', onAgentStatus);
    eventBus.on('stats-updated', onStatsUpdated);
    eventBus.on('command-queued', onCommandQueued);
    eventBus.on('command-completed', onCommandCompleted);
    eventBus.on('team-changed', onTeamChanged);

    const themeDisposable = vscode.window.onDidChangeActiveColorTheme((theme) => {
      const kind = theme.kind === vscode.ColorThemeKind.Light
        ? 'light'
        : theme.kind === vscode.ColorThemeKind.HighContrast || theme.kind === vscode.ColorThemeKind.HighContrastLight
          ? 'highContrast'
          : 'dark';
      const msg: HostToWebviewMessage = { type: 'theme-changed', kind };
      this.panel.webview.postMessage(msg);
    });

    this.disposables.push(
      themeDisposable,
      { dispose: () => eventBus.off('log-entry', onLogEntry) },
      { dispose: () => eventBus.off('agent-status', onAgentStatus) },
      { dispose: () => eventBus.off('stats-updated', onStatsUpdated) },
      { dispose: () => eventBus.off('command-queued', onCommandQueued) },
      { dispose: () => eventBus.off('command-completed', onCommandCompleted) },
      { dispose: () => eventBus.off('team-changed', onTeamChanged) },
    );
  }

  public dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
