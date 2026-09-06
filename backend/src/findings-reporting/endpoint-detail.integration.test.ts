import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { discoverRuntimeSurface, toDiscoveredResources } from "../browser/browser-runtime-discovery";
import { analyzeFields } from "../analysis/field-analyzer";
import { recordDiscoveredEndpoint, recordDiscoveredEndpoints, recordEndpointAuthRequirement } from "../discovery/discovered-endpoints-repository";
import { recordDiscoveredField } from "../discovery/discovered-fields-repository";
import { classifyField } from "../analysis/field-classifier";
import { getAttackSurfaceTree, getEndpointDetail } from "./endpoint-detail";
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

describe("Section 15.4 — Attack Surface tree and Endpoint Detail against the real fixture app, merging static and browser-discovered endpoints", () => {
  it("the tree and detail data match the fixture scan's discovered endpoints regardless of discovery source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sca-endpoint-detail-integration-"));
    const db: Db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
    const scanRunId = 1;

    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const httpClient = new SecurityHttpClient({ scopeValidator, allowPrivateNetworks: true });
    const authedClient = withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" });

    // ── STATIC discovery of /api/projects/1 ─────────────────────────────
    const projectUrl = `${origin()}/api/projects/1`;
    const staticEndpointId = recordDiscoveredEndpoint(db, scanRunId, { url: projectUrl, method: "GET", contentType: "application/json" }, "STATIC");

    // Real field analysis of the actual response.
    const projectResponse = await authedClient.request(projectUrl);
    expect(projectResponse.status).toBe(200);
    for (const field of analyzeFields(JSON.parse(projectResponse.body))) {
      recordDiscoveredField(db, scanRunId, staticEndpointId, field.path, classifyField(field.path, field.value));
    }

    // Real auth-requirement observation: unauthenticated fails, authenticated succeeds.
    const unauthedResponse = await httpClient.request(projectUrl);
    expect(unauthedResponse.status).toBe(401);
    recordEndpointAuthRequirement(db, staticEndpointId, unauthedResponse.status === 401 && projectResponse.status === 200);

    // ── BROWSER discovery of the SPA project page (Section 12) ──────────
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const runtimeResult = await discoverRuntimeSurface(context, `${origin()}/app/projects/1`);
    await context.close();
    recordDiscoveredEndpoints(db, scanRunId, toDiscoveredResources(runtimeResult), "BROWSER");

    // ── Attack Surface tree merges both sources ─────────────────────────
    const tree = getAttackSurfaceTree(db, scanRunId);
    const treeUrls = JSON.stringify(tree);
    expect(treeUrls).toContain("api/projects/1");
    expect(treeUrls).toContain(`app/projects/1`);

    // ── Endpoint Detail for the statically-discovered endpoint ──────────
    const detail = getEndpointDetail(db, staticEndpointId);
    expect(detail).not.toBeNull();
    expect(detail!.contentType).toBe("application/json");
    expect(detail!.authRequired).toBe(true);
    expect(detail!.fieldCount).toBeGreaterThan(0);
    // Real, genuinely-classified interesting fields on the fixture's project resource.
    expect(detail!.interestingFields.some((f) => f.fieldPath === "analyticsGtm" && f.classification === "GTM")).toBe(true);
    expect(detail!.interestingFields.some((f) => f.fieldPath === "summaryHtml" && f.classification === "HTML")).toBe(true);
    expect(detail!.interestingFields.some((f) => f.fieldPath === "id" && f.classification === "IDENTIFIER")).toBe(true);
    // A plain-string field like "owner" is correctly left out of the interesting list.
    expect(detail!.interestingFields.some((f) => f.fieldPath === "owner")).toBe(false);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
