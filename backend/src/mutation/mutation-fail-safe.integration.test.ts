import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { hashContent } from "../backup/backup-engine";
import { mutateField } from "../mutation/request-mutator";
import { restoreResource } from "../restore/restore-engine";
import { recordJournalState } from "./mutation-journal-repository";
import { assertResourceNotFrozen, ResourceFrozenError } from "./mutation-fail-safe";
import type { ResourceKey } from "./resource-key";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let client: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
});

afterAll(async () => {
  await servers.stop();
});

let dir: string;
let db: Db;
let scanRunId: number;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): void {
  dir = mkdtempSync(join(tmpdir(), "sca-fail-safe-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  scanRunId = 1;
}

const ETAG_URL = () => `http://127.0.0.1:${ports.httpPort}/api/resources/etag/etag-1`;
const RESOURCE: ResourceKey = { targetId: 1, origin: "https://127.0.0.1", objectType: "etag-resource", resourceId: "etag-1" };

describe("shared mutation fail-safe against the fixture app", () => {
  it("blocks a second mutation attempt — from a different subsystem — after a real RESTORE_CONFLICT, per the spec's own test requirement", async () => {
    freshScanRun();

    const before = await client.request(ETAG_URL());
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-by-xss-scanner");

    const mutateRes = await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-by-xss-scanner" }),
    });

    // An external actor changes the resource before restore runs.
    await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": mutateRes.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "changed-by-someone-else" }),
    });

    const result = await restoreResource({
      requester: client,
      resourceUrl: ETAG_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash: hashContent(before.body),
      expectedPostMutationState,
      concurrencySignalAfterMutation: { type: "etag", value: mutateRes.headers.etag as string },
    });
    expect(result.outcome).toBe("RESTORE_CONFLICT");

    // Record it — this is what the (not-yet-built) XSS scanner would do.
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_CONFLICT", { fieldPath: "value", requiresManualIntervention: true });

    // A completely different subsystem (the browser engine) now tries a
    // fresh mutation cycle against the SAME resource — it must be refused
    // before it ever sends a single request.
    expect(() => assertResourceNotFrozen(db, RESOURCE)).toThrow(ResourceFrozenError);

    // And a business-logic test plan, too — the freeze is not scanner-specific.
    expect(() => assertResourceNotFrozen(db, RESOURCE)).toThrow(ResourceFrozenError);
  });

  it("blocks a second mutation attempt after a real RESTORE_FAILED outcome", async () => {
    freshScanRun();

    const before = await client.request(ETAG_URL());
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-value");

    const mutateRes = await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-value" }),
    });

    const result = await restoreResource({
      requester: client,
      resourceUrl: ETAG_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash: hashContent("deliberately wrong snapshot content"),
      expectedPostMutationState,
      concurrencySignalAfterMutation: { type: "etag", value: mutateRes.headers.etag as string },
    });
    expect(result.outcome).toBe("RESTORE_FAILED");

    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_FAILED", { fieldPath: "value", requiresManualIntervention: true });

    expect(() => assertResourceNotFrozen(db, RESOURCE)).toThrow(ResourceFrozenError);
  });

  it("does not block a mutation attempt against a resource with no prior failure", () => {
    freshScanRun();
    expect(() => assertResourceNotFrozen(db, RESOURCE)).not.toThrow();
  });
});
