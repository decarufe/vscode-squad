import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Regression coverage for the Squad Dashboard "command bar" (select agent ->
 * type command -> Send). `media/dashboard/dashboard.js` is plain webview
 * script (no bundler/DOM test harness in this repo), so this suite loads it
 * into a hand-rolled DOM stub via Node's built-in `vm` module rather than
 * pulling in a new dependency (e.g. jsdom) — consistent with the
 * "hand-rolled to avoid a runtime dependency" convention already used in
 * `suite/index.ts`.
 *
 * Bug report: selecting an agent card, typing a command, and clicking Send
 * does nothing — the queue stays empty and no terminal logs appear.
 *
 * Root cause found during investigation: `selectAgent()` (fired when an
 * agent card is clicked) only updates `state.selectedAgent` and the log
 * filter. It never syncs the command bar's `#cmd-agent-selector` <select>.
 * The Send button is disabled by `updateSendState()` whenever
 * `cmdAgentSelector.value` is empty, and `sendCommand()` also bails out when
 * `agent` is falsy — so clicking an agent card followed by Send is a no-op
 * even though the user visibly "selected" an agent.
 */

const DASHBOARD_JS_PATH = path.resolve(__dirname, '..', '..', '..', 'media', 'dashboard', 'dashboard.js');

interface FakeElement {
  tagName: string;
  children: FakeElement[];
  options: FakeElement[];
  textContent: string;
  value: string;
  disabled: boolean;
  hidden: boolean;
  style: Record<string, unknown>;
  scrollTop: number;
  scrollHeight: number;
  classList: {
    add: (...c: string[]) => void;
    remove: (...c: string[]) => void;
    toggle: (c: string) => void;
    contains: (c: string) => boolean;
  };
  className: string;
  appendChild: (child: FakeElement) => FakeElement;
  removeChild: (child: FakeElement) => void;
  remove: (index?: number) => void;
  addEventListener: (evt: string, fn: (payload?: unknown) => void) => void;
  removeEventListener: (evt: string, fn: (payload?: unknown) => void) => void;
  dispatch: (evt: string, payload?: unknown) => void;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  querySelector: () => null;
  firstChild: FakeElement | null;
}

function createFakeElement(tagName: string): FakeElement {
  const listeners: Record<string, Array<(payload?: unknown) => void>> = {};
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};

  const el: FakeElement = {
    tagName,
    children: [],
    options: [],
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    style: {},
    scrollTop: 0,
    scrollHeight: 0,
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      toggle: (c: string) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      contains: (c: string) => classes.has(c),
    },
    get className(): string {
      return [...classes].join(' ');
    },
    set className(v: string) {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    appendChild(child: FakeElement) {
      el.children.push(child);
      if (el.tagName === 'select') {
        el.options.push(child);
      }
      return child;
    },
    removeChild(child: FakeElement) {
      el.children = el.children.filter((c) => c !== child);
      el.options = el.options.filter((c) => c !== child);
    },
    remove(index?: number) {
      if (index === undefined) { return; }
      const removed = el.options.splice(index, 1)[0];
      if (removed) {
        el.children = el.children.filter((c) => c !== removed);
      }
    },
    addEventListener(evt: string, fn: (payload?: unknown) => void) {
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    removeEventListener(evt: string, fn: (payload?: unknown) => void) {
      listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn);
    },
    dispatch(evt: string, payload?: unknown) {
      (listeners[evt] || []).forEach((fn) => fn(payload));
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    querySelector() {
      return null;
    },
    get firstChild() {
      return el.children[0] ?? null;
    },
  } as unknown as FakeElement;

  return el;
}

