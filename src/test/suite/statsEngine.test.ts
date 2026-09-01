import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { squadRegistry } from '../../core/squadRegistry';
import { commandQueueManager } from '../../monitoring/commandQueue';
import { statsEngine } from '../../monitoring/statsEngine';
import { eventBus } from '../../core/eventBus';

/**
 * A minimal nested-layout squad fixture with a single member, used purely to
 * exercise the `command-queued` / `command-completed` -> statsEngine ->
 * `ctx.statistics` wiring (issue #7). Lives under the repo root (cleaned up
 * in teardown) rather than an OS temp dir, matching this suite's convention
 * of resolving fixture paths relative to `__dirname`.
 */
const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', '..', '.stats-engine-test-fixture');
const SQUAD_DIR = path.join(FIXTURE_ROOT, '.squad', 'squads', 'statsfixture');
const AGENT_NAME = 'StatsBot';

const TEAM_MD = `# Stats Fixture Team

## Members

| Name | Role | Charter | Status | Notes |
|------|------|---------|--------|-------|
| ${AGENT_NAME} | Tester | .squad/agents/statsbot/charter.md | ✅ Active | Fixture agent |
`;

suite('statsEngine: wired to command-queue lifecycle events', () => {
  suiteSetup(async () => {
    fs.mkdirSync(SQUAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(SQUAD_DIR, 'team.md'), TEAM_MD, 'utf-8');
    await squadRegistry.registerSquad(SQUAD_DIR, FIXTURE_ROOT);
  });

  suiteTeardown(() => {
    squadRegistry.unregisterSquad(SQUAD_DIR);
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test('queueing a command increments totalTasks for the agent and the squad', () => {
    const ctx = squadRegistry.getContext(SQUAD_DIR);
    assert.ok(ctx, 'fixture squad should be registered');

    const beforeTotal = statsEngine.getAgentStats(AGENT_NAME).totalTasks;
    const item = commandQueueManager.enqueue(AGENT_NAME, 'do something');

    assert.strictEqual(statsEngine.getAgentStats(AGENT_NAME).totalTasks, beforeTotal + 1);
    assert.strictEqual(ctx!.statistics.totalTasks, beforeTotal + 1);

    // Clean up this item so later assertions in this suite start fresh.
    commandQueueManager.markCompleted(item.id);
  });

  test('completing a command increments completedTasks and refreshes ctx.statistics', () => {
    const ctx = squadRegistry.getContext(SQUAD_DIR);
    assert.ok(ctx);

    const beforeCompleted = statsEngine.getAgentStats(AGENT_NAME).completedTasks;
    const item = commandQueueManager.enqueue(AGENT_NAME, 'ship the feature');
    commandQueueManager.markRunning(item.id);
    commandQueueManager.markCompleted(item.id, 'done');

    const agentStats = statsEngine.getAgentStats(AGENT_NAME);
    assert.strictEqual(agentStats.completedTasks, beforeCompleted + 1);

    assert.strictEqual(ctx!.statistics.completedTasks, beforeCompleted + 1);
    assert.strictEqual(ctx!.agents.get(AGENT_NAME)!.statistics.completedTasks, beforeCompleted + 1);
    // Health score is recomputed (not left at the empty-context default of 100).
    assert.strictEqual(ctx!.statistics.healthScore, statsEngine.getSquadStats([...ctx!.agents.values()]).healthScore);
  });

  test('a failed command increments failedTasks instead of completedTasks', () => {
    const ctx = squadRegistry.getContext(SQUAD_DIR);
    assert.ok(ctx);

    const beforeFailed = statsEngine.getAgentStats(AGENT_NAME).failedTasks;
    const item = commandQueueManager.enqueue(AGENT_NAME, 'a doomed task');
    commandQueueManager.markRunning(item.id);
    commandQueueManager.markFailed(item.id, 'boom');

    assert.strictEqual(statsEngine.getAgentStats(AGENT_NAME).failedTasks, beforeFailed + 1);
    assert.strictEqual(ctx!.statistics.failedTasks, beforeFailed + 1);
  });
});

suite('squadRegistry: agent-status propagation into active roster state (#6)', () => {
  suiteSetup(async () => {
    fs.mkdirSync(SQUAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(SQUAD_DIR, 'team.md'), TEAM_MD, 'utf-8');
    await squadRegistry.registerSquad(SQUAD_DIR, FIXTURE_ROOT);
  });

  suiteTeardown(() => {
    squadRegistry.unregisterSquad(SQUAD_DIR);
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test('emitting agent-status updates the runtime status and lastActivity in every context that has the agent', () => {
    const ctx = squadRegistry.getContext(SQUAD_DIR);
    assert.ok(ctx);

    const before = Date.now();
    eventBus.emit('agent-status', { agentName: AGENT_NAME, status: 'working' });

    const runtime = ctx!.agents.get(AGENT_NAME);
    assert.ok(runtime);
    assert.strictEqual(runtime!.status, 'working');
    assert.ok((runtime!.lastActivity ?? 0) >= before);
  });

  test('a second status change overwrites the previous one', () => {
    const ctx = squadRegistry.getContext(SQUAD_DIR);
    eventBus.emit('agent-status', { agentName: AGENT_NAME, status: 'idle' });
    assert.strictEqual(ctx!.agents.get(AGENT_NAME)!.status, 'idle');
  });
});
