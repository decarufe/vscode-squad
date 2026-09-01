import * as vscode from 'vscode';
import { CommandQueueItem } from '../core/types';
import { eventBus } from '../core/eventBus';

let idCounter = 0;

function nextId(): string {
  return `cmd-${Date.now()}-${++idCounter}`;
}

const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 120;

function getExecutionTimeoutMs(): number {
  const seconds = vscode.workspace
    .getConfiguration('squad')
    .get<number>('execution.timeoutSeconds', DEFAULT_EXECUTION_TIMEOUT_SECONDS);
  return Math.max(1, seconds) * 1000;
}

class CommandQueueManager {
  private queue: CommandQueueItem[] = [];

  /**
   * Watchdog timers keyed by queue item id. This guarantees every "running"
   * item eventually reaches a terminal state on its own — resolution must
   * never depend on Copilot sending a callback such as `@squad /complete`
   * or `@squad /progress`. If nothing marks the item completed/failed within
   * the configured timeout, the watchdog fails it with a clear reason.
   */
  private watchdogs = new Map<string, ReturnType<typeof setTimeout>>();

  enqueue(agentName: string, command: string, args?: string[]): CommandQueueItem {
    const item: CommandQueueItem = {
      id: nextId(),
      agentName,
      command,
      args: args ?? [],
      status: 'queued',
      createdAt: Date.now(),
    };
    this.queue.push(item);
    eventBus.emit('command-queued', { item });
    return item;
  }

  markRunning(id: string): void {
    const item = this.queue.find((i) => i.id === id);
    if (item) {
      item.status = 'running';
      item.startedAt = Date.now();
      this.armWatchdog(id);
    }
  }

  markCompleted(id: string, result?: string): void {
    this.clearWatchdog(id);
    const item = this.queue.find((i) => i.id === id);
    if (item && item.status !== 'completed' && item.status !== 'failed') {
      item.status = 'completed';
      item.completedAt = Date.now();
      item.result = result;
      eventBus.emit('command-completed', { id, result: 'success' });
    }
  }

  markFailed(id: string, error?: string): void {
    this.clearWatchdog(id);
    const item = this.queue.find((i) => i.id === id);
    if (item && item.status !== 'completed' && item.status !== 'failed') {
      item.status = 'failed';
      item.completedAt = Date.now();
      item.error = error;
      eventBus.emit('command-completed', { id, result: 'failure' });
    }
  }

  getQueue(): CommandQueueItem[] {
    return [...this.queue];
  }

  getQueueForAgent(agentName: string): CommandQueueItem[] {
    return this.queue.filter((i) => i.agentName === agentName);
  }

  getPending(): CommandQueueItem[] {
    return this.queue.filter((i) => i.status === 'queued' || i.status === 'running');
  }

  clearCompleted(): void {
    const remaining: CommandQueueItem[] = [];
    for (const item of this.queue) {
      if (item.status === 'completed') {
        this.clearWatchdog(item.id);
      } else {
        remaining.push(item);
      }
    }
    this.queue = remaining;
  }

  /** Cancel all pending watchdog timers (call on extension deactivation). */
  dispose(): void {
    for (const timer of this.watchdogs.values()) {
      clearTimeout(timer);
    }
    this.watchdogs.clear();
  }

  private armWatchdog(id: string): void {
    this.clearWatchdog(id);
    const timeoutMs = getExecutionTimeoutMs();
    const timer = setTimeout(() => {
      this.watchdogs.delete(id);
      const item = this.queue.find((i) => i.id === id);
      if (item && item.status === 'running') {
        this.markFailed(
          id,
          `Execution timed out after ${Math.round(timeoutMs / 1000)}s without a result.`,
        );
      }
    }, timeoutMs);
    this.watchdogs.set(id, timer);
  }

  private clearWatchdog(id: string): void {
    const timer = this.watchdogs.get(id);
    if (timer) {
      clearTimeout(timer);
      this.watchdogs.delete(id);
    }
  }
}

export const commandQueueManager = new CommandQueueManager();
