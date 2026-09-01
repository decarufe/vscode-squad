import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { squadRegistry } from '../core/squadRegistry';

/** Squad-owned entries inside a flat `.squad/` directory. */
const FLAT_SQUAD_ENTRIES = [
  'team.md',
  'decisions.md',
  'ceremonies.md',
  'routing.md',
  'decisions',
  'agents',
  'casting',
  'log',
  'orchestration-log',
  'skills',
  'ceremonies',
];

export async function handleDeleteSquad(): Promise<void> {
  const all = squadRegistry.allContexts;
  if (all.length === 0) {
    vscode.window.showWarningMessage('No squads registered');
    return;
  }

  const items = all.map((ctx) => ({
    label: ctx.squadName,
    description: ctx.squadDir,
    squadDir: ctx.squadDir,
    layout: ctx.layout,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select squad to delete',
  });

  if (!selected) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete squad "${selected.label}" at ${selected.squadDir}? This cannot be undone.`,
    { modal: true },
    'Delete',
  );

  if (confirm !== 'Delete') {
    return;
  }

  squadRegistry.unregisterSquad(selected.squadDir);

  if (fs.existsSync(selected.squadDir)) {
    if (selected.layout === 'flat') {
      // A flat squad lives in `.squad/` itself, which may also host nested
      // squads under `.squad/squads/` — remove only this squad's own files.
      for (const entry of FLAT_SQUAD_ENTRIES) {
        const target = path.join(selected.squadDir, entry);
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
        }
      }
      const remaining = fs.readdirSync(selected.squadDir);
      if (remaining.length === 0) {
        fs.rmSync(selected.squadDir, { recursive: true, force: true });
      }
    } else {
      fs.rmSync(selected.squadDir, { recursive: true, force: true });
    }
  }

  vscode.window.showInformationMessage(`Squad: Deleted "${selected.label}"`);
}
