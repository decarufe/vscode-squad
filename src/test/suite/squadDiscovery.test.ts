import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { squadRegistry } from '../../core/squadRegistry';

/**
 * #13 — squad discovery + layout coverage:
 *   - flat layout:   <root>/.squad/team.md
 *   - nested layout: <root>/.squad/squads/<name>/team.md
 *   - both layouts coexisting in the same workspace root
 *   - active-squad selection across scans/registrations/removals
 *
 * `squadRegistry` is a process-wide singleton (same convention as
 * `commandQueueManager` in commandQueue.test.ts), so every test disposes it
 * in `teardown` to reset `contexts`/`activeSquadPath` before the next test.
 */

const MINIMAL_TEAM_MD = (name: string): string => `# ${name} Team

## Members

| Name | Role |
|------|------|
| Alice | Dev |
`;

function mkdtemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'squad-discovery-test-'));
}

function writeFlatSquad(root: string, teamName = 'Flat'): string {
  const squadDir = path.join(root, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), MINIMAL_TEAM_MD(teamName), 'utf-8');
  return squadDir;
}

function writeNestedSquad(root: string, name: string): string {
  const squadDir = path.join(root, '.squad', 'squads', name);
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), MINIMAL_TEAM_MD(name), 'utf-8');
  return squadDir;
}

