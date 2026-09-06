import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NavigationLimitTracker } from "./navigation-limits";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
});

afterAll(async () => {
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

const DEFAULT_LIMITS_FOR_TEST = { maxPages: 200, maxActions: 500, maxRuntimeMs: 600_000, maxDepth: 10, maxNetworkRequestsPerPage: 200 };

describe("Browser Navigation Limits against the fixture app's endlessly-paginating route (Section 12.29)", () => {
  it("stops re-visiting a route that would otherwise loop forever, within the configured maxPages limit", async () => {
    const tracker = new NavigationLimitTracker({
      maxPages: 5,
      maxActions: 100,
      maxRuntimeMs: 60_000,
      maxDepth: 100,
      maxNetworkRequestsPerPage: 100,
    });

    let page = 1;
    let iterations = 0;
    const visitedPages: number[] = [];

    // /paginate?page=N always returns { nextPage: N + 1 } — a route that
    // would otherwise loop forever if followed naively.
    while (!tracker.shouldSkip(`/paginate?page=${page}`, 0) && iterations < 10_000) {
      tracker.recordVisit(`/paginate?page=${page}`);
      visitedPages.push(page);

      const res = await fetch(`${origin()}/paginate?page=${page}`);
      const data = (await res.json()) as { nextPage: number };
      page = data.nextPage;
      iterations++;
    }

    expect(visitedPages).toEqual([1, 2, 3, 4, 5]);
    expect(tracker.pagesVisitedCount).toBe(5);
    // The loop stopped because of the limit, not because it ran out of pages to visit.
    expect(tracker.shouldSkip(`/paginate?page=${page}`, 0)).toBe(true);
  }, 20_000);

  it("never re-visits a route it has already recorded, even if offered again", () => {
    const tracker = new NavigationLimitTracker();
    expect(tracker.shouldSkip("/app/projects/1", 0)).toBe(false);
    tracker.recordVisit("/app/projects/1");
    expect(tracker.shouldSkip("/app/projects/1", 0)).toBe(true);
  });

  it("stops once maxDepth is exceeded, independent of the page limit", () => {
    const tracker = new NavigationLimitTracker({ ...DEFAULT_LIMITS_FOR_TEST, maxDepth: 2 });
    expect(tracker.shouldSkip("/a/b/c", 3)).toBe(true);
    expect(tracker.shouldSkip("/a/b", 2)).toBe(false);
  });
});
