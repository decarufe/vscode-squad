import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  matchGlobSimple,
  parseOwnedFilesSection,
  resolveAgentNameFromEntry,
  findOwnersForFile,
} from '../../commands/whoOwns';
import type { AgentRuntime } from '../../core/types';

function makeAgent(name: string): AgentRuntime {
  return {
    name,
    role: 'Engineer',
    emoji: '👤',
    status: 'idle',
    statistics: {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageDuration: 0,
      lastActiveAt: 0,
      decisionsCount: 0,
      linesChanged: 0,
    },
  };
}

suite('whoOwns — matchGlobSimple', () => {
  test('exact path with no wildcards matches only itself', () => {
    assert.strictEqual(matchGlobSimple('src/extension.ts', 'src/extension.ts'), true);
    assert.strictEqual(matchGlobSimple('src/extension2.ts', 'src/extension.ts'), false);
  });

  test('single * matches within one path segment, not across /', () => {
    assert.strictEqual(matchGlobSimple('src/foo.ts', 'src/*.ts'), true);
    assert.strictEqual(matchGlobSimple('src/nested/foo.ts', 'src/*.ts'), false);
  });

  test('double ** matches across multiple path segments', () => {
    assert.strictEqual(matchGlobSimple('src/a/b/c.ts', 'src/**'), true);
    assert.strictEqual(matchGlobSimple('src/a.ts', 'src/**'), true);
    assert.strictEqual(matchGlobSimple('other/a.ts', 'src/**'), false);
  });

  test('? matches exactly one character', () => {
    assert.strictEqual(matchGlobSimple('src/a.ts', 'src/?.ts'), true);
    assert.strictEqual(matchGlobSimple('src/ab.ts', 'src/?.ts'), false);
    assert.strictEqual(matchGlobSimple('src/.ts', 'src/?.ts'), false);
  });

  test('backslash paths are normalized to forward slashes before matching', () => {
    assert.strictEqual(matchGlobSimple('src\\server\\index.ts', 'src/server/**'), true);
  });

  test('regex special characters in the pattern are escaped literally', () => {
    assert.strictEqual(matchGlobSimple('src/a.b.ts', 'src/a.b.ts'), true);
    // A literal "." must not behave like the regex any-char wildcard.
    assert.strictEqual(matchGlobSimple('src/aXb.ts', 'src/a.b.ts'), false);
  });
});

suite('whoOwns — parseOwnedFilesSection', () => {
  test('parses a simple bullet list under "## Owned Files"', () => {
    const charter = [
      '# Charter',
      '',
      '## Owned Files',
      '- src/server/**',
      '- src/api/*.ts',
      '',
      '## Other Section',
      'unrelated content',
    ].join('\n');

    assert.deepStrictEqual(parseOwnedFilesSection(charter), ['src/server/**', 'src/api/*.ts']);
  });

  test('supports "*" bullets in addition to "-"', () => {
    const charter = ['## Owned Files', '* src/a.ts', '* src/b.ts'].join('\n');
    assert.deepStrictEqual(parseOwnedFilesSection(charter), ['src/a.ts', 'src/b.ts']);
  });

  test('ignores blank lines and parenthetical notes', () => {
    const charter = [
      '## Owned Files',
      '- src/a.ts',
      '',
      '(no other files owned)',
      '- src/b.ts',
    ].join('\n');
    assert.deepStrictEqual(parseOwnedFilesSection(charter), ['src/a.ts', 'src/b.ts']);
  });

  test('returns an empty array when the section is missing', () => {
    const charter = '# Charter\n\n## Some Other Section\ncontent';
    assert.deepStrictEqual(parseOwnedFilesSection(charter), []);
  });

  test('stops at the next "##" heading', () => {
    const charter = [
      '## Owned Files',
      '- src/a.ts',
      '## Responsibilities',
      '- src/b.ts',
    ].join('\n');
    assert.deepStrictEqual(parseOwnedFilesSection(charter), ['src/a.ts']);
  });
});

