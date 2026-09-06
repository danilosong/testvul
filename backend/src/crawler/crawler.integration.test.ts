import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { crawl } from "./crawler";
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

/** The fixture's /paginate endpoint always advertises a next page — a
 * genuinely infinite, ever-distinct sequence of URLs (no dedup loop to
 * catch), so only the max-pages limit can stop the crawl. */
function extractNextPageLink(html: string, baseUrl: string): string[] {
  try {
    const parsed = JSON.parse(html);
    if (typeof parsed.nextPage === "number") {
      return [new URL(`?page=${parsed.nextPage}`, baseUrl).toString()];
    }
  } catch {
    // not JSON — no links to extract
  }
  return [];
}

describe("crawl against the fixture app's infinitely-paginated endpoint", () => {
  it("terminates instead of looping forever, stopping at maxPages", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    const result = await crawl(`http://127.0.0.1:${ports.httpPort}/paginate?page=1`, {
      client,
      extractLinks: extractNextPageLink,
      maxDepth: 50,
      maxPages: 10,
    });

    expect(result.pages).toHaveLength(10);
    expect(result.truncated).toBe(true);
    const uniqueUrls = new Set(result.pages.map((p) => p.url));
    expect(uniqueUrls.size).toBe(10); // each page is genuinely distinct, none re-fetched
  });
});