/** Minimal DOM stub covering every element id/selector dashboard.js touches. */
function createDashboardSandbox() {
  const elementsById = new Map<string, FakeElement>();
  const ids = [
    'stats-bar', 'agent-list', 'log-entries', 'queue-list', 'loading', 'dashboard',
    'squad-name', 'squad-status', 'agent-count', 'log-count', 'queue-count',
    'cmd-input', 'cmd-agent-selector', 'cmd-send', 'filter-agent', 'filter-level',
  ];
  for (const id of ids) {
    const tag = id === 'cmd-agent-selector' || id === 'filter-agent' || id === 'filter-level' ? 'select' : 'div';
    const el = createFakeElement(tag);
    if (tag === 'select') {
      // Mirrors the HTML's static first "placeholder" option.
      el.appendChild(createFakeElement('option'));
    }
    elementsById.set(id, el);
  }

  const windowListeners: Record<string, Array<(payload?: unknown) => void>> = {};
  const postedMessages: unknown[] = [];

  const documentStub = {
    readyState: 'complete',
    getElementById: (id: string) => elementsById.get(id) ?? null,
    createElement: (tag: string) => createFakeElement(tag),
    querySelectorAll: () => [] as FakeElement[],
    addEventListener: () => undefined,
  };

  const windowStub: Record<string, unknown> = {
    addEventListener: (evt: string, fn: (payload?: unknown) => void) => {
      (windowListeners[evt] = windowListeners[evt] || []).push(fn);
    },
  };

  const sandbox: Record<string, unknown> = {
    document: documentStub,
    window: windowStub,
    console,
    setTimeout,
    clearTimeout,
    acquireVsCodeApi: () => ({
      postMessage: (msg: unknown) => postedMessages.push(msg),
    }),
  };
  vm.createContext(sandbox);

  return { sandbox, elementsById, windowListeners, postedMessages };
}

function loadDashboardScript(sandbox: Record<string, unknown>): void {
  const source = fs.readFileSync(DASHBOARD_JS_PATH, 'utf-8');
  vm.runInContext(source, sandbox, { filename: DASHBOARD_JS_PATH });
}

function simulateMessageFromHost(windowListeners: Record<string, Array<(payload?: unknown) => void>>, data: unknown): void {
  for (const fn of windowListeners['message'] || []) {
    fn({ data });
  }
}

suite('Dashboard command bar (webview script)', () => {
  test('selecting an agent card syncs the command-bar agent selector', () => {
    const { sandbox, elementsById, windowListeners } = createDashboardSandbox();
    loadDashboardScript(sandbox);

    simulateMessageFromHost(windowListeners, {
      type: 'state-update',
      data: {
        squadName: 'Test Squad',
        squadPath: '/tmp/squad',
        agents: [{ name: 'Tank', emoji: '🛠️', role: 'Builder', status: 'idle' }],
        logs: [],
        commandQueue: [],
        statistics: { totalAgents: 1, activeAgents: 0, totalTasks: 0, healthScore: 100 },
      },
    });

    const squadDashboard = sandbox.window as { squadDashboard?: { selectAgent: (name: string) => void } };
    assert.ok(squadDashboard.squadDashboard, 'dashboard.js should expose window.squadDashboard');

    // Simulate the user clicking the "Tank" agent card.
    squadDashboard.squadDashboard!.selectAgent('Tank');

    const cmdAgentSelector = elementsById.get('cmd-agent-selector')!;
    assert.strictEqual(
      cmdAgentSelector.value,
      'Tank',
      'selecting an agent card must sync the command-bar agent selector so Send can enable',
    );
  });

  test('select agent + type command + click Send enqueues exactly one command', () => {
    const { sandbox, elementsById, windowListeners, postedMessages } = createDashboardSandbox();
    loadDashboardScript(sandbox);

    simulateMessageFromHost(windowListeners, {
      type: 'state-update',
      data: {
        squadName: 'Test Squad',
        squadPath: '/tmp/squad',
        agents: [{ name: 'Tank', emoji: '🛠️', role: 'Builder', status: 'idle' }],
        logs: [],
        commandQueue: [],
        statistics: { totalAgents: 1, activeAgents: 0, totalTasks: 0, healthScore: 100 },
      },
    });

    const squadDashboard = sandbox.window as { squadDashboard?: { selectAgent: (name: string) => void } };
    squadDashboard.squadDashboard!.selectAgent('Tank');

    const cmdInput = elementsById.get('cmd-input')!;
    const cmdSend = elementsById.get('cmd-send')!;

    cmdInput.value = 'review src/index.ts';
    cmdInput.dispatch('input');

    assert.strictEqual(cmdSend.disabled, false, 'Send button should be enabled once agent + command are set');

    cmdSend.dispatch('click');

    const enqueueMessages = postedMessages.filter(
      (m): m is { type: string; agent: string; command: string } =>
        typeof m === 'object' && m !== null && (m as { type?: string }).type === 'enqueue-command',
    );

    assert.strictEqual(enqueueMessages.length, 1, 'Send should post exactly one enqueue-command message');
    assert.strictEqual(enqueueMessages[0].agent, 'Tank');
    assert.strictEqual(enqueueMessages[0].command, 'review src/index.ts');
  });
});
