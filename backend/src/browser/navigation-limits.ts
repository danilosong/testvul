export interface NavigationLimits {
  maxPages: number;
  maxActions: number;
  maxRuntimeMs: number;
  maxDepth: number;
  maxNetworkRequestsPerPage: number;
}

export const DEFAULT_NAVIGATION_LIMITS: NavigationLimits = {
  maxPages: 200,
  maxActions: 500,
  maxRuntimeMs: 10 * 60 * 1000,
  maxDepth: 10,
  maxNetworkRequestsPerPage: 200,
};

/**
 * Browser Navigation Limits (Section 12.29): bounds how much the Browser
 * Security Testing Engine will ever navigate/act on, and detects a
 * repeated route (SPA navigation-loop detection) so the same route is
 * never re-visited — the same category of protection Section 4's crawler
 * already applies to plain HTTP discovery, applied here to browser-driven
 * navigation instead.
 */
export class NavigationLimitTracker {
  private readonly visitedRoutes = new Set<string>();
  private pagesVisited = 0;
  private actionsExecuted = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: NavigationLimits = DEFAULT_NAVIGATION_LIMITS,
    now: number = Date.now(),
  ) {
    this.startedAt = now;
  }

  /** True when this route has already been visited, or any page/depth/runtime limit has already been reached — the caller must not navigate to it. */
  shouldSkip(route: string, depth: number, now: number = Date.now()): boolean {
    if (this.visitedRoutes.has(route)) return true;
    if (this.pagesVisited >= this.limits.maxPages) return true;
    if (depth > this.limits.maxDepth) return true;
    if (now - this.startedAt >= this.limits.maxRuntimeMs) return true;
    return false;
  }

  recordVisit(route: string): void {
    this.visitedRoutes.add(route);
    this.pagesVisited++;
  }

  /** True if an action may still be executed within `maxActions`; also records it. */
  recordAction(): boolean {
    if (this.actionsExecuted >= this.limits.maxActions) return false;
    this.actionsExecuted++;
    return true;
  }

  get pagesVisitedCount(): number {
    return this.pagesVisited;
  }
}
