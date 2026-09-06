import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { runMutationTestCycle } from "./mutation-cycle";
import { recordJournalState } from "./mutation-journal-repository";
import { DenylistedFieldError } from "./sensitive-field-denylist";
import { ResourceFrozenError } from "./mutation-fail-safe";
import { ReversibilityNotProvenError } from "./reversibility";
import { addMutationScopeEntry, MutationScopeViolationError } from "./mutation-scope";
import type { ResourceKey } from "./resource-key";
import type { RestoreRequester } from "../restore/restore-engine";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** scanRunId 1 (LOCAL_FIXTURE) is the ordinary happy-path scan run used by
 * most tests; scanRunId 2 (DEVELOPMENT) exists specifically to prove the
 * denylist and its LOCAL_FIXTURE Test Capability exception (Section 9.13)
 * behave differently depending on environment classification alone. */
function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-mutation-cycle-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'DEVELOPMENT')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 2)").run();
  // Declares RESOURCE itself as TEST_RESOURCE for every test in this file
  // except the ones specifically exercising Mutation Scope Enforcement below.
  addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "123" });
  return { db, scanRunId: 1 };
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };
const RESOURCE_URL = "https://example.com/api/projects/123";

const KNOWN_OPERATIONS: DiscoveredOperation[] = [
  { method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
];

function fakeRequester(state: { notes: string }): RestoreRequester {
  return {
    request: async (_url, init) => {
      if (init?.method === "PATCH" && init.body) {
        Object.assign(state, JSON.parse(init.body));
      }
      return { status: 200, headers: {}, body: JSON.stringify(state) };
    },
  };
}

describe("runMutationTestCycle", () => {
  it("records the full BACKUP_CREATED → MUTATION_PENDING → MUTATION_APPLIED → RESTORE_PENDING → RESTORE_OK sequence", async () => {
    const { db, scanRunId } = freshScanRun();
    const state = { notes: "original" };
    const requester = fakeRequester(state);

    const result = await runMutationTestCycle({
      db,
      scanRunId,
      requester,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      fieldPath: "notes",
      testValue: "<script>test</script>",
      initiator: "API",
      holder: "API:XSS_SCANNER",
      operations: KNOWN_OPERATIONS,
    });

    expect(result.outcome).toBe("RESTORE_OK");
    expect(state.notes).toBe("original"); // restored

    const rows = db.prepare("SELECT state FROM mutation_journal WHERE resource_id = ? ORDER BY id").all(RESOURCE.resourceId) as {
      state: string;
    }[];
    expect(rows.map((r) => r.state)).toEqual([
      "BACKUP_CREATED",
      "MUTATION_PENDING",
      "MUTATION_APPLIED",
      "RESTORE_PENDING",
      "RESTORE_OK",
    ]);
  });

  it("refuses to run for a denylisted field before any request is sent", async () => {
    const { db } = freshScanRun();
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runMutationTestCycle({
        db,
        scanRunId: 2, // DEVELOPMENT — ordinary denylist enforcement, no LOCAL_FIXTURE override in play
        requester,
        resourceKey: RESOURCE,
        resourceUrl: RESOURCE_URL,
        fieldPath: "balance",
        testValue: 999999,
        initiator: "API",
        holder: "API:IDOR_SCANNER",
        operations: KNOWN_OPERATIONS,
      }),
    ).rejects.toThrow(DenylistedFieldError);
    expect(requestSent).toBe(false);
  });

  it("refuses to run against a resource already frozen from a prior RESTORE_CONFLICT", async () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_CONFLICT");
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runMutationTestCycle({
        db,
        scanRunId,
        requester,
        resourceKey: RESOURCE,
        resourceUrl: RESOURCE_URL,
        fieldPath: "notes",
        testValue: "x",
        initiator: "BROWSER",
        holder: "BROWSER",
        operations: KNOWN_OPERATIONS,
      }),
    ).rejects.toThrow(ResourceFrozenError);
    expect(requestSent).toBe(false);
  });

  it.each(["API", "BROWSER", "BUSINESS_LOGIC"] as const)(
    "refuses a %s candidate with no known restore strategy rather than mutating to find out",
    async (initiator) => {
    const { db, scanRunId } = freshScanRun();
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runMutationTestCycle({
        db,
        scanRunId,
        requester,
        resourceKey: RESOURCE,
        resourceUrl: RESOURCE_URL,
        fieldPath: "notes",
        testValue: "x",
        initiator,
        holder: `${initiator}:TEST`,
        // No discovered PATCH operation for this URL — reversibility cannot be proven.
        operations: [{ method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }],
      }),
    ).rejects.toThrow(ReversibilityNotProvenError);
    expect(requestSent).toBe(false);
    },
  );

  it("proceeds normally when all six reversibility preconditions are present", async () => {
    const { db, scanRunId } = freshScanRun();
    const state = { notes: "original" };
    const requester = fakeRequester(state);

    const result = await runMutationTestCycle({
      db,
      scanRunId,
      requester,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      fieldPath: "notes",
      testValue: "probe",
      initiator: "API",
      holder: "API:XSS_SCANNER",
      operations: KNOWN_OPERATIONS,
    });

    expect(result.outcome).toBe("RESTORE_OK");
  });

  it.each(["API", "BROWSER", "BUSINESS_LOGIC"] as const)(
    "blocks a %s mutation attempt against an UNKNOWN_RESOURCE (no Mutation Scope declared for the target at all)",
    async (initiator) => {
    const { db, scanRunId } = freshScanRun();
    const unscopedResource: ResourceKey = { targetId: 999, origin: "https://example.com", objectType: "project", resourceId: "1" };
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runMutationTestCycle({
        db,
        scanRunId,
        requester,
        resourceKey: unscopedResource,
        resourceUrl: RESOURCE_URL,
        fieldPath: "notes",
        testValue: "x",
        initiator,
        holder: `${initiator}:TEST`,
        operations: KNOWN_OPERATIONS,
      }),
    ).rejects.toThrow(MutationScopeViolationError);
    expect(requestSent).toBe(false);
    },
  );

  it.each(["API", "BROWSER", "BUSINESS_LOGIC"] as const)(
    "blocks a %s mutation attempt against a NON_TEST_RESOURCE (Mutation Scope is configured for the target but excludes this resource)",
    async (initiator) => {
    const { db, scanRunId } = freshScanRun();
    const nonTestResource: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "999" };
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runMutationTestCycle({
        db,
        scanRunId,
        requester,
        resourceKey: nonTestResource,
        resourceUrl: RESOURCE_URL,
        fieldPath: "notes",
        testValue: "x",
        initiator,
        holder: `${initiator}:TEST`,
        operations: KNOWN_OPERATIONS,
      }),
    ).rejects.toThrow(MutationScopeViolationError);
    expect(requestSent).toBe(false);
    },
  );

  it("allows mutating a NON_TEST_RESOURCE only when a distinct, explicit advanced override is confirmed", async () => {
    const { db, scanRunId } = freshScanRun();
    const nonTestResource: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "999" };
    const state = { notes: "original" };
    const requester = fakeRequester(state);

    const result = await runMutationTestCycle({
      db,
      scanRunId,
      requester,
      resourceKey: nonTestResource,
      resourceUrl: RESOURCE_URL,
      fieldPath: "notes",
      testValue: "probe",
      initiator: "API",
      holder: "API:XSS_SCANNER",
      operations: KNOWN_OPERATIONS,
      advancedOverrideConfirmed: true,
    });

    expect(result.outcome).toBe("RESTORE_OK");
  });

  it("LOCAL_FIXTURE Test Capability: a fixture price-shaped field can be mutated under the test harness against a LOCAL_FIXTURE target", async () => {
    const { db } = freshScanRun();
    const state = { notes: "original", price: 10 };
    const requester: RestoreRequester = {
      request: async (_url, init) => {
        if (init?.method === "PATCH" && init.body) Object.assign(state, JSON.parse(init.body));
        return { status: 200, headers: {}, body: JSON.stringify(state) };
      },
    };

    const result = await runMutationTestCycle({
      db,
      scanRunId: 1, // LOCAL_FIXTURE
      requester,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      fieldPath: "price",
      testValue: 0,
      initiator: "API",
      holder: "API:IDOR_SCANNER",
      operations: KNOWN_OPERATIONS,
    });

    expect(result.outcome).toBe("RESTORE_OK");
  });

  it("LOCAL_FIXTURE Test Capability: the same field remains blocked against a target classified DEVELOPMENT", async () => {
    const { db } = freshScanRun();
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    await expect(
      runMutationTestCycle({
        db,
        scanRunId: 2, // DEVELOPMENT — the override never applies here, even with the test-harness flag set
        requester,
        resourceKey: RESOURCE,
        resourceUrl: RESOURCE_URL,
        fieldPath: "price",
        testValue: 0,
        initiator: "API",
        holder: "API:IDOR_SCANNER",
        operations: KNOWN_OPERATIONS,
      }),
    ).rejects.toThrow(DenylistedFieldError);
    expect(requestSent).toBe(false);
  });

  it("no ordinary API-shaped parameter can lift the denylist — only the environment classification and build flag can", async () => {
    const { db } = freshScanRun();
    let requestSent = false;
    const requester: RestoreRequester = {
      request: async () => {
        requestSent = true;
        return { status: 200, headers: {}, body: "{}" };
      },
    };

    // Simulates a caller (a future API/UI layer) blindly forwarding extra,
    // attacker- or mistake-supplied fields alongside an ordinary mutation
    // request — none of MutationCycleParams' real fields can express "lift
    // the denylist," so this has no effect against a DEVELOPMENT target.
    await expect(
      runMutationTestCycle({
        db,
        scanRunId: 2, // DEVELOPMENT
        requester,
        resourceKey: RESOURCE,
        resourceUrl: RESOURCE_URL,
        fieldPath: "price",
        testValue: 0,
        initiator: "API",
        holder: "API:IDOR_SCANNER",
        operations: KNOWN_OPERATIONS,
        advancedOverrideConfirmed: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ localFixtureTestCapability: true, testCapabilityEnabled: true, environment: "LOCAL_FIXTURE" } as any),
      }),
    ).rejects.toThrow(DenylistedFieldError);
    expect(requestSent).toBe(false);
  });
});
