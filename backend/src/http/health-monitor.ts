const DEGRADED_STATUSES = new Set([429, 500, 502, 503]);

type Outcome = "OK" | "DEGRADED" | "TIMEOUT";

interface HostHealth {
  outcomes: Outcome[]; // most recent `windowSize` outcomes, oldest first
  latencies: number[];
  timeoutCount: number;
  statusCounters: Record<number, number>;
}

export interface HealthMonitorOptions {
  /** How many of the most recent outcomes are considered. Default 5. */
  windowSize?: number;
  /** Bad outcomes within the window at/above this count means degraded. Default 3. */
  degradedThreshold?: number;
}

export interface HostHealthSnapshot {
  timeouts: number;
  statusCounters: Readonly<Record<number, number>>;
  averageLatencyMs: number | null;
  degraded: boolean;
}

/**
 * Tracks per-host latency, timeouts, and 429/500/502/503 responses over a
 * sliding window, and answers whether that host is currently degraded
 * enough that write-based tests should pause (reads are never paused by
 * this — see SecurityHttpClient).
 */
export class HealthMonitor {
  private readonly windowSize: number;
  private readonly degradedThreshold: number;
  private readonly hosts = new Map<string, HostHealth>();

  constructor(options: HealthMonitorOptions = {}) {
    this.windowSize = options.windowSize ?? 5;
    this.degradedThreshold = options.degradedThreshold ?? 3;
  }

  recordResponse(host: string, status: number, latencyMs: number): void {
    const state = this.stateFor(host);
    state.latencies.push(latencyMs);
    state.statusCounters[status] = (state.statusCounters[status] ?? 0) + 1;
    this.pushOutcome(state, DEGRADED_STATUSES.has(status) ? "DEGRADED" : "OK");
  }

  recordTimeout(host: string): void {
    const state = this.stateFor(host);
    state.timeoutCount++;
    this.pushOutcome(state, "TIMEOUT");
  }

  isDegraded(host: string): boolean {
    const state = this.hosts.get(host);
    if (!state) return false;
    const badCount = state.outcomes.filter((outcome) => outcome !== "OK").length;
    return badCount >= this.degradedThreshold;
  }

  snapshot(host: string): HostHealthSnapshot {
    const state = this.hosts.get(host);
    if (!state) return { timeouts: 0, statusCounters: {}, averageLatencyMs: null, degraded: false };
    const averageLatencyMs = state.latencies.length
      ? state.latencies.reduce((sum, value) => sum + value, 0) / state.latencies.length
      : null;
    return {
      timeouts: state.timeoutCount,
      statusCounters: { ...state.statusCounters },
      averageLatencyMs,
      degraded: this.isDegraded(host),
    };
  }

  private stateFor(host: string): HostHealth {
    let state = this.hosts.get(host);
    if (!state) {
      state = { outcomes: [], latencies: [], timeoutCount: 0, statusCounters: {} };
      this.hosts.set(host, state);
    }
    return state;
  }

  private pushOutcome(state: HostHealth, outcome: Outcome): void {
    state.outcomes.push(outcome);
    if (state.outcomes.length > this.windowSize) state.outcomes.shift();
  }
}