suite('whoOwns — resolveAgentNameFromEntry', () => {
  test('resolves a slugified directory name to its roster display name', () => {
    const agents = new Map<string, AgentRuntime>([
      ['Neo', makeAgent('Neo')],
      ['Trinity', makeAgent('Trinity')],
    ]);
    assert.strictEqual(resolveAgentNameFromEntry('neo', agents), 'Neo');
    assert.strictEqual(resolveAgentNameFromEntry('trinity', agents), 'Trinity');
  });

  test('slugifies names with spaces and punctuation the same way directories are created', () => {
    const agents = new Map<string, AgentRuntime>([
      ['Eric De Carufel', makeAgent('Eric De Carufel')],
    ]);
    assert.strictEqual(resolveAgentNameFromEntry('eric-de-carufel', agents), 'Eric De Carufel');
  });

  test('falls back to the entry name when no roster agent matches', () => {
    const agents = new Map<string, AgentRuntime>([['Neo', makeAgent('Neo')]]);
    assert.strictEqual(resolveAgentNameFromEntry('ghost', agents), 'ghost');
  });
});

suite('whoOwns — findOwnersForFile', () => {
  let tmpDir: string;
  let agentsDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-whoowns-test-'));
    agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCharter(agentEntry: string, content: string): void {
    const dir = path.join(agentsDir, agentEntry);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'charter.md'), content, 'utf-8');
  }

  test('returns owners whose glob patterns match the file, resolved to agent names', () => {
    writeCharter('neo', ['## Owned Files', '- src/core/**'].join('\n'));
    writeCharter('trinity', ['## Owned Files', '- src/webview/*.ts'].join('\n'));

    const owners = findOwnersForFile('src/core/squadRegistry.ts', agentsDir, (entry) =>
      entry === 'neo' ? 'Neo' : entry === 'trinity' ? 'Trinity' : entry,
    );

    assert.strictEqual(owners.length, 1);
    assert.strictEqual(owners[0].agent, 'Neo');
    assert.strictEqual(owners[0].pattern, 'src/core/**');
  });

  test('returns multiple owners when more than one charter matches', () => {
    writeCharter('neo', ['## Owned Files', '- src/**'].join('\n'));
    writeCharter('trinity', ['## Owned Files', '- src/core/*.ts'].join('\n'));

    const owners = findOwnersForFile('src/core/squadRegistry.ts', agentsDir, (entry) => entry);

    assert.strictEqual(owners.length, 2);
    const agents = owners.map((o) => o.agent).sort();
    assert.deepStrictEqual(agents, ['neo', 'trinity']);
  });

  test('returns an empty array when no charter matches the file', () => {
    writeCharter('neo', ['## Owned Files', '- docs/**'].join('\n'));
    const owners = findOwnersForFile('src/core/squadRegistry.ts', agentsDir, (entry) => entry);
    assert.deepStrictEqual(owners, []);
  });

  test('returns an empty array when the agents directory does not exist', () => {
    const owners = findOwnersForFile('src/core/squadRegistry.ts', path.join(tmpDir, 'does-not-exist'), (entry) => entry);
    assert.deepStrictEqual(owners, []);
  });

  test('skips agent directories that have no charter.md', () => {
    fs.mkdirSync(path.join(agentsDir, 'no-charter'), { recursive: true });
    writeCharter('neo', ['## Owned Files', '- src/**'].join('\n'));

    const owners = findOwnersForFile('src/core/squadRegistry.ts', agentsDir, (entry) => entry);
    assert.strictEqual(owners.length, 1);
    assert.strictEqual(owners[0].agent, 'neo');
  });

  test('skips charters that have no "## Owned Files" section', () => {
    writeCharter('neo', '# Charter\n\nNo owned files section here.');
    const owners = findOwnersForFile('src/core/squadRegistry.ts', agentsDir, (entry) => entry);
    assert.deepStrictEqual(owners, []);
  });
});
