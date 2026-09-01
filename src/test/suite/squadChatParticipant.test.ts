import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  matchSquadByQuery,
  parseAssignMention,
  parseCompleteArgs,
  parseProgressArgs,
  findAgentByQuery,
  handleStatus,
  handleSwitch,
  handleAssign,
  handleRoster,
  handleAgents,
  handleComplete,
  handleProgress,
} from '../../chat/squadChatParticipant';
import { squadRegistry } from '../../core/squadRegistry';
import { commandQueueManager } from '../../monitoring/commandQueue';
import type { AgentRuntime } from '../../core/types';

/**
 * Minimal fake of `vscode.ChatResponseStream` capturing the two members the
 * chat handlers actually call (`markdown`, `button`). The full interface has
 * many more members the handlers never touch, so this is intentionally a
 * partial cast rather than a full implementation.
 */
class FakeStream {
  markdownCalls: string[] = [];
  buttons: { command: string; title: string; arguments?: unknown[] }[] = [];

  markdown(value: string | vscode.MarkdownString): void {
    this.markdownCalls.push(typeof value === 'string' ? value : value.value);
  }

  button(opts: { command: string; title: string; arguments?: unknown[] }): void {
    this.buttons.push(opts);
  }

  get text(): string {
    return this.markdownCalls.join('');
  }
}

function fakeStream(): vscode.ChatResponseStream {
  return new FakeStream() as unknown as vscode.ChatResponseStream;
}

function fakeRequest(prompt: string): vscode.ChatRequest {
  return { prompt } as unknown as vscode.ChatRequest;
}

function makeAgent(name: string, overrides: Partial<AgentRuntime> = {}): AgentRuntime {
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
    ...overrides,
  };
}

suite('squadChatParticipant — pure helpers', () => {
  suite('matchSquadByQuery', () => {
    const squads = [{ squadName: 'Alpha' }, { squadName: 'Beta' }, { squadName: 'AlphaTwo' }];

    test('returns an exact match over any partial matches', () => {
      const result = matchSquadByQuery(squads, 'alpha');
      assert.strictEqual(result.kind, 'exact');
      assert.strictEqual((result as { match: { squadName: string } }).match.squadName, 'Alpha');
    });

    test('returns partial-single for a substring match with no exact hit', () => {
      const result = matchSquadByQuery(squads, 'alphatw');
      assert.strictEqual(result.kind, 'partial-single');
      assert.strictEqual((result as { match: { squadName: string } }).match.squadName, 'AlphaTwo');
    });

    test('returns ambiguous when multiple squads match a substring and none matches exactly', () => {
      const ambiguous = matchSquadByQuery(squads, 'lph');
      assert.strictEqual(ambiguous.kind, 'ambiguous');
      assert.strictEqual((ambiguous as { matches: unknown[] }).matches.length, 2);
    });

    test('returns none when nothing matches', () => {
      const result = matchSquadByQuery(squads, 'zzz');
      assert.strictEqual(result.kind, 'none');
    });

    test('matching is case-insensitive', () => {
      const result = matchSquadByQuery(squads, 'ALPHA');
      assert.strictEqual(result.kind, 'exact');
    });
  });

  suite('parseAssignMention', () => {
    test('parses an @agent followed by a task', () => {
      const result = parseAssignMention('@Backend Implement the login endpoint');
      assert.deepStrictEqual(result, { agentName: 'Backend', task: 'Implement the login endpoint' });
    });

    test('returns null when there is no leading @mention', () => {
      assert.strictEqual(parseAssignMention('Implement the login endpoint'), null);
    });

    test('returns null when the mention has no task text', () => {
      assert.strictEqual(parseAssignMention('@Backend'), null);
    });

    test('does not match across newlines (single-line only)', () => {
      // The original regex has no `s` flag, so a task containing a newline
      // is not captured beyond the first line's semantics — the whole
      // string must still match `.` on one line.
      const result = parseAssignMention('@Backend line one\nline two');
      assert.strictEqual(result, null);
    });
  });

  suite('parseCompleteArgs', () => {
    test('parses success with a summary, @ optional', () => {
      assert.deepStrictEqual(parseCompleteArgs('@Backend success All done'), {
        agentName: 'Backend',
        isSuccess: true,
        summary: 'All done',
      });
      assert.deepStrictEqual(parseCompleteArgs('Backend success All done'), {
        agentName: 'Backend',
        isSuccess: true,
        summary: 'All done',
      });
    });

    test('treats "done" as success and "failure"/"error" as failure', () => {
      assert.strictEqual(parseCompleteArgs('@A done')?.isSuccess, true);
      assert.strictEqual(parseCompleteArgs('@A success')?.isSuccess, true);
      assert.strictEqual(parseCompleteArgs('@A failure')?.isSuccess, false);
      assert.strictEqual(parseCompleteArgs('@A error')?.isSuccess, false);
    });

    test('is case-insensitive on the status keyword', () => {
      assert.strictEqual(parseCompleteArgs('@A SUCCESS')?.isSuccess, true);
      assert.strictEqual(parseCompleteArgs('@A Failure')?.isSuccess, false);
    });

    test('summary is optional and undefined when omitted', () => {
      const result = parseCompleteArgs('@A success');
      assert.strictEqual(result?.summary, undefined);
    });

    test('returns null for an unrecognized status keyword', () => {
      assert.strictEqual(parseCompleteArgs('@A maybe'), null);
    });

    test('returns null for an empty prompt', () => {
      assert.strictEqual(parseCompleteArgs(''), null);
    });
  });

  suite('parseProgressArgs', () => {
    test('parses an @agent and a message', () => {
      assert.deepStrictEqual(parseProgressArgs('@Backend Setting up database...'), {
        agentName: 'Backend',
        message: 'Setting up database...',
      });
    });

    test('@ prefix is optional', () => {
      assert.deepStrictEqual(parseProgressArgs('Backend Setting up database...'), {
        agentName: 'Backend',
        message: 'Setting up database...',
      });
    });

    test('message may span multiple lines (the `s` flag makes `.` match newlines)', () => {
      const result = parseProgressArgs('@Backend line one\nline two');
      assert.deepStrictEqual(result, { agentName: 'Backend', message: 'line one\nline two' });
    });

    test('returns null when there is no message', () => {
      assert.strictEqual(parseProgressArgs('@Backend'), null);
    });
  });

  suite('findAgentByQuery', () => {
    const agents: [string, AgentRuntime][] = [
      ['Backend', makeAgent('Backend')],
      ['Frontend', makeAgent('Frontend')],
    ];

    test('finds an exact (case-insensitive) match first', () => {
      const [name] = findAgentByQuery(agents, 'backend')!;
      assert.strictEqual(name, 'Backend');
    });

    test('falls back to a substring match', () => {
      const [name] = findAgentByQuery(agents, 'front')!;
      assert.strictEqual(name, 'Frontend');
    });

    test('returns undefined when nothing matches', () => {
      assert.strictEqual(findAgentByQuery(agents, 'nope'), undefined);
    });
  });
});

