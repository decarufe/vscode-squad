import * as vscode from 'vscode';
import { squadRegistry } from '../core/squadRegistry';
import { commandQueueManager } from './commandQueue';
import { logStore } from './logStore';
import { eventBus } from '../core/eventBus';
import { log } from '../utils/logger';
import type { AgentRuntime } from '../core/types';

const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 120;
const RESULT_LINE_PATTERN = /RESULT:\s*(SUCCESS|FAILURE)\b\s*(.*)$/im;
const SUMMARY_MAX_LENGTH = 500;

/**
 * Raised when GitHub Copilot Chat has no usable language model available
 * (not installed, not signed in, disabled, or quota/consent denied).
 */
export class CopilotUnavailableError extends Error {
  constructor(
    message = 'GitHub Copilot Chat is unavailable. Install/enable the GitHub Copilot Chat extension, sign in, and try again.',
  ) {
    super(message);
    this.name = 'CopilotUnavailableError';
  }
}

/**
 * Executes queued commands by sending them directly to a Copilot language
 * model via `vscode.lm` and awaiting the response.
 *
 * Unlike the previous implementation (which opened the chat UI and relied on
 * Copilot echoing back `@squad /complete` / `@squad /progress` messages),
 * this request/response round trip is awaited in-process. A queue item's
 * resolution therefore never depends on a model callback: it resolves as
 * soon as the language model finishes responding, fails immediately if
 * Copilot Chat isn't available, and is guarded by `commandQueueManager`'s
 * watchdog timeout as a last resort.
 */
export class CopilotExecutor {
  /**
   * Execute a task for a specific agent via Copilot
   */
  async executeTask(
    agentName: string,
    task: string,
    queueItemId?: string
  ): Promise<void> {
    const ctx = squadRegistry.activeContext;
    if (!ctx) {
      this.failQueueItem(queueItemId, 'No active squad');
      throw new Error('No active squad');
    }

    const agent = ctx.agents.get(agentName);
    if (!agent) {
      this.failQueueItem(queueItemId, `Agent not found: ${agentName}`);
      throw new Error(`Agent not found: ${agentName}`);
    }

    // Mark queue item as running (arms the watchdog timeout)
    if (queueItemId) {
      commandQueueManager.markRunning(queueItemId);
    }

    // Update agent status to working
    eventBus.emit('agent-status', { agentName, status: 'working' });

    try {
      const prompt = this.buildPrompt(agentName, agent, task);
      const responseText = await this.sendToCopilot(prompt, agentName);
      this.resolveQueueItem(queueItemId, responseText);
      vscode.window.showInformationMessage(`Squad: ${agentName} finished the task`);
    } catch (error) {
      const message = this.describeError(error);
      this.failQueueItem(queueItemId, message);
      this.reportFailure(agentName, message);
    } finally {
      eventBus.emit('agent-status', { agentName, status: 'idle' });
    }
  }

  /**
   * Execute a task for the entire squad
   */
  async executeSquadTask(task: string, queueItemIds: string[]): Promise<void> {
    const ctx = squadRegistry.activeContext;
    if (!ctx) {
      queueItemIds.forEach(id => commandQueueManager.markFailed(id, 'No active squad'));
      throw new Error('No active squad');
    }

    const agents = Array.from(ctx.agents.entries());
    const agentSummary = agents
      .map(([name, agent]) => `- **${name}** (${agent.role})`)
      .join('\n');

    const prompt = `## Squad Task

You are coordinating a squad of ${agents.length} AI agents for this task.

### Squad Members:
${agentSummary}

### Task:
${task}

### Execution Rules:
1. Analyze the task and determine which agent(s) should handle it based on their roles
2. Execute the task, working within the scope of the appropriate agent's responsibilities
3. If the task spans multiple agents, break it down and handle each part according to the relevant agent's charter
4. End your response with a single line: \`RESULT: SUCCESS <short summary>\` or \`RESULT: FAILURE <reason>\`

Begin now.`;

    // Mark all queue items as running (arms their watchdog timeouts)
    queueItemIds.forEach(id => commandQueueManager.markRunning(id));

    // Update all agents to working
    agents.forEach(([name]) => {
      eventBus.emit('agent-status', { agentName: name, status: 'working' });
    });

    try {
      const responseText = await this.sendToCopilot(prompt, 'Squad');
      const { success, summary } = this.parseOutcome(responseText);
      queueItemIds.forEach(id => {
        if (success) {
          commandQueueManager.markCompleted(id, summary);
        } else {
          commandQueueManager.markFailed(id, summary);
        }
      });
      vscode.window.showInformationMessage('Squad: Task finished for all agents');
    } catch (error) {
      const message = this.describeError(error);
      queueItemIds.forEach(id => commandQueueManager.markFailed(id, message));
      this.reportFailure('Squad', message);
    } finally {
      agents.forEach(([name]) => {
        eventBus.emit('agent-status', { agentName: name, status: 'idle' });
      });
    }
  }

