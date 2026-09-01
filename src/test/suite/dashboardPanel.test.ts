import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import { DashboardPanel } from '../../webview/dashboardPanel';
import { squadRegistry } from '../../core/squadRegistry';
import { commandQueueManager } from '../../monitoring/commandQueue';

/**
 * Regression test for the Squad Dashboard "Send does nothing" bug.
 *
 * Symptom: a user selects an agent, types a command, clicks Send — the
 * command queue stays empty and no logs appear. Root cause had two parts:
 *   1. `media/dashboard/dashboard.js` — the agent-list cards and the command
 *      bar's `<select>` were unsynchronized, so the Send button stayed
 *      disabled (silently swallowing the click) unless the dropdown itself
 *      was used.
 *   2. `dashboardPanel.ts` — even once `enqueue-command` reached the host,
 *      the handler only called `commandQueueManager.enqueue(...)` and never
 *      dispatched the item to `copilotExecutor`, so it sat at `"queued"`
 *      forever with no log output.
 *
 * This test exercises (2): the host-side message handler. Part (1) is
 * front-end-only DOM wiring with no Node-side harness in this repo.
 */
suite('DashboardPanel — enqueue-command dispatch', () => {
  const realSquadDir = path.resolve(__dirname, '..', '..', '..', '.squad');

  suiteSetup(async () => {
    await squadRegistry.registerSquad(realSquadDir);
  });

  test('enqueue-command dispatches the task instead of leaving it queued forever', async function () {
    this.timeout(20000);

    const ext = vscode.extensions.getExtension('amih90.vscode-squad');
    assert.ok(ext, 'expected the squad extension to be discoverable in the test host');

    const panel = DashboardPanel.createOrShow(ext!.extensionUri);
    const agentName = 'Morpheus';
    const command = `dashboard-send-bridge-test-${Date.now()}`;

    // There is no public API for posting a webview message in-process, so
    // this reaches into the private handler the same way
    // `webview.onDidReceiveMessage` does at runtime.
    (panel as unknown as { handleWebviewMessage: (msg: unknown) => void }).handleWebviewMessage({
      type: 'enqueue-command',
      agent: agentName,
      command,
    });

    const findItem = () =>
      commandQueueManager.getQueue().find((i) => i.command === command && i.agentName === agentName);

    const queued = findItem();
    assert.ok(queued, 'enqueue-command should immediately add an item to the queue');
    // The dispatch to copilotExecutor happens synchronously up to its first
    // `await`, so the item may already have moved past "queued" (e.g. to
    // "running") by the time we read it here — that's fine, and itself
    // evidence the fix works. Only "queued" forever would indicate a bug.

    // Before the fix, nothing ever dispatched the item to copilotExecutor,
    // so it stayed "queued" indefinitely. Poll briefly for it to move past
    // that state, proving the dispatch call actually happened.
    const deadline = Date.now() + 15000;
    let item = findItem();
    while (item && item.status === 'queued' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      item = findItem();
    }

    assert.ok(item, 'queue item should still be present');
    assert.notStrictEqual(
      item!.status,
      'queued',
      'enqueue-command must dispatch to copilotExecutor so the item progresses past "queued" ' +
        '(regression test for the dashboard Send-does-nothing bug)',
    );

    if (item!.status !== 'completed' && item!.status !== 'failed') {
      commandQueueManager.markFailed(item!.id, 'test cleanup');
    }
  });
});
