import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { crawl } from "../crawler/crawler";
import { extractFromHtml } from "../crawler/html-extractor";
import { discoverRuntimeSurface } from "../browser/browser-runtime-discovery";
import { consolidateHostCandidates } from "../discovery/host-candidate-discovery";
import { saveHostCandidates } from "../discovery/discovered-hosts-repository";
import { BoundedQueue } from "./bounded-queue";
import { routeHostCandidates } from "./host-discovery-routing";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let browser: Browser;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

// "*.in-scope.example.test" is never actually connected to — scope is decided from
// the hostname string alone before any connection is attempted, exactly
// like the fixture's own /redirect/out-of-scope convention.
const SCOPE = ["127.0.0.1", "*.in-scope.example.test"];

describe("Section 14.4 — newly-discovered-host handling against the real fixture page (1.6/12), wired into the Target Queue", () => {
  it("routes an in-scope subdomain and an out-of-scope host identically whether static crawling or the browser discovered them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sca-host-discovery-routing-"));
    const db: Db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
    const scanRunId = 1;

    const scopeValidator = new ScopeValidator(SCOPE);
    const httpClient = new SecurityHttpClient({ scopeValidator, allowPrivateNetworks: true });
    const pageUrl = `${origin()}/host-discovery-fixture`;

    // ── Static crawling side ──────────────────────────────────────────
    // maxDepth: 0 fetches only the start page itself — neither the
    // in-scope subdomain nor the out-of-scope host is a real, resolvable
    // address, so the crawler is never asked to actually connect to
    // either; `crawl()`'s own out-of-scope-skip behavior (Section 14.4's
    // fix, so a real out-of-scope link during recursion never aborts the
    // rest of the crawl) is covered directly against a fake in-process
    // client in crawler.test.ts. This integration test's job is proving
    // real *extraction* + *routing*, from both mechanisms, is correct.
    const crawlResult = await crawl(pageUrl, {
      client: httpClient,
      extractLinks: (html, baseUrl) => extractFromHtml(html, baseUrl).links,
      maxDepth: 0,
    });
    const staticPage = crawlResult.pages.find((p) => p.url === pageUrl)!;
    const staticLinks = extractFromHtml(staticPage.html, pageUrl).links;

    const staticCandidates = consolidateHostCandidates(scopeValidator, { absoluteAnchors: staticLinks });
    const staticQueue = new BoundedQueue<string>("TARGET", 10);
    const staticRouting = routeHostCandidates(staticQueue, staticCandidates);
    saveHostCandidates(db, scanRunId, staticCandidates);

    expect(staticRouting.queued).toEqual(["sub.in-scope.example.test"]);
    expect(staticRouting.recordedOutOfScope).toEqual(["out-of-scope.example.test"]);

    // ── Real browser-runtime side (Section 12) ──────────────────────────
    const context = await browser.newContext();
    const runtimeResult = await discoverRuntimeSurface(context, pageUrl);
    await context.close();

    const browserCandidates = consolidateHostCandidates(scopeValidator, { browserDiscoveredLinks: runtimeResult.links });
    const browserQueue = new BoundedQueue<string>("TARGET", 10);
    const browserRouting = routeHostCandidates(browserQueue, browserCandidates);
    saveHostCandidates(db, scanRunId, browserCandidates);

    expect(browserRouting.queued).toEqual(["sub.in-scope.example.test"]);
    expect(browserRouting.recordedOutOfScope).toEqual(["out-of-scope.example.test"]);

    // ── Both mechanisms persisted identically to discovered_hosts, tagged with their own real source ──
    const rows = db
      .prepare("SELECT hostname, in_scope, discovery_source FROM discovered_hosts WHERE scan_run_id = ? ORDER BY discovery_source, hostname")
      .all(scanRunId) as { hostname: string; in_scope: number; discovery_source: string }[];
    expect(rows).toEqual([
      { hostname: "out-of-scope.example.test", in_scope: 0, discovery_source: "BROWSER" },
      { hostname: "sub.in-scope.example.test", in_scope: 1, discovery_source: "BROWSER" },
      { hostname: "out-of-scope.example.test", in_scope: 0, discovery_source: "LINK" },
      { hostname: "sub.in-scope.example.test", in_scope: 1, discovery_source: "LINK" },
    ]);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