  /**
   * Build a prompt with the agent's charter context
   */
  private buildPrompt(
    agentName: string,
    agent: AgentRuntime,
    task: string
  ): string {
    const charterSection = agent.charter
      ? `### Your Charter:\n${agent.charter}`
      : '';

    return `## Agent Task Assignment

You are acting as **${agentName}**, a ${agent.role} agent.

${charterSection}

### Your Task:
${task}

### Execution Rules:
- Work within your role as ${agent.role}
- Follow best practices for your role
- End your response with a single line: \`RESULT: SUCCESS <short summary>\` or \`RESULT: FAILURE <reason>\`

Begin now.`;
  }

  /**
   * Send a prompt directly to a Copilot chat model and await the full
   * response text. Using `vscode.lm` instead of opening the chat UI gives a
   * deterministic completion signal: the returned promise/stream settles
   * when the model is done, so callers never have to wait on a chat message
   * being typed back by the model.
   */
  private async sendToCopilot(prompt: string, contextLabel: string): Promise<string> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      throw new CopilotUnavailableError();
    }
    const model = models[0];

    const timeoutSeconds = vscode.workspace
      .getConfiguration('squad')
      .get<number>('execution.timeoutSeconds', DEFAULT_EXECUTION_TIMEOUT_SECONDS);
    const cts = new vscode.CancellationTokenSource();
    const timer = setTimeout(() => cts.cancel(), Math.max(1, timeoutSeconds) * 1000);

    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        { justification: `Squad needs to run a task for ${contextLabel}` },
        cts.token,
      );

      let fullText = '';
      for await (const chunk of response.text) {
        fullText += chunk;
      }

      if (cts.token.isCancellationRequested) {
        throw new Error(`Copilot did not respond within ${timeoutSeconds}s; execution was cancelled.`);
      }

      logStore.addEntry({
        agentName: contextLabel,
        level: 'info',
        message: this.truncate(fullText || '(empty response)'),
        timestamp: Date.now(),
      });

      return fullText;
    } catch (error) {
      if (cts.token.isCancellationRequested) {
        throw new Error(`Copilot did not respond within ${timeoutSeconds}s; execution was cancelled.`);
      }
      if (error instanceof vscode.LanguageModelError) {
        throw new CopilotUnavailableError(`GitHub Copilot Chat request failed: ${error.message}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      cts.dispose();
    }
  }

  private resolveQueueItem(queueItemId: string | undefined, responseText: string): void {
    if (!queueItemId) {
      return;
    }
    const { success, summary } = this.parseOutcome(responseText);
    if (success) {
      commandQueueManager.markCompleted(queueItemId, summary);
    } else {
      commandQueueManager.markFailed(queueItemId, summary);
    }
  }

  private failQueueItem(queueItemId: string | undefined, message: string): void {
    if (queueItemId) {
      commandQueueManager.markFailed(queueItemId, message);
    }
  }

  /**
   * Determine success/failure from the model's response. Defaults to
   * success — the item is resolved either way because the request/response
   * round trip has already completed; this only refines the outcome.
   */
  private parseOutcome(responseText: string): { success: boolean; summary: string } {
    const match = responseText.match(RESULT_LINE_PATTERN);
    if (match) {
      const success = match[1].toUpperCase() === 'SUCCESS';
      const summary = match[2]?.trim() || (success ? 'Completed' : 'Failed');
      return { success, summary: this.truncate(summary) };
    }
    return { success: true, summary: this.truncate(responseText.trim() || 'Completed') };
  }

  private truncate(text: string): string {
    return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text;
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private reportFailure(contextLabel: string, message: string): void {
    log(`Copilot execution failed for ${contextLabel}: ${message}`);
    vscode.window.showErrorMessage(`Squad: ${message}`);
  }
}

export const copilotExecutor = new CopilotExecutor();