suite('squadRegistry — discovery + layouts (#13)', () => {
  let tmpRoot: string;

  setup(() => {
    tmpRoot = mkdtemp();
  });

  teardown(() => {
    squadRegistry.dispose();
    // Windows may briefly hold a handle on a just-disposed FileSystemWatcher;
    // retry so teardown doesn't flake with ENOTEMPTY.
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  suite('flat layout: <root>/.squad/team.md', () => {
    test('is discovered and registered with layout "flat"', async () => {
      writeFlatSquad(tmpRoot);

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 1);
      const ctx = squadRegistry.allContexts[0];
      assert.strictEqual(ctx.layout, 'flat');
      assert.strictEqual(ctx.squadDir, path.join(tmpRoot, '.squad'));
      assert.strictEqual(ctx.rootPath, tmpRoot);
    });

    test('squad name falls back to the workspace folder name (not ".squad")', async () => {
      writeFlatSquad(tmpRoot);

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      const ctx = squadRegistry.allContexts[0];
      assert.strictEqual(ctx.squadName, path.basename(tmpRoot));
    });

    test('becomes the active squad since it is the only one registered', async () => {
      const squadDir = writeFlatSquad(tmpRoot);

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.activeSquadPath, squadDir);
      assert.strictEqual(squadRegistry.activeContext?.squadDir, squadDir);
    });

    test('a workspace root with no .squad directory registers nothing', async () => {
      await squadRegistry.scanWorkspaceFolder(tmpRoot);
      assert.strictEqual(squadRegistry.allContexts.length, 0);
      assert.strictEqual(squadRegistry.activeSquadPath, undefined);
    });

    test('an empty .squad directory (no team.md) registers nothing', async () => {
      fs.mkdirSync(path.join(tmpRoot, '.squad'), { recursive: true });
      await squadRegistry.scanWorkspaceFolder(tmpRoot);
      assert.strictEqual(squadRegistry.allContexts.length, 0);
    });
  });

  suite('nested layout: <root>/.squad/squads/<name>/team.md', () => {
    test('each nested squad directory is discovered and registered with layout "nested"', async () => {
      writeNestedSquad(tmpRoot, 'alpha');
      writeNestedSquad(tmpRoot, 'beta');

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 2);
      const byName = new Map(squadRegistry.allContexts.map((c) => [c.squadName, c]));
      assert.ok(byName.has('alpha'));
      assert.ok(byName.has('beta'));
      assert.strictEqual(byName.get('alpha')?.layout, 'nested');
      assert.strictEqual(byName.get('beta')?.layout, 'nested');
    });

    test('squad name is the nested directory name, and rootPath is the workspace root', async () => {
      const squadDir = writeNestedSquad(tmpRoot, 'gamma');

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      const ctx = squadRegistry.getContext(squadDir);
      assert.ok(ctx);
      assert.strictEqual(ctx?.squadName, 'gamma');
      assert.strictEqual(ctx?.rootPath, tmpRoot);
    });

    test('the first nested squad in sorted order becomes active', async () => {
      writeNestedSquad(tmpRoot, 'zeta');
      writeNestedSquad(tmpRoot, 'alpha');
      writeNestedSquad(tmpRoot, 'mid');

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.activeContext?.squadName, 'alpha');
    });

    test('a non-directory entry under squads/ is skipped without error', async () => {
      const squadsDir = path.join(tmpRoot, '.squad', 'squads');
      fs.mkdirSync(squadsDir, { recursive: true });
      fs.writeFileSync(path.join(squadsDir, 'stray-file.txt'), 'not a squad', 'utf-8');
      writeNestedSquad(tmpRoot, 'valid');

      await assert.doesNotReject(() => squadRegistry.scanWorkspaceFolder(tmpRoot));

      assert.strictEqual(squadRegistry.allContexts.length, 1);
      assert.strictEqual(squadRegistry.allContexts[0].squadName, 'valid');
    });

    test('a nested directory without team.md is skipped', async () => {
      fs.mkdirSync(path.join(tmpRoot, '.squad', 'squads', 'empty-dir'), { recursive: true });
      writeNestedSquad(tmpRoot, 'valid');

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 1);
      assert.strictEqual(squadRegistry.allContexts[0].squadName, 'valid');
    });
  });

  suite('both layouts coexisting in the same workspace root', () => {
    test('flat and nested squads are all registered together', async () => {
      writeNestedSquad(tmpRoot, 'alpha');
      writeNestedSquad(tmpRoot, 'beta');
      writeFlatSquad(tmpRoot);

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 3);
      const layouts = new Map(squadRegistry.allContexts.map((c) => [c.squadName, c.layout]));
      assert.strictEqual(layouts.get('alpha'), 'nested');
      assert.strictEqual(layouts.get('beta'), 'nested');
      assert.strictEqual(layouts.get(path.basename(tmpRoot)), 'flat');
    });

    test('a nested squad wins the active slot over the flat squad (nested registered first)', async () => {
      writeNestedSquad(tmpRoot, 'alpha');
      writeFlatSquad(tmpRoot);

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.activeContext?.layout, 'nested');
      assert.strictEqual(squadRegistry.activeContext?.squadName, 'alpha');
    });

    test('when only the flat squad exists, it becomes active even with an (empty) squads/ dir', async () => {
      fs.mkdirSync(path.join(tmpRoot, '.squad', 'squads'), { recursive: true });
      writeFlatSquad(tmpRoot);

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 1);
      assert.strictEqual(squadRegistry.activeContext?.layout, 'flat');
    });
  });

  suite('active-squad selection: setActiveSquad / unregisterSquad / unregisterFolder', () => {
    test('setActiveSquad switches the active context among registered squads', async () => {
      const alpha = writeNestedSquad(tmpRoot, 'alpha');
      const beta = writeNestedSquad(tmpRoot, 'beta');
      await squadRegistry.scanWorkspaceFolder(tmpRoot);
      assert.strictEqual(squadRegistry.activeSquadPath, alpha);

      squadRegistry.setActiveSquad(beta);

      assert.strictEqual(squadRegistry.activeSquadPath, beta);
      assert.strictEqual(squadRegistry.activeContext?.squadName, 'beta');
    });

    test('setActiveSquad is a no-op for an unregistered squadDir', async () => {
      const alpha = writeNestedSquad(tmpRoot, 'alpha');
      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      squadRegistry.setActiveSquad(path.join(tmpRoot, '.squad', 'squads', 'does-not-exist'));

      assert.strictEqual(squadRegistry.activeSquadPath, alpha);
    });

    test('unregisterSquad removes the context and disposes its watcher', async () => {
      const alpha = writeNestedSquad(tmpRoot, 'alpha');
      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      squadRegistry.unregisterSquad(alpha);

      assert.strictEqual(squadRegistry.getContext(alpha), undefined);
      assert.strictEqual(squadRegistry.allContexts.length, 0);
    });

    test('removing the active squad falls back to a remaining registered squad', async () => {
      const alpha = writeNestedSquad(tmpRoot, 'alpha');
      const beta = writeNestedSquad(tmpRoot, 'beta');
      await squadRegistry.scanWorkspaceFolder(tmpRoot);
      assert.strictEqual(squadRegistry.activeSquadPath, alpha);

      squadRegistry.unregisterSquad(alpha);

      assert.strictEqual(squadRegistry.activeSquadPath, beta);
    });

    test('removing the last remaining squad clears the active squad entirely', async () => {
      const alpha = writeNestedSquad(tmpRoot, 'alpha');
      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      squadRegistry.unregisterSquad(alpha);

      assert.strictEqual(squadRegistry.activeSquadPath, undefined);
      assert.strictEqual(squadRegistry.activeContext, undefined);
    });

    test('unregisterFolder removes every squad under that workspace root only', async () => {
      const otherRoot = mkdtemp();
      try {
        writeNestedSquad(tmpRoot, 'alpha');
        writeNestedSquad(tmpRoot, 'beta');
        writeFlatSquad(otherRoot, 'Other');

        await squadRegistry.scanWorkspaceFolder(tmpRoot);
        await squadRegistry.scanWorkspaceFolder(otherRoot);
        assert.strictEqual(squadRegistry.allContexts.length, 3);

        squadRegistry.unregisterFolder(tmpRoot);

        assert.strictEqual(squadRegistry.allContexts.length, 1);
        assert.strictEqual(squadRegistry.allContexts[0].rootPath, otherRoot);
      } finally {
        fs.rmSync(otherRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
  });

  suite('registerSquad idempotency + re-registration guards', () => {
    test('registering the same squadDir twice keeps a single context', async () => {
      const squadDir = writeFlatSquad(tmpRoot);

      await squadRegistry.registerSquad(squadDir, tmpRoot);
      await squadRegistry.registerSquad(squadDir, tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 1);
    });

    test('registerSquad on a directory without team.md is a silent no-op', async () => {
      const squadDir = path.join(tmpRoot, '.squad');
      fs.mkdirSync(squadDir, { recursive: true });

      await squadRegistry.registerSquad(squadDir, tmpRoot);

      assert.strictEqual(squadRegistry.allContexts.length, 0);
      assert.strictEqual(squadRegistry.activeSquadPath, undefined);
    });

    test('registerSquad derives rootPath from squadDir when no workspaceRoot is given (nested)', async () => {
      const squadDir = writeNestedSquad(tmpRoot, 'alpha');

      await squadRegistry.registerSquad(squadDir);

      const ctx = squadRegistry.getContext(squadDir);
      assert.strictEqual(ctx?.rootPath, tmpRoot);
      assert.strictEqual(ctx?.layout, 'nested');
    });

    test('registerSquad derives rootPath from squadDir when no workspaceRoot is given (flat)', async () => {
      const squadDir = writeFlatSquad(tmpRoot);

      await squadRegistry.registerSquad(squadDir);

      const ctx = squadRegistry.getContext(squadDir);
      assert.strictEqual(ctx?.rootPath, tmpRoot);
      assert.strictEqual(ctx?.layout, 'flat');
    });
  });

  suite('registered context content reflects the parsed team.md', () => {
    test('agents map and statistics are built from the roster', async () => {
      const squadDir = writeNestedSquad(tmpRoot, 'alpha');

      await squadRegistry.scanWorkspaceFolder(tmpRoot);

      const ctx = squadRegistry.getContext(squadDir);
      assert.ok(ctx);
      assert.ok(ctx?.agents.has('Alice'));
      assert.strictEqual(ctx?.statistics.totalAgents, 1);
      assert.strictEqual(ctx?.teamState.members[0].name, 'Alice');
    });
  });
});
