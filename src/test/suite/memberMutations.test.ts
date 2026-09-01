import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { squadRegistry } from '../../core/squadRegistry';
import { readTeamState } from '../../team/teamState';
import { TeamRosterProvider, RosterItem } from '../../views/rosterTreeProvider';
import { handleAddMember } from '../../commands/addMember';
import { handleEditMember } from '../../commands/editMember';
import { handleRemoveMember } from '../../commands/removeMember';

/**
 * #17 — add/edit/remove member coverage:
 *   - mutations update the active in-memory context (`squadRegistry.activeContext`)
 *   - mutations persist to disk (`team.md`, re-readable via `readTeamState`)
 *   - mutations are reflected in views (`TeamRosterProvider`)
 *   - removing a member archives its agent directory under `agents/_alumni/`
 *
 * These commands are interactive (`vscode.window.showInputBox` /
 * `showQuickPick` / `showWarningMessage`), so each test stubs the exact
 * `vscode.window` entry points the handler under test calls, in call order,
 * then restores the originals in `teardown`. `context` is accepted but never
 * read by any of the three handlers, so a stub object is enough.
 */

const FAKE_CONTEXT = {} as vscode.ExtensionContext;

const TEAM_MD = `# Test Squad

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work |

## Members

| Name | Role | Charter | Status | Notes |
|------|------|---------|--------|-------|
| Neo | Lead / Architect | \`.squad/agents/neo/charter.md\` | ✅ Active | |
| Trinity | Frontend Dev | \`.squad/agents/trinity/charter.md\` | ✅ Active | |

## Coding Agent

| Name | Role | Charter | Status |
|------|------|---------|--------|
| @copilot | Coding Agent | — | 🤖 Coding Agent |
`;

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'squad-member-mutations-test-'));
}

/** Queue-based stub: each call returns the next queued value (or the last one, repeated, once exhausted). */
function queue<T>(values: T[]): () => Promise<T> {
  let i = 0;
  return async () => (i < values.length ? values[i++] : values[values.length - 1]);
}

interface WindowStubs {
  showInputBox?: unknown[];
  showQuickPick?: unknown[];
  showWarningMessage?: unknown[];
}

function stubWindow(stubs: WindowStubs): () => void {
  const originals: Record<string, unknown> = {};
  const win = vscode.window as unknown as Record<string, unknown>;

  if (stubs.showInputBox) {
    originals.showInputBox = win.showInputBox;
    win.showInputBox = queue(stubs.showInputBox);
  }
  if (stubs.showQuickPick) {
    originals.showQuickPick = win.showQuickPick;
    win.showQuickPick = queue(stubs.showQuickPick);
  }
  if (stubs.showWarningMessage) {
    originals.showWarningMessage = win.showWarningMessage;
    win.showWarningMessage = queue(stubs.showWarningMessage);
  }

  return () => {
    for (const key of Object.keys(originals)) {
      win[key] = originals[key];
    }
  };
}

function membersSectionItems(rosterProvider: TeamRosterProvider): RosterItem[] {
  const sections = rosterProvider.getChildren();
  const membersSection = sections.find((s) => s.label === 'Members');
  assert.ok(membersSection, 'Members section should exist in the roster tree');
  return rosterProvider.getChildren(membersSection);
}

