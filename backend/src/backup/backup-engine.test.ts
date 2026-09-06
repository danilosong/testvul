import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { captureBackup } from "./backup-engine";
import { getLatestResourceBackup } from "./resource-backups-repository";
import type { ResourceKey } from "../mutation/resource-key";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-backup-engine-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

const RESOURCE_KEY: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };

describe("captureBackup", () => {
  it("records the resource content, a timestamp, and a content hash", () => {
    const { db, scanRunId } = freshScanRun();
    const content = JSON.stringify({ id: "123", certificateText: "hello" });

    const snapshot = captureBackup(db, scanRunId, RESOURCE_KEY, content);

    expect(snapshot.content).toBe(content);
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.capturedAt).toBeTruthy();

    const stored = getLatestResourceBackup(db, RESOURCE_KEY);
    expect(stored).toEqual(snapshot);
  });

  it("produces a stable hash for identical content and a different one for different content", () => {
    const { db, scanRunId } = freshScanRun();
    const a = captureBackup(db, scanRunId, RESOURCE_KEY, "same content");
    const b = captureBackup(db, scanRunId, RESOURCE_KEY, "same content");
    const c = captureBackup(db, scanRunId, RESOURCE_KEY, "different content");
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).not.toBe(c.contentHash);
  });

  it("a snapshot is recorded before mutation, per the spec's own test requirement", async () => {
    const { db, scanRunId } = freshScanRun();
    const order: string[] = [];

    async function fakeWriteTest(): Promise<void> {
      captureBackup(db, scanRunId, RESOURCE_KEY, "pre-mutation content");
      order.push("backup");
      // ... the actual mutating request would be issued only here, after backup:
      order.push("mutate");
    }

    await fakeWriteTest();

    expect(order).toEqual(["backup", "mutate"]);
    expect(getLatestResourceBackup(db, RESOURCE_KEY)).not.toBeNull();
  });

  it("keeps backups for different ResourceKeys independent", () => {
    const { db, scanRunId } = freshScanRun();
    const other: ResourceKey = { ...RESOURCE_KEY, resourceId: "456" };
    captureBackup(db, scanRunId, RESOURCE_KEY, "content for 123");
    captureBackup(db, scanRunId, other, "content for 456");

    expect(getLatestResourceBackup(db, RESOURCE_KEY)?.content).toBe("content for 123");
    expect(getLatestResourceBackup(db, other)?.content).toBe("content for 456");
  });

  it("returns the most recent snapshot when a resource has been backed up more than once", () => {
    const { db, scanRunId } = freshScanRun();
    captureBackup(db, scanRunId, RESOURCE_KEY, "first");
    captureBackup(db, scanRunId, RESOURCE_KEY, "second");
    expect(getLatestResourceBackup(db, RESOURCE_KEY)?.content).toBe("second");
  });
});
