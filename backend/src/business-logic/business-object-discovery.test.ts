import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recognizeObjectTypesFromUrl, recognizeObjectTypeFromFieldName, recordBusinessObject, listBusinessObjects } from "./business-object-discovery";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

describe("recognizeObjectTypesFromUrl — Campaign/Ticket/Reservation-shaped resources are recognized without the Contest profile being enabled", () => {
  it("recognizes Campaign from the fixture's real contest campaign URL", () => {
    expect(recognizeObjectTypesFromUrl("http://127.0.0.1:3000/api/contest/campaigns/1")).toContain("Campaign");
  });

  it("recognizes Ticket from the fixture's real contest ticket URL", () => {
    expect(recognizeObjectTypesFromUrl("http://127.0.0.1:3000/api/contest/tickets/abc")).toContain("Ticket");
  });

  it("recognizes Reservation from the fixture's real contest reservation URL", () => {
    expect(recognizeObjectTypesFromUrl("http://127.0.0.1:3000/api/contest/reservations/abc")).toContain("Reservation");
  });

  it("recognizes an unrelated resource type just as readily — this heuristic isn't hardcoded to the contest domain", () => {
    expect(recognizeObjectTypesFromUrl("http://127.0.0.1:3000/api/projects/1")).toContain("Project");
  });

  it("this module never imports the Contest profile at all", () => {
    const source = readFileSync(join(__dirname, "business-object-discovery.ts"), "utf8");
    expect(source).not.toMatch(/profiles\/contest/);
  });
});

describe("recognizeObjectTypeFromFieldName", () => {
  it("recognizes Campaign from a campaignId field", () => {
    expect(recognizeObjectTypeFromFieldName("campaignId")).toBe("Campaign");
  });

  it("returns null for a field that isn't shaped like an object-identifier", () => {
    expect(recognizeObjectTypeFromFieldName("name")).toBeNull();
  });
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("recordBusinessObject / listBusinessObjects", () => {
  it("persists Campaign/Ticket/Reservation as business objects from real fixture URLs, with no Contest profile involved", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-business-object-discovery-"));
    db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();

    const urls = [
      "http://127.0.0.1:3000/api/contest/campaigns/1",
      "http://127.0.0.1:3000/api/contest/tickets/abc",
      "http://127.0.0.1:3000/api/contest/reservations/abc",
    ];
    for (const url of urls) {
      for (const objectType of recognizeObjectTypesFromUrl(url)) {
        recordBusinessObject(db, 1, objectType, "URL");
      }
    }

    const recorded = listBusinessObjects(db, 1).map((o) => o.objectType);
    expect(recorded).toContain("Campaign");
    expect(recorded).toContain("Ticket");
    expect(recorded).toContain("Reservation");
  });
});
