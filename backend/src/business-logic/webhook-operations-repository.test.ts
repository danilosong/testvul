import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listWebhookOperations, recordWebhookOperation } from "./webhook-operations-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-webhook-operations-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("webhook-operations-repository (Section 13.23)", () => {
  it("persists and reads back a WebhookOperation with its resulting state transition", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordWebhookOperation(db, {
      scanRunId,
      endpoint: "/api/contest/payments/webhook",
      signatureMechanism: "HMAC-SHA256 (X-Webhook-Signature)",
      resultingStateTransition: "Ticket: PENDING_PAYMENT -> PAID",
    });

    const ops = listWebhookOperations(db, scanRunId);
    expect(ops).toEqual([
      {
        id,
        scanRunId,
        endpoint: "/api/contest/payments/webhook",
        signatureMechanism: "HMAC-SHA256 (X-Webhook-Signature)",
        resultingStateTransition: "Ticket: PENDING_PAYMENT -> PAID",
      },
    ]);
  });
});
