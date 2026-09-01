import * as assert from 'assert';
import { commandQueueManager } from '../../monitoring/commandQueue';
import { eventBus } from '../../core/eventBus';
import type { CommandQueueItem } from '../../core/types';

/**
 * Each test uses a unique agent name so `getQueueForAgent` can isolate its
 * own items — `commandQueueManager` is a process-wide singleton and its
 * queue is never fully reset between tests (only `clearCompleted` removes
 * `completed` items).
 */
function uniqueAgent(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

suite('CommandQueueManager', () => {
  test('enqueue creates a queued item and emits command-queued', () => {
    const agent = uniqueAgent('enqueue');
    const emitted: CommandQueueItem[] = [];
    const listener = (data: { item: CommandQueueItem }) => emitted.push(data.item);
    eventBus.on('command-queued', listener);

    try {
      const item = commandQueueManager.enqueue(agent, 'do-thing', ['a', 'b']);

      assert.strictEqual(item.agentName, agent);
      assert.strictEqual(item.command, 'do-thing');
      assert.deepStrictEqual(item.args, ['a', 'b']);
      assert.strictEqual(item.status, 'queued');
      assert.ok(item.id, 'item should have an id');
      assert.ok(item.createdAt > 0, 'item should have a createdAt timestamp');

      assert.strictEqual(emitted.length, 1);
      assert.strictEqual(emitted[0].id, item.id);

      const queueForAgent = commandQueueManager.getQueueForAgent(agent);
      assert.strictEqual(queueForAgent.length, 1);
      assert.strictEqual(queueForAgent[0].id, item.id);
    } finally {
      eventBus.off('command-queued', listener);
      commandQueueManager.markFailed(commandQueueManager.getQueueForAgent(agent)[0].id, 'test cleanup');
    }
  });

  test('enqueue defaults args to an empty array when omitted', () => {
    const agent = uniqueAgent('enqueue-noargs');
    const item = commandQueueManager.enqueue(agent, 'do-thing');
    assert.deepStrictEqual(item.args, []);
    commandQueueManager.markFailed(item.id, 'test cleanup');
  });

  test('markRunning transitions queued -> running and sets startedAt', () => {
    const agent = uniqueAgent('running');
    const item = commandQueueManager.enqueue(agent, 'do-thing');

    commandQueueManager.markRunning(item.id);

    const [found] = commandQueueManager.getQueueForAgent(agent);
    assert.strictEqual(found.status, 'running');
    assert.ok(found.startedAt && found.startedAt > 0);

    commandQueueManager.markFailed(item.id, 'test cleanup');
  });

  test('markRunning on an unknown id is a no-op', () => {
    // Should not throw.
    assert.doesNotThrow(() => commandQueueManager.markRunning('does-not-exist'));
  });

  test('markCompleted transitions running -> completed, sets result, and emits command-completed', () => {
    const agent = uniqueAgent('completed');
    const item = commandQueueManager.enqueue(agent, 'do-thing');
    commandQueueManager.markRunning(item.id);

    const emitted: { id: string; result: 'success' | 'failure' }[] = [];
    const listener = (data: { id: string; result: 'success' | 'failure' }) => emitted.push(data);
    eventBus.on('command-completed', listener);

    try {
      commandQueueManager.markCompleted(item.id, 'all good');

      const [found] = commandQueueManager.getQueueForAgent(agent);
      assert.strictEqual(found.status, 'completed');
      assert.strictEqual(found.result, 'all good');
      assert.ok(found.completedAt && found.completedAt > 0);

      assert.strictEqual(emitted.length, 1);
      assert.strictEqual(emitted[0].id, item.id);
      assert.strictEqual(emitted[0].result, 'success');
    } finally {
      eventBus.off('command-completed', listener);
    }
  });

  test('markCompleted is idempotent once already terminal (no duplicate event)', () => {
    const agent = uniqueAgent('completed-twice');
    const item = commandQueueManager.enqueue(agent, 'do-thing');
    commandQueueManager.markCompleted(item.id, 'first');

    const emitted: unknown[] = [];
    const listener = (data: unknown) => emitted.push(data);
    eventBus.on('command-completed', listener);

    try {
      commandQueueManager.markCompleted(item.id, 'second');
      const [found] = commandQueueManager.getQueueForAgent(agent);
      // Original result is preserved; the second call is a no-op.
      assert.strictEqual(found.result, 'first');
      assert.strictEqual(emitted.length, 0);
    } finally {
      eventBus.off('command-completed', listener);
    }
  });

  test('markFailed transitions running -> failed, sets error, and emits command-completed with failure', () => {
    const agent = uniqueAgent('failed');
    const item = commandQueueManager.enqueue(agent, 'do-thing');
    commandQueueManager.markRunning(item.id);

    const emitted: { id: string; result: 'success' | 'failure' }[] = [];
    const listener = (data: { id: string; result: 'success' | 'failure' }) => emitted.push(data);
    eventBus.on('command-completed', listener);

    try {
      commandQueueManager.markFailed(item.id, 'boom');

      const [found] = commandQueueManager.getQueueForAgent(agent);
      assert.strictEqual(found.status, 'failed');
      assert.strictEqual(found.error, 'boom');
      assert.ok(found.completedAt && found.completedAt > 0);

      assert.strictEqual(emitted.length, 1);
      assert.strictEqual(emitted[0].id, item.id);
      assert.strictEqual(emitted[0].result, 'failure');
    } finally {
      eventBus.off('command-completed', listener);
    }
  });

  test('markFailed does not override an already-completed item', () => {
    const agent = uniqueAgent('failed-after-completed');
    const item = commandQueueManager.enqueue(agent, 'do-thing');
    commandQueueManager.markCompleted(item.id, 'done');

    commandQueueManager.markFailed(item.id, 'too late');

    const [found] = commandQueueManager.getQueueForAgent(agent);
    assert.strictEqual(found.status, 'completed');
    assert.strictEqual(found.error, undefined);
  });

  test('getPending returns only queued and running items', () => {
    const agent = uniqueAgent('pending');
    const queued = commandQueueManager.enqueue(agent, 'queued-cmd');
    const running = commandQueueManager.enqueue(agent, 'running-cmd');
    const completed = commandQueueManager.enqueue(agent, 'completed-cmd');
    const failed = commandQueueManager.enqueue(agent, 'failed-cmd');

    commandQueueManager.markRunning(running.id);
    commandQueueManager.markCompleted(completed.id);
    commandQueueManager.markFailed(failed.id, 'err');

    const pendingIds = commandQueueManager
      .getPending()
      .filter((i) => i.agentName === agent)
      .map((i) => i.id);

    assert.deepStrictEqual(new Set(pendingIds), new Set([queued.id, running.id]));

    commandQueueManager.markFailed(queued.id, 'test cleanup');
    commandQueueManager.markFailed(running.id, 'test cleanup');
  });

  test('clearCompleted removes only completed items, leaving queued/running/failed untouched', () => {
    const agent = uniqueAgent('clear-completed');
    const queued = commandQueueManager.enqueue(agent, 'queued-cmd');
    const running = commandQueueManager.enqueue(agent, 'running-cmd');
    const completed = commandQueueManager.enqueue(agent, 'completed-cmd');
    const failed = commandQueueManager.enqueue(agent, 'failed-cmd');

    commandQueueManager.markRunning(running.id);
    commandQueueManager.markCompleted(completed.id);
    commandQueueManager.markFailed(failed.id, 'err');

    commandQueueManager.clearCompleted();

    const remainingIds = commandQueueManager
      .getQueueForAgent(agent)
      .map((i) => i.id);

    assert.ok(!remainingIds.includes(completed.id), 'completed item should be cleared');
    assert.ok(remainingIds.includes(queued.id), 'queued item should remain');
    assert.ok(remainingIds.includes(running.id), 'running item should remain');
    assert.ok(remainingIds.includes(failed.id), 'failed item should remain');

    commandQueueManager.markFailed(queued.id, 'test cleanup');
    commandQueueManager.markFailed(running.id, 'test cleanup');
  });

  test('getQueue returns a snapshot copy, not a live reference', () => {
    const agent = uniqueAgent('snapshot');
    const item = commandQueueManager.enqueue(agent, 'do-thing');

    const snapshot = commandQueueManager.getQueue();
    const lengthBefore = snapshot.length;
    snapshot.push({ ...item, id: 'mutated-copy' });

    assert.strictEqual(commandQueueManager.getQueue().length, lengthBefore);

    commandQueueManager.markFailed(item.id, 'test cleanup');
  });
});
