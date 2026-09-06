import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listObservedProperties } from "./business-observed-properties-repository";
import { classifyParameterControl, recordParameterClassification } from "./parameter-analyzer";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

describe("classifyParameterControl — representative business-relevant fields", () => {
  it("classifies ticketNumber as SERVER_CONTROLLED when the server assigns its own value regardless of what the client attempted", () => {
    expect(classifyParameterControl(999999, 1)).toBe("SERVER_CONTROLLED");
  });

  it("classifies ticketNumber as CLIENT_CONTROLLED when the server honors the attempted value verbatim", () => {
    expect(classifyParameterControl(424242, 424242)).toBe("CLIENT_CONTROLLED");
  });

  it("classifies price as SERVER_CONTROLLED when a client-attempted override is ignored", () => {
    expect(classifyParameterControl(0.01, 49.99)).toBe("SERVER_CONTROLLED");
  });

  it("classifies role as SERVER_CONTROLLED when a client-attempted privilege escalation is ignored", () => {
    expect(classifyParameterControl("admin", "user")).toBe("SERVER_CONTROLLED");
  });

  it("classifies UNKNOWN when no attempted value was ever observed", () => {
    expect(classifyParameterControl(undefined, "user")).toBe("UNKNOWN");
  });
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-parameter-analyzer-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("recordParameterClassification — persists the classification as an ObservedProperty", () => {
  it("persists a SERVER_CONTROLLED classification readable via listObservedProperties", () => {
    const { db, scanRunId } = freshScanRun();
    const control = recordParameterClassification(db, scanRunId, "Ticket", "number", 999999, 1);

    expect(control).toBe("SERVER_CONTROLLED");
    const stored = listObservedProperties(db, scanRunId, "Ticket", "number.control");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.observedValue).toBe("SERVER_CONTROLLED");
  });
});
