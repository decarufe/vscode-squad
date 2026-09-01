import * as vscode from 'vscode';
import { squadRegistry, SquadContext } from '../core/squadRegistry';

export class SquadSelectorProvider implements vscode.TreeDataProvider<SquadSelectorItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SquadSelectorItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SquadSelectorItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SquadSelectorItem): SquadSelectorItem[] {
    if (element) {
      return [];
    }

    const activePath = squadRegistry.activeSquadPath;
    return squadRegistry.allContexts.map((ctx) => {
      const isActive = ctx.squadDir === activePath;
      return createSquadItem(ctx, isActive);
    });
  }
}

function deriveLabel(ctx: SquadContext, isActive: boolean): string {
  const description = ctx.teamState.projectContext?.description;
  const name = description ?? ctx.squadName;
  return isActive ? `★ ${name}` : name;
}

function createSquadItem(ctx: SquadContext, isActive: boolean): SquadSelectorItem {
  const label = deriveLabel(ctx, isActive);
  const agentCount = ctx.agents.size;
  const qualifier = label.endsWith(ctx.squadName) ? undefined : ctx.squadName;
  return new SquadSelectorItem(label, ctx.squadDir, isActive, agentCount, qualifier);
}

export class SquadSelectorItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly squadPath: string,
    public readonly isActive: boolean,
    agentCount: number,
    qualifier?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    const parts = [`${agentCount} agents`];
    if (isActive) {
      parts.unshift('(active)');
    }
    if (qualifier) {
      parts.push(qualifier);
    }
    this.description = parts.join(' · ');
    this.tooltip = squadPath;
    this.contextValue = isActive ? 'activeSquad' : 'squad';
    this.command = {
      command: 'squad.switchSquad',
      title: 'Switch Squad',
      arguments: [squadPath],
    };
    this.iconPath = isActive
      ? new vscode.ThemeIcon('star-full')
      : new vscode.ThemeIcon('folder');
  }
}