suite('member mutations — add / edit / remove (#17)', () => {
  let tmpRoot: string;
  let squadDir: string;
  let restoreWindow: (() => void) | undefined;
  let rosterProvider: TeamRosterProvider;

  setup(async () => {
    tmpRoot = mkdtemp();
    squadDir = path.join(tmpRoot, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'team.md'), TEAM_MD, 'utf-8');
    await squadRegistry.registerSquad(squadDir, tmpRoot);
    rosterProvider = new TeamRosterProvider();
  });

  teardown(() => {
    restoreWindow?.();
    restoreWindow = undefined;
    squadRegistry.dispose();
    // Windows may briefly hold a handle on a just-disposed FileSystemWatcher;
    // retry so teardown doesn't flake with ENOTEMPTY.
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  suite('add member', () => {
    test('adds a plain member: updates active context, disk, and the roster view', async () => {
      restoreWindow = stubWindow({
        showInputBox: ['Tank'],
        showQuickPick: ['Backend Dev'],
      });

      await handleAddMember(FAKE_CONTEXT, rosterProvider);

      // Active in-memory context
      const ctx = squadRegistry.activeContext!;
      const added = ctx.teamState.members.find((m) => m.name === 'Tank');
      assert.ok(added, 'Tank should be present in the active context');
      assert.strictEqual(added?.role, 'Backend Dev');
      assert.strictEqual(added?.section, 'members');
      assert.ok(ctx.agents.has('Tank'), 'agents map should include the new member');

      // Disk
      const onDisk = readTeamState(squadDir);
      assert.ok(onDisk?.members.some((m) => m.name === 'Tank'));

      // View
      const memberLabels = membersSectionItems(rosterProvider).map((i) => i.label as string);
      assert.ok(memberLabels.some((l) => l.includes('Tank')));

      // Scaffolded agent directory
      const agentDir = path.join(squadDir, 'agents', 'tank');
      assert.ok(fs.existsSync(path.join(agentDir, 'charter.md')));
      assert.ok(fs.existsSync(path.join(agentDir, 'history.md')));
    });

    test('adding a member with role "Coordinator" fills the coordinator slot', async () => {
      restoreWindow = stubWindow({
        showInputBox: ['NewLead'],
        showQuickPick: ['Coordinator'],
      });

      await handleAddMember(FAKE_CONTEXT, rosterProvider);

      const ctx = squadRegistry.activeContext!;
      assert.strictEqual(ctx.teamState.coordinator?.name, 'NewLead');
      assert.strictEqual(ctx.teamState.coordinator?.section, 'coordinator');
      // Existing members untouched
      assert.ok(ctx.teamState.members.some((m) => m.name === 'Neo'));
    });

    test('a custom role prompts for free text and uses it verbatim', async () => {
      restoreWindow = stubWindow({
        showInputBox: ['Oracle', 'Prophecy Analyst'],
        showQuickPick: ['Custom...'],
      });

      await handleAddMember(FAKE_CONTEXT, rosterProvider);

      const ctx = squadRegistry.activeContext!;
      const added = ctx.teamState.members.find((m) => m.name === 'Oracle');
      assert.strictEqual(added?.role, 'Prophecy Analyst');
    });

    test('cancelling the name prompt makes no changes', async () => {
      restoreWindow = stubWindow({
        showInputBox: [undefined],
        showQuickPick: ['Backend Dev'],
      });

      const beforeCount = squadRegistry.activeContext!.teamState.members.length;
      await handleAddMember(FAKE_CONTEXT, rosterProvider);

      assert.strictEqual(squadRegistry.activeContext!.teamState.members.length, beforeCount);
    });

    test('cancelling the role picker makes no changes', async () => {
      restoreWindow = stubWindow({
        showInputBox: ['Ghost'],
        showQuickPick: [undefined],
      });

      const beforeCount = squadRegistry.activeContext!.teamState.members.length;
      await handleAddMember(FAKE_CONTEXT, rosterProvider);

      assert.strictEqual(squadRegistry.activeContext!.teamState.members.length, beforeCount);
      assert.ok(!squadRegistry.activeContext!.teamState.members.some((m) => m.name === 'Ghost'));
    });
  });

  suite('edit member', () => {
    test('edits a field: updates active context, disk, and the roster view', async () => {
      restoreWindow = stubWindow({
        showQuickPick: ['Trinity', 'Role'],
        showInputBox: ['Full-Stack Dev'],
      });

      await handleEditMember(FAKE_CONTEXT, rosterProvider);

      const ctx = squadRegistry.activeContext!;
      const trinity = ctx.teamState.members.find((m) => m.name === 'Trinity');
      assert.strictEqual(trinity?.role, 'Full-Stack Dev');

      const onDisk = readTeamState(squadDir);
      assert.strictEqual(onDisk?.members.find((m) => m.name === 'Trinity')?.role, 'Full-Stack Dev');

      const memberLabels = membersSectionItems(rosterProvider);
      const trinityItem = memberLabels.find((i) => (i.label as string).includes('Trinity'));
      assert.ok(trinityItem?.tooltip?.toString().includes('Full-Stack Dev'));

      // Neo untouched
      assert.strictEqual(ctx.teamState.members.find((m) => m.name === 'Neo')?.role, 'Lead / Architect');
    });

    test('setting a field to an empty string clears it (falsy -> undefined)', async () => {
      restoreWindow = stubWindow({
        showQuickPick: ['Trinity', 'Notes'],
        showInputBox: [''],
      });

      await handleEditMember(FAKE_CONTEXT, rosterProvider);

      const trinity = squadRegistry.activeContext!.teamState.members.find((m) => m.name === 'Trinity');
      assert.strictEqual(trinity?.notes, undefined);
    });

    test('can edit the coordinator and the coding agent, not just plain members', async () => {
      restoreWindow = stubWindow({
        showQuickPick: ['@copilot', 'Status'],
        showInputBox: ['🤖 Paused'],
      });

      await handleEditMember(FAKE_CONTEXT, rosterProvider);

      const ctx = squadRegistry.activeContext!;
      assert.strictEqual(ctx.teamState.codingAgent?.status, '🤖 Paused');
    });

    test('cancelling the new-value prompt makes no changes', async () => {
      restoreWindow = stubWindow({
        showQuickPick: ['Trinity', 'Role'],
        showInputBox: [undefined],
      });

      await handleEditMember(FAKE_CONTEXT, rosterProvider);

      const trinity = squadRegistry.activeContext!.teamState.members.find((m) => m.name === 'Trinity');
      assert.strictEqual(trinity?.role, 'Frontend Dev');
    });
  });

  suite('remove member', () => {
    function seedAgentDir(name: string): string {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const agentDir = path.join(squadDir, 'agents', slug);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'charter.md'), `# ${name} Charter`, 'utf-8');
      return agentDir;
    }

    test('removes a member: updates active context, disk, and the roster view', async () => {
      const agentDir = seedAgentDir('Neo');
      restoreWindow = stubWindow({
        showQuickPick: ['Neo'],
        showWarningMessage: ['Remove'],
      });

      await handleRemoveMember(FAKE_CONTEXT, rosterProvider);

      const ctx = squadRegistry.activeContext!;
      assert.ok(!ctx.teamState.members.some((m) => m.name === 'Neo'));
      assert.ok(!ctx.agents.has('Neo'), 'agents map should drop the removed member');

      const onDisk = readTeamState(squadDir);
      assert.ok(!onDisk?.members.some((m) => m.name === 'Neo'));

      const memberLabels = membersSectionItems(rosterProvider).map((i) => i.label as string);
      assert.ok(!memberLabels.some((l) => l.includes('Neo')));

      // Alumni archive
      assert.ok(!fs.existsSync(agentDir), 'original agent directory should be moved');
      const alumniTarget = path.join(squadDir, 'agents', '_alumni', 'neo');
      assert.ok(fs.existsSync(path.join(alumniTarget, 'charter.md')), 'charter should be archived under _alumni');
    });

    test('removing the coordinator clears the coordinator slot', async () => {
      restoreWindow = stubWindow({
        showQuickPick: ['Squad'],
        showWarningMessage: ['Remove'],
      });

      await handleRemoveMember(FAKE_CONTEXT, rosterProvider);

      assert.strictEqual(squadRegistry.activeContext!.teamState.coordinator, null);
    });

    test('removing the coding agent clears the coding-agent slot', async () => {
      restoreWindow = stubWindow({
        showQuickPick: ['@copilot'],
        showWarningMessage: ['Remove'],
      });

      await handleRemoveMember(FAKE_CONTEXT, rosterProvider);

      assert.strictEqual(squadRegistry.activeContext!.teamState.codingAgent, null);
    });

    test('declining the confirmation makes no changes and leaves the agent directory in place', async () => {
      const agentDir = seedAgentDir('Neo');
      restoreWindow = stubWindow({
        showQuickPick: ['Neo'],
        showWarningMessage: [undefined],
      });

      await handleRemoveMember(FAKE_CONTEXT, rosterProvider);

      assert.ok(squadRegistry.activeContext!.teamState.members.some((m) => m.name === 'Neo'));
      assert.ok(fs.existsSync(agentDir));
    });

    test('archiving to an already-occupied alumni slot falls back to a timestamped name', async () => {
      const agentDir = seedAgentDir('Neo');
      const alumniDir = path.join(squadDir, 'agents', '_alumni');
      const preExisting = path.join(alumniDir, 'neo');
      fs.mkdirSync(preExisting, { recursive: true });
      fs.writeFileSync(path.join(preExisting, 'charter.md'), '# Pre-existing alumnus', 'utf-8');

      restoreWindow = stubWindow({
        showQuickPick: ['Neo'],
        showWarningMessage: ['Remove'],
      });

      await handleRemoveMember(FAKE_CONTEXT, rosterProvider);

      assert.ok(!fs.existsSync(agentDir));
      // The pre-existing alumnus is untouched...
      assert.strictEqual(
        fs.readFileSync(path.join(preExisting, 'charter.md'), 'utf-8'),
        '# Pre-existing alumnus',
      );
      // ...and the newly-removed member landed in a timestamp-suffixed sibling.
      const entries = fs.readdirSync(alumniDir);
      assert.ok(entries.some((e) => e.startsWith('neo-') && e !== 'neo'));
    });
  });
});
