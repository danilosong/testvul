import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listAuditEvents } from "../mutation/audit-events-repository";
import { runPipelineWithAuditTrail } from "./scan-lifecycle-audit";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-scan-lifecycle-audit-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("runPipelineWithAuditTrail (Section 14.5)", () => {
  it("records a complete, correctly-ordered SCAN_STARTED -> per-stage -> SCAN_FINISHED sequence", async () => {
    const { db, scanRunId } = freshScanRun();

    await runPipelineWithAuditTrail(db, scanRunId, {
      stageRunners: {
        DNS_RESOLVER: async () => undefined,
        SCOPE_VALIDATION: async () => undefined,
        SECURITY_TESTS: async () => undefined,
      },
    });

    const events = listAuditEvents(db, scanRunId);
    expect(events.map((e) => e.eventType)).toEqual([
      "SCAN_STARTED",
      "STAGE_DNS_RESOLVER_RUNNING",
      "STAGE_DNS_RESOLVER_COMPLETED",
      "STAGE_SCOPE_VALIDATION_RUNNING",
      "STAGE_SCOPE_VALIDATION_COMPLETED",
      "STAGE_SECURITY_TESTS_RUNNING",
      "STAGE_SECURITY_TESTS_COMPLETED",
      "SCAN_FINISHED",
    ]);
    expect(events[events.length - 1]?.payload).toEqual({ outcome: "COMPLETED" });
  });

  it("still records SCAN_FINISHED with a FAILED outcome when a stage throws, rather than leaving the trail incomplete", async () => {
    const { db, scanRunId } = freshScanRun();

    await expect(
      runPipelineWithAuditTrail(db, scanRunId, {
        stageRunners: {
          DNS_RESOLVER: async () => {
            throw new Error("boom");
          },
        },
      }),
    ).rejects.toThrow("boom");

    const events = listAuditEvents(db, scanRunId);
    expect(events.map((e) => e.eventType)).toEqual(["SCAN_STARTED", "STAGE_DNS_RESOLVER_RUNNING", "STAGE_DNS_RESOLVER_FAILED", "SCAN_FINISHED"]);
    expect(events[events.length - 1]?.payload).toEqual({ outcome: "FAILED" });
  });
});
