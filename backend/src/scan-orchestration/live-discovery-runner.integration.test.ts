import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listDiscoveredEndpointSummaries } from "../discovery/discovered-endpoints-repository";
import { getDiscoveredOperations } from "../operation-discovery/discovered-operations-repository";
import { createTarget } from "../target-configuration/targets-repository";
import { startScan } from "../target-configuration/start-scan";
import { requestScanCancellation } from "./scan-cancellation";
import { runLiveDiscoveryScan } from "./live-discovery-runner";
import { PIPELINE_STAGES } from "./pipeline-sequencer";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let dir: string;
let db: Db;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
}, 60_000);

afterAll(async () => {
  await servers.stop();
});

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup(scanMode: "PASSIVE" | "SAFE_AUTOMATIC" = "PASSIVE") {
  dir = mkdtempSync(join(tmpdir(), "sca-live-discovery-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  const targetId = createTarget(db, {
    name: "Live discovery E2E",
    hostname: "127.0.0.1",
    scope: ["127.0.0.1"],
    environment: "LOCAL_FIXTURE",
    allowPrivateNetworks: true,
    defaultScanMode: scanMode,
  });
  const { scanRunId } = startScan(db, { targetId });
  return { targetId, scanRunId };
}

describe("live-discovery-runner — the real automatic driver a start-scan API call actually triggers", () => {
  it("runs every pipeline stage to COMPLETED against a real (non-scripted) target and finalizes the scan run", async () => {
    const { scanRunId } = setup();
    const origin = `http://127.0.0.1:${ports.httpPort}`;

    const result = await runLiveDiscoveryScan(db, scanRunId, { baseUrlOverride: `${origin}/`, maxDepth: 2, maxPages: 20 });

    expect(result.progress.map((entry) => entry.stage)).toEqual([...PIPELINE_STAGES]);
    expect(result.progress.every((entry) => entry.status === "COMPLETED")).toBe(true);

    const scanRunRow = db.prepare("SELECT state FROM scan_runs WHERE id = ?").get(scanRunId) as { state: string };
    expect(scanRunRow.state).toBe("COMPLETED");

    // Real discovery actually happened — not a hand-scripted stand-in.
    const endpoints = listDiscoveredEndpointSummaries(db, scanRunId);
    expect(endpoints.some((endpoint) => endpoint.url === `${origin}/` && endpoint.discoveredVia === "STATIC")).toBe(true);

    const operations = getDiscoveredOperations(db, scanRunId);
    expect(operations.some((operation) => operation.source === "OPENAPI")).toBe(false); // the fixture's only documented path is templated ("/api/projects/{id}") — never auto-resolved by guessing a resource id
    expect((result.results.API_DISCOVERY as { found: boolean; templatedPathsSeen: string[] }).templatedPathsSeen).toContain("/api/projects/{id}");
    expect((result.results.SECURITY_TESTS as { skipped: boolean }).skipped).toBe(true);
  }, 30_000);

  it("marks the scan run CANCELLED, not FAILED or COMPLETED, when cancellation was requested before the run started", async () => {
    const { scanRunId } = setup();
    const origin = `http://127.0.0.1:${ports.httpPort}`;
    requestScanCancellation(db, scanRunId, "operator@example.com");

    const result = await runLiveDiscoveryScan(db, scanRunId, { baseUrlOverride: `${origin}/` });

    expect(result.progress).toEqual([]);
    const scanRunRow = db.prepare("SELECT state FROM scan_runs WHERE id = ?").get(scanRunId) as { state: string };
    expect(scanRunRow.state).toBe("CANCELLED");
  });
});
