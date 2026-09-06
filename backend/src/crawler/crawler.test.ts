import { describe, expect, it } from "vitest";
import { ScopeViolationError } from "../scope";
import { crawl, type CrawlerRequester } from "./crawler";

function fakeClient(
  pageFor: (url: string) => { status?: number; html?: string },
  methodsUsed: string[],
): CrawlerRequester {
  return {
    request: async (url, init) => {
      methodsUsed.push(init?.method ?? "GET");
      const page = pageFor(url);
      return { status: page.status ?? 200, body: page.html ?? "", headers: {} };
    },
  };
}

describe("crawl", () => {
  it("never issues anything but GET requests", async () => {
    const methodsUsed: string[] = [];
    const client = fakeClient(
      (url) => ({ html: url === "http://example.com/" ? '<a href="http://example.com/page2">x</a>' : "" }),
      methodsUsed,
    );
    await crawl("http://example.com/", {
      client,
      extractLinks: (html) => (html.includes("page2") ? ["http://example.com/page2"] : []),
    });
    expect(methodsUsed.every((m) => m === "GET")).toBe(true);
    expect(methodsUsed).not.toContain("POST");
    expect(methodsUsed).not.toContain("PUT");
    expect(methodsUsed).not.toContain("PATCH");
    expect(methodsUsed).not.toContain("DELETE");
  });

  it("stops enqueuing once maxPages is reached", async () => {
    const methodsUsed: string[] = [];
    // Each page's own URL number determines the (single) link it exposes to
    // the next page — an infinite chain, like the fixture's paginated endpoint.
    const client = fakeClient(
      (url) => {
        const n = Number(new URL(url).pathname.replace("/page", "") || "0");
        return { html: `<a href="http://example.com/page${n + 1}">next</a>` };
      },
      methodsUsed,
    );
    const result = await crawl("http://example.com/page0", {
      client,
      extractLinks: (html) => {
        const match = html.match(/page(\d+)/);
        return match ? [`http://example.com/page${match[1]}`] : [];
      },
      maxPages: 5,
      maxDepth: 10, // isolate the maxPages behavior from the separate maxDepth limit
    });
    expect(result.pages.length).toBeLessThanOrEqual(5);
    expect(result.truncated).toBe(true);
  });

  it("does not follow a link beyond maxDepth", async () => {
    const methodsUsed: string[] = [];
    const client = fakeClient(
      (url) => {
        const depth = Number(url.split("/depth").pop() ?? 0);
        return { html: `<a href="http://example.com/depth${depth + 1}">next</a>` };
      },
      methodsUsed,
    );
    const result = await crawl("http://example.com/depth0", {
      client,
      extractLinks: (html) => {
        const match = html.match(/depth(\d+)/);
        return match ? [`http://example.com/depth${match[1]}`] : [];
      },
      maxDepth: 3,
    });
    const depths = result.pages.map((p) => p.depth);
    expect(Math.max(...depths)).toBe(3);
    expect(result.pages).toHaveLength(4); // depths 0,1,2,3
  });

  it("does not revisit an already-visited URL", async () => {
    const methodsUsed: string[] = [];
    let requestCount = 0;
    const client: CrawlerRequester = {
      request: async (url, init) => {
        methodsUsed.push(init?.method ?? "GET");
        requestCount++;
        return { status: 200, body: '<a href="http://example.com/a"></a><a href="http://example.com/b"></a>', headers: {} };
      },
    };
    await crawl("http://example.com/a", {
      client,
      extractLinks: () => ["http://example.com/a", "http://example.com/b"],
      maxDepth: 5,
    });
    // "a" is visited once as the start page; "b" once when first discovered;
    // "a" is never re-fetched even though it's referenced again.
    expect(requestCount).toBe(2);
  });

  it("skips a newly-discovered out-of-scope link instead of aborting the rest of the crawl (Section 14.4)", async () => {
    const client: CrawlerRequester = {
      request: async (url) => {
        if (url === "http://out-of-scope.example.test/") throw new ScopeViolationError(url);
        return {
          status: 200,
          body:
            url === "http://example.com/"
              ? '<a href="http://out-of-scope.example.test/">x</a><a href="http://example.com/page2">y</a>'
              : "",
          headers: {},
        };
      },
    };
    const result = await crawl("http://example.com/", {
      client,
      extractLinks: (html) => {
        const matches = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
        return matches;
      },
    });

    expect(result.outOfScopeSkipped).toEqual(["http://out-of-scope.example.test/"]);
    // The rest of the crawl still completed — the out-of-scope link never aborted it.
    expect(result.pages.map((p) => p.url)).toContain("http://example.com/page2");
  });
});
