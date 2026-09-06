import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/connection";
import { runMigrations } from "../../db/migrator";
import { runWriteIdorTest } from "./write-idor-test";
import { addMutationScopeEntry } from "../../mutation/mutation-scope";
import { DenylistedFieldError } from "../../mutation/sensitive-field-denylist";
import type { ResourceKey } from "../../mutation/resource-key";
import type { RestoreRequester } from "../../restore/restore-engine";
import type { DiscoveredOperation } from "../../operation-discovery/discovered-operation";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-write-idor-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  // A second, DEVELOPMENT-classified scan run — used by the denylist test
  // below so the LOCAL_FIXTURE Test Capability override (Section 9.13,
  // active for this whole unit-test project) can't accidentally lift the
  // denylist and defeat the very thing that test is checking.
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'DEVELOPMENT')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 2)").run();
  addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "2" });
  return { db, scanRunId: 1 };
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "2" };
const RESOURCE_URL = "https://example.com/api/projects/2";
const OPERATIONS: DiscoveredOperation[] = [
  { method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
];

function fakeRequester(state: { notes: string }): RestoreRequester {
  return {
    request: async (_url, init) => {
      if (init?.method === "PATCH" && init.body) Object.assign(state, JSON.parse(init.body));
      return { status: 200, headers: {}, body: JSON.stringify(state) };
    },
  };
}

describe("runWriteIdorTest", () => {
  it("never runs unless explicitly enabled — disabled by default, no request is ever sent", async () => {
    const { db, scanRunId } = freshScanRun();
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    const result = await runWriteIdorTest({
      enabled: false,
      db,
      scanRunId,
      requester,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      fieldPath: "notes",
      testValue: "probe",
      initiator: "API",
      holder: "API:IDOR_SCANNER",
      operations: OPERATIONS,
    });

    expect(result.outcome).toBe("NOT_RUN");
    expect(requestSent).toBe(false);
  });

  it("never targets a denylisted field, even when explicitly enabled", async () => {
    const { db } = freshScanRun();
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runWriteIdorTest({
        enabled: true,
        db,
        scanRunId: 2, // DEVELOPMENT — ordinary denylist enforcement, no LOCAL_FIXTURE override in play
        requester,
        resourceKey: RESOURCE,
        resourceUrl: RESOURCE_URL,
        fieldPath: "password",
        testValue: "new-value",
        initiator: "API",
        holder: "API:IDOR_SCANNER",
        operations: OPERATIONS,
      }),
    ).rejects.toThrow(DenylistedFieldError);
    expect(requestSent).toBe(false);
  });

  it("runs the full backup→mutate→verify→restore cycle once explicitly enabled, against a non-denylisted field", async () => {
    const { db, scanRunId } = freshScanRun();
    const state = { notes: "original" };
    const requester = fakeRequester(state);

    const result = await runWriteIdorTest({
      enabled: true,
      db,
      scanRunId,
      requester,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      fieldPath: "notes",
      testValue: "harmless-probe",
      initiator: "API",
      holder: "API:IDOR_SCANNER",
      operations: OPERATIONS,
    });

    expect(result.outcome).toBe("COMPLETED");
    expect(result.cycleResult?.outcome).toBe("RESTORE_OK");
    expect(state.notes).toBe("original");
  });
});