suite('squadChatParticipant — no-active-squad paths', () => {
  setup(() => {
    // Ensure a clean slate: no registered squads, nothing active.
    squadRegistry.dispose();
  });

  teardown(() => {
    squadRegistry.dispose();
  });

  test('handleStatus reports no active squad and offers to create one', () => {
    const stream = new FakeStream();
    handleStatus(stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No active squad'));
    assert.ok(stream.buttons.some((b) => b.command === 'squad.createSquad'));
  });

  test('handleSwitch reports no squads found in the workspace', async () => {
    const stream = new FakeStream();
    await handleSwitch(fakeRequest(''), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No squads found'));
    assert.ok(stream.buttons.some((b) => b.command === 'squad.createSquad'));
  });

  test('handleAssign reports no active squad and offers to switch', async () => {
    const stream = new FakeStream();
    await handleAssign(fakeRequest('do something'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No active squad'));
    assert.ok(stream.buttons.some((b) => b.command === 'squad.switchSquad'));
  });

  test('handleRoster reports no active squad', () => {
    const stream = new FakeStream();
    handleRoster(stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No active squad'));
    assert.ok(stream.buttons.some((b) => b.command === 'squad.createSquad'));
  });

  test('handleAgents reports no active squad', () => {
    const stream = new FakeStream();
    handleAgents(fakeRequest(''), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No active squad'));
    assert.ok(stream.buttons.some((b) => b.command === 'squad.createSquad'));
  });

  test('handleComplete reports no active squad', () => {
    const stream = new FakeStream();
    handleComplete(fakeRequest('@Backend success'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No active squad'));
  });

  test('handleProgress reports no active squad', () => {
    const stream = new FakeStream();
    handleProgress(fakeRequest('@Backend working on it'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No active squad'));
  });
});

suite('squadChatParticipant — with an active squad', () => {
  let tmpRoot: string;
  let squadDir: string;

  const TEAM_MD = `# Test Squad

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Backend | Engineer | — | ✅ Active |
| Frontend | Engineer | — | ✅ Active |
`;

  setup(async () => {
    squadRegistry.dispose();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-chat-test-'));
    squadDir = path.join(tmpRoot, '.squad', 'squads', 'TestSquad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'team.md'), TEAM_MD, 'utf-8');
    await squadRegistry.registerSquad(squadDir, tmpRoot);
  });

  teardown(() => {
    squadRegistry.dispose();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('handleStatus lists the squad and its agents', () => {
    const stream = new FakeStream();
    handleStatus(stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('TestSquad'));
    assert.ok(stream.text.includes('Backend'));
    assert.ok(stream.text.includes('Frontend'));
  });

  test('handleSwitch with no query lists squads and marks the active one', async () => {
    const stream = new FakeStream();
    await handleSwitch(fakeRequest(''), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('TestSquad'));
    assert.ok(stream.text.includes('*active*'));
  });

  test('handleSwitch with an unmatched query lists available squads', async () => {
    const stream = new FakeStream();
    await handleSwitch(fakeRequest('doesnotexist'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No squad matching'));
    assert.ok(stream.text.includes('TestSquad'));
  });

  test('handleRoster lists all agents with role and status', () => {
    const stream = new FakeStream();
    handleRoster(stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Backend'));
    assert.ok(stream.text.includes('Frontend'));
    assert.ok(stream.text.includes('Engineer'));
  });

  test('handleAgents with no query lists all agents', () => {
    const stream = new FakeStream();
    handleAgents(fakeRequest(''), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Backend'));
    assert.ok(stream.text.includes('Frontend'));
  });

  test('handleAgents with a matching query shows agent detail', () => {
    const stream = new FakeStream();
    handleAgents(fakeRequest('backend'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Backend'));
    assert.ok(stream.buttons.some((b) => b.command === 'squad.openAgentDetail'));
  });

  test('handleAgents with a non-matching query lists available agents', () => {
    const stream = new FakeStream();
    handleAgents(fakeRequest('nope'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('No agent matching'));
    assert.ok(stream.text.includes('Backend'));
  });

  test('handleAssign with no @mention enqueues a task for every agent', async () => {
    const stream = new FakeStream();
    await handleAssign(fakeRequest('Ship the feature'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('all **2** agents'));
    assert.ok(commandQueueManager.getQueueForAgent('Backend').some((i) => i.command === 'Ship the feature'));
    assert.ok(commandQueueManager.getQueueForAgent('Frontend').some((i) => i.command === 'Ship the feature'));
  });

  test('handleAssign with a valid @mention enqueues a task for that agent only', async () => {
    const stream = new FakeStream();
    await handleAssign(fakeRequest('@Backend Fix the bug'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('assigned to **Backend**'));
    assert.ok(commandQueueManager.getQueueForAgent('Backend').some((i) => i.command === 'Fix the bug'));
    assert.deepStrictEqual(
      commandQueueManager.getQueueForAgent('Frontend').filter((i) => i.command === 'Fix the bug'),
      [],
    );
  });

  test('handleAssign with an unknown @mention reports the agent as not found', async () => {
    const stream = new FakeStream();
    await handleAssign(fakeRequest('@Nope Fix the bug'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('not found'));
    assert.ok(stream.text.includes('Backend'));
  });

  test('handleAssign with an empty prompt shows usage', async () => {
    const stream = new FakeStream();
    await handleAssign(fakeRequest(''), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Usage:'));
  });

  test('handleComplete marks a running queue item completed on success', () => {
    const item = commandQueueManager.enqueue('Backend', 'do-thing');
    commandQueueManager.markRunning(item.id);

    const stream = new FakeStream();
    handleComplete(fakeRequest('@Backend success All good'), stream as unknown as vscode.ChatResponseStream);

    assert.ok(stream.text.includes('completed'));
    assert.ok(stream.text.includes('All good'));
    const [found] = commandQueueManager.getQueueForAgent('Backend').filter((i) => i.id === item.id);
    assert.strictEqual(found.status, 'completed');
    assert.strictEqual(found.result, 'All good');
  });

  test('handleComplete marks a running queue item failed on failure', () => {
    const item = commandQueueManager.enqueue('Frontend', 'do-thing');
    commandQueueManager.markRunning(item.id);

    const stream = new FakeStream();
    handleComplete(fakeRequest('@Frontend failure It broke'), stream as unknown as vscode.ChatResponseStream);

    assert.ok(stream.text.includes('failed'));
    const [found] = commandQueueManager.getQueueForAgent('Frontend').filter((i) => i.id === item.id);
    assert.strictEqual(found.status, 'failed');
    assert.strictEqual(found.error, 'It broke');
  });

  test('handleComplete reports an unknown agent', () => {
    const stream = new FakeStream();
    handleComplete(fakeRequest('@Nope success'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('not found'));
  });

  test('handleComplete shows usage for an unparseable prompt', () => {
    const stream = new FakeStream();
    handleComplete(fakeRequest('@Backend not-a-status'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Usage:'));
  });

  test('handleProgress logs a progress message for a known agent', () => {
    const stream = new FakeStream();
    handleProgress(fakeRequest('@Backend Halfway there'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Backend'));
    assert.ok(stream.text.includes('Halfway there'));
  });

  test('handleProgress reports an unknown agent', () => {
    const stream = new FakeStream();
    handleProgress(fakeRequest('@Nope Halfway there'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('not found'));
  });

  test('handleProgress shows usage for an unparseable prompt', () => {
    const stream = new FakeStream();
    handleProgress(fakeRequest('@Backend'), stream as unknown as vscode.ChatResponseStream);
    assert.ok(stream.text.includes('Usage:'));
  });
});
