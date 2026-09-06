import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import {
  createBusinessInvariant,
  deleteBusinessInvariant,
  InvalidInvariantConditionError,
  listBusinessInvariants,
  listBusinessInvariantsForTarget,
  updateBusinessInvariant,
} from "./business-invariants-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-business-invariants-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

describe("business-invariants-repository (Section 13.17)", () => {
  it("stores and reads back a configured invariant", () => {
    const db = freshDb();
    const id = createBusinessInvariant(db, {
      targetId: 1,
      name: "Ticket.number is immutable after PAID",
      objectType: "Ticket",
      condition: { or: [{ field: "status", operator: "NEQ", value: "PAID" }, { field: "numberChanged", operator: "EQ", value: false }] },
      expected: true,
      severity: "HIGH",
    });
    expect(id).toBeGreaterThan(0);

    const invariants = listBusinessInvariants(db, 1, "Ticket");
    expect(invariants).toHaveLength(1);
    expect(invariants[0]).toEqual({
      id,
      targetId: 1,
      name: "Ticket.number is immutable after PAID",
      objectType: "Ticket",
      condition: { or: [{ field: "status", operator: "NEQ", value: "PAID" }, { field: "numberChanged", operator: "EQ", value: false }] },
      expected: true,
      severity: "HIGH",
    });
  });

  it.each(["process.exit()", "require('fs')", "constructor.constructor('return process')()", "state.status === 'PAID' && numberChanged"])(
    "rejects the arbitrary expression %j before ever storing it",
    (maliciousExpression) => {
    const db = freshDb();
    expect(() =>
      createBusinessInvariant(db, {
        targetId: 1,
        name: "bad invariant",
        objectType: "Ticket",
        condition: maliciousExpression as unknown,
        expected: true,
        severity: "HIGH",
      }),
    ).toThrow(InvalidInvariantConditionError);
    expect(listBusinessInvariants(db, 1, "Ticket")).toHaveLength(0);
    },
  );

  it("scopes listing by objectType, never leaking one object type's invariants into another's", () => {
    const db = freshDb();
    createBusinessInvariant(db, {
      targetId: 1,
      name: "Ticket invariant",
      objectType: "Ticket",
      condition: { field: "status", operator: "EXISTS" },
      expected: true,
      severity: "LOW",
    });
    createBusinessInvariant(db, {
      targetId: 1,
      name: "Campaign invariant",
      objectType: "Campaign",
      condition: { field: "closed", operator: "EXISTS" },
      expected: true,
      severity: "LOW",
    });
    expect(listBusinessInvariants(db, 1, "Ticket")).toHaveLength(1);
    expect(listBusinessInvariants(db, 1, "Campaign")).toHaveLength(1);
  });
});

describe("listBusinessInvariantsForTarget / updateBusinessInvariant / deleteBusinessInvariant (Section 13.22)", () => {
  const BASE = {
    targetId: 1,
    name: "Ticket.number is immutable after PAID",
    objectType: "Ticket",
    condition: { field: "status", operator: "EQ", value: "PAID" } as const,
    expected: false,
    severity: "HIGH" as const,
  };

  it("lists every configured invariant for a target across all object types", () => {
    const db = freshDb();
    createBusinessInvariant(db, BASE);
    createBusinessInvariant(db, { ...BASE, name: "Campaign invariant", objectType: "Campaign" });
    expect(listBusinessInvariantsForTarget(db, 1)).toHaveLength(2);
  });

  it("updates only the fields provided, preserving the rest", () => {
    const db = freshDb();
    const id = createBusinessInvariant(db, BASE);
    updateBusinessInvariant(db, id, { severity: "CRITICAL" });
    const [invariant] = listBusinessInvariantsForTarget(db, 1);
    expect(invariant?.severity).toBe("CRITICAL");
    expect(invariant?.name).toBe(BASE.name);
  });

  it("rejects an update carrying an invalid condition before persisting anything", () => {
    const db = freshDb();
    const id = createBusinessInvariant(db, BASE);
    expect(() => updateBusinessInvariant(db, id, { condition: "state.status === 'PAID'" })).toThrow(InvalidInvariantConditionError);
    const [invariant] = listBusinessInvariantsForTarget(db, 1);
    expect(invariant?.condition).toEqual(BASE.condition);
  });

  it("deletes a configured invariant", () => {
    const db = freshDb();
    const id = createBusinessInvariant(db, BASE);
    deleteBusinessInvariant(db, id);
    expect(listBusinessInvariantsForTarget(db, 1)).toEqual([]);
  });
});
