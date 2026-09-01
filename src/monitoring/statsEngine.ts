import { AgentStatistics, SquadStatistics, AgentRuntime } from '../core/types';
import { eventBus } from '../core/eventBus';
import { squadRegistry } from '../core/squadRegistry';
import { commandQueueManager } from './commandQueue';

interface InternalStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  totalDurationMs: number;
  linesChanged: number;
  decisionsCount: number;
  lastActiveAt: number;
}

function emptyStats(): InternalStats {
  return {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    inProgressTasks: 0,
    totalDurationMs: 0,
    linesChanged: 0,
    decisionsCount: 0,
    lastActiveAt: 0,
  };
}

function toPublic(name: string, s: InternalStats): AgentStatistics {
  return {
    totalTasks: s.totalTasks,
    completedTasks: s.completedTasks,
    failedTasks: s.failedTasks,
    averageDuration: s.completedTasks > 0 ? s.totalDurationMs / s.completedTasks : 0,
    lastActiveAt: s.lastActiveAt,
    decisionsCount: s.decisionsCount,
    linesChanged: s.linesChanged,
  };
}

class StatsEngine {
  private agentStats = new Map<string, InternalStats>();

  private getOrCreate(agentName: string): InternalStats {
    let stats = this.agentStats.get(agentName);
    if (!stats) {
      stats = emptyStats();
      this.agentStats.set(agentName, stats);
    }
    return stats;
  }

  recordTaskStart(agentName: string): void {
    const stats = this.getOrCreate(agentName);
    stats.totalTasks++;
    stats.inProgressTasks++;
    stats.lastActiveAt = Date.now();
  }

  recordTaskComplete(agentName: string, durationMs: number, linesChanged?: number): void {
    const stats = this.getOrCreate(agentName);
    stats.completedTasks++;
    stats.inProgressTasks = Math.max(0, stats.inProgressTasks - 1);
    stats.totalDurationMs += durationMs;
    stats.linesChanged += linesChanged ?? 0;
    stats.lastActiveAt = Date.now();
  }

  recordTaskFailure(agentName: string): void {
    const stats = this.getOrCreate(agentName);
    stats.failedTasks++;
    stats.inProgressTasks = Math.max(0, stats.inProgressTasks - 1);
    stats.lastActiveAt = Date.now();
  }

  recordDecision(agentName: string): void {
    const stats = this.getOrCreate(agentName);
    stats.decisionsCount++;
    stats.lastActiveAt = Date.now();
  }

  getAgentStats(agentName: string): AgentStatistics {
    return toPublic(agentName, this.getOrCreate(agentName));
  }

  getSquadStats(agents: AgentRuntime[]): SquadStatistics {
    let totalTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;
    let lastActivityAt = 0;

    const activeAgents = agents.filter((a) => a.status !== 'offline').length;

    for (const agent of agents) {
      const s = this.getOrCreate(agent.name);
      totalTasks += s.totalTasks;
      completedTasks += s.completedTasks;
      failedTasks += s.failedTasks;
      if (s.lastActiveAt > lastActivityAt) {
        lastActivityAt = s.lastActiveAt;
      }
    }

    return {
      totalAgents: agents.length,
      activeAgents,
      totalTasks,
      completedTasks,
      failedTasks,
      healthScore: this.computeHealthScore(agents),
      lastActivityAt,
    };
  }

  computeHealthScore(agents: AgentRuntime[]): number {
    if (agents.length === 0) {
      return 0;
    }

    const now = Date.now();
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

    let utilizationScore = 0;
    let errorScore = 0;
    let freshnessScore = 0;
    let counted = 0;

    for (const agent of agents) {
      if (agent.status === 'offline') {
        continue;
      }
      counted++;

      // Utilization: active/working > idle
      utilizationScore += agent.status === 'active' || agent.status === 'working' ? 1 : 0.5;

      // Error rate: lower is better (derive from statistics)
      const totalForAgent = agent.statistics.completedTasks + agent.statistics.failedTasks;
      const agentErrorRate = totalForAgent > 0 ? agent.statistics.failedTasks / totalForAgent : 0;
      errorScore += 1 - Math.min(agentErrorRate, 1);

      // Freshness: recent activity is better
      const age = now - (agent.lastActivity ?? 0);
      freshnessScore += age < STALE_THRESHOLD_MS ? 1 : Math.max(0, 1 - age / (STALE_THRESHOLD_MS * 4));
    }

    if (counted === 0) {
      return 0;
    }

    const utilization = (utilizationScore / counted) * 40;
    const errors = (errorScore / counted) * 35;
    const freshness = (freshnessScore / counted) * 25;

    return Math.round(Math.min(100, Math.max(0, utilization + errors + freshness)));
  }
}

export const statsEngine = new StatsEngine();

/**
 * Push the latest per-agent stats (from this engine) and the recomputed
 * squad-wide aggregate into every squad context that has `agentName`, then
 * notify listeners. This is the only place `ctx.statistics` and an agent's
 * `AgentRuntime.statistics` get refreshed, so dashboards, the status bar
 * health indicator, and `@squad /status` all see numbers that reflect real
 * command-queue activity instead of the empty defaults set at registration.
 */
function refreshSquadStatistics(agentName: string): void {
  const latestAgentStats = statsEngine.getAgentStats(agentName);
  for (const ctx of squadRegistry.allContexts) {
    const runtime = ctx.agents.get(agentName);
    if (!runtime) {
      continue;
    }
    runtime.statistics = latestAgentStats;
    // Take the more recent of the two freshness signals: a status change
    // (tracked on `runtime.lastActivity` by squadRegistry) or task activity
    // (tracked here). Never let a stale task timestamp regress a fresher
    // status-driven one, or vice versa.
    runtime.lastActivity = Math.max(runtime.lastActivity ?? 0, latestAgentStats.lastActiveAt || 0);
    ctx.statistics = statsEngine.getSquadStats([...ctx.agents.values()]);
    eventBus.emit('stats-updated', { agentName, stats: ctx.statistics });
  }
}

// A command being queued is a new unit of work for its agent.
eventBus.on('command-queued', ({ item }) => {
  statsEngine.recordTaskStart(item.agentName);
  refreshSquadStatistics(item.agentName);
});

// A command reaching a terminal state (success/failure) is what actually
// moves `completedTasks`/`failedTasks` and, in turn, the health score.
eventBus.on('command-completed', ({ id, result }) => {
  const item = commandQueueManager.getQueue().find((i) => i.id === id);
  if (!item) {
    return;
  }
  const startedAt = item.startedAt ?? item.createdAt;
  const completedAt = item.completedAt ?? Date.now();
  const durationMs = Math.max(0, completedAt - startedAt);
  if (result === 'success') {
    statsEngine.recordTaskComplete(item.agentName, durationMs);
  } else {
    statsEngine.recordTaskFailure(item.agentName);
  }
  refreshSquadStatistics(item.agentName);
});

// Status changes (active/working/idle/error/offline) feed the health
// score's utilization/freshness components — recompute so it stays live
// instead of only updating whenever a task happens to complete next.
eventBus.on('agent-status', ({ agentName }) => {
  refreshSquadStatistics(agentName);
});
