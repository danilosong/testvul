/**
 * Rate-limiting collaborator in the SecurityHttpClient pipeline. `run`
 * wraps acquire+release into one call so a caller can never forget to
 * release a concurrency slot.
 */
export interface RateLimiter {
  run<T>(host: string, task: () => Promise<T>): Promise<T>;
}

export class NoopRateLimiter implements RateLimiter {
  async run<T>(_host: string, task: () => Promise<T>): Promise<T> {
    return task();
  }
}

interface HostState {
  lastRequestStartedAt: number;
  activeCount: number;
  waiters: Array<() => void>;
}

export interface HostRateLimiterOptions {
  /** Default 2 — matches the tool-wide default rate limit. */
  requestsPerSecond?: number;
  /** Default 2. The Safe-Automatic-mode cap of 10 is a scan-orchestration
   * policy decision about what value to pass here, not something this
   * class enforces itself. */
  concurrency?: number;
}

/**
 * Per-host request pacing (minimum interval between request *starts*) and
 * concurrency limiting (maximum simultaneously in-flight requests), tracked
 * independently for each host so one slow/busy host never throttles
 * another.
 */
export class HostRateLimiter implements RateLimiter {
  private readonly requestsPerSecond: number;
  private readonly concurrency: number;
  private readonly hosts = new Map<string, HostState>();

  constructor(options: HostRateLimiterOptions = {}) {
    this.requestsPerSecond = options.requestsPerSecond ?? 2;
    this.concurrency = options.concurrency ?? 2;
  }

  async run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const state = this.stateFor(host);
    await this.acquireConcurrencySlot(state);
    try {
      await this.waitForPacingSlot(state);
      return await task();
    } finally {
      state.activeCount--;
      const next = state.waiters.shift();
      if (next) next();
    }
  }

  private stateFor(host: string): HostState {
    let state = this.hosts.get(host);
    if (!state) {
      state = { lastRequestStartedAt: 0, activeCount: 0, waiters: [] };
      this.hosts.set(host, state);
    }
    return state;
  }

  /**
   * The check and the increment must happen in the same synchronous step —
   * splitting them (check now, increment after an `await`) would let a
   * burst of synchronous calls all observe the same stale `activeCount`
   * before any of them incremented it.
   */
  private acquireConcurrencySlot(state: HostState): Promise<void> {
    if (state.activeCount < this.concurrency) {
      state.activeCount++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      state.waiters.push(() => {
        state.activeCount++;
        resolve();
      });
    });
  }

  private async waitForPacingSlot(state: HostState): Promise<void> {
    const minIntervalMs = 1000 / this.requestsPerSecond;
    const now = Date.now();
    const earliestStart = state.lastRequestStartedAt + minIntervalMs;
    const waitMs = Math.max(0, earliestStart - now);
    state.lastRequestStartedAt = Math.max(now, earliestStart);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
