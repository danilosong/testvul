import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createBusinessInvariant, listBusinessInvariantsForTarget } from "./business-invariants-repository";
import { evaluateInvariant } from "./invariant-engine";
import { isValidCondition } from "./rule-engine";
import { buildPaymentStateIntegrityInvariantInput } from "./payment-state-integrity-rule";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-payment-state-integrity-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

describe("buildPaymentStateIntegrityInvariantInput (Section 13.27)", () => {
  it("produces valid declarative condition DSL data", () => {
    const input = buildPaymentStateIntegrityInvariantInput(1, "Ticket");
    expect(isValidCondition(input.condition)).toBe(true);
  });

  it("when configured, a fixture ticket with paymentStatus PAID but no verified transaction record violates the rule", () => {
    const db = freshTarget();
    const id = createBusinessInvariant(db, buildPaymentStateIntegrityInvariantInput(1, "Ticket"));
    const [invariant] = listBusinessInvariantsForTarget(db, 1);
    expect(invariant?.id).toBe(id);

    const result = evaluateInvariant(invariant!, { paymentStatus: "PAID", hasVerifiedTransaction: false });
    expect(result.violation).toBe(true);
  });

  it("when configured, a fixture ticket with paymentStatus PAID and a verified transaction record does not violate the rule", () => {
    const db = freshTarget();
    createBusinessInvariant(db, buildPaymentStateIntegrityInvariantInput(1, "Ticket"));
    const [invariant] = listBusinessInvariantsForTarget(db, 1);

    const result = evaluateInvariant(invariant!, { paymentStatus: "PAID", hasVerifiedTransaction: true });
    expect(result.violation).toBe(false);
  });

  it("has no effect at all when not configured — nothing exists to evaluate the same fixture ticket against", () => {
    const db = freshTarget();
    // Never calling createBusinessInvariant here at all.
    expect(listBusinessInvariantsForTarget(db, 1)).toEqual([]);
  });
});
