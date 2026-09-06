import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createNewSecurityAudit, InvalidNewSecurityAuditInputError, validateNewSecurityAuditInput } from "./new-security-audit";
import { getTarget } from "./targets-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-new-security-audit-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("validateNewSecurityAuditInput (Section 16.1)", () => {
  it("requires Target DNS", () => {
    expect(validateNewSecurityAuditInput({ projectName: "My Project" })).toEqual(["MISSING_TARGET_DNS"]);
  });

  it("requires Project Name", () => {
    expect(validateNewSecurityAuditInput({ targetDns: "example.com" })).toEqual(["MISSING_PROJECT_NAME"]);
  });

  it("passes with both required fields present", () => {
    expect(validateNewSecurityAuditInput({ projectName: "My Project", targetDns: "example.com" })).toEqual([]);
  });

  it("the simplified default always satisfies Target-Must-Be-Within-Scope (Section 16.4)", () => {
    expect(validateNewSecurityAuditInput({ projectName: "My Project", targetDns: "example.com" })).toEqual([]);
    expect(
      validateNewSecurityAuditInput({ projectName: "My Project", targetDns: "example.com", includeSubdomains: true }),
    ).toEqual([]);
  });

  it("rejects an Advanced Scope configuration that excludes the Target DNS itself (Section 16.4)", () => {
    expect(
      validateNewSecurityAuditInput({
        projectName: "My Project",
        targetDns: "example.com",
        advancedScope: ["other-host.example.org"],
      }),
    ).toEqual(["TARGET_NOT_IN_SCOPE"]);
  });

  it("accepts an Advanced Scope configuration that does cover the Target DNS", () => {
    expect(
      validateNewSecurityAuditInput({
        projectName: "My Project",
        targetDns: "example.com",
        advancedScope: ["example.com", "other-host.example.org"],
      }),
    ).toEqual([]);
  });

  it("rejects a Target DNS that is only whitespace", () => {
    expect(validateNewSecurityAuditInput({ projectName: "My Project", targetDns: "   " })).toEqual(["MISSING_TARGET_DNS"]);
  });
});

describe("createNewSecurityAudit (Section 16.1)", () => {
  it("rejects submission without Target DNS, never persisting anything", () => {
    const db = freshDb();
    expect(() => createNewSecurityAudit(db, { projectName: "My Project" })).toThrow(InvalidNewSecurityAuditInputError);
    expect(db.prepare("SELECT COUNT(*) as c FROM targets").get() as { c: number }).toEqual({ c: 0 });
  });

  it("creates the target once both required fields are present", () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com" });
    const target = getTarget(db, targetId);
    expect(target?.name).toBe("My Project");
    expect(target?.hostname).toBe("example.com");
  });

  it("normalizes the Target DNS input (Section 16.2) before persisting it", () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "https://API.Example.com/some/path" });
    const target = getTarget(db, targetId);
    expect(target?.hostname).toBe("api.example.com");
    expect(target?.scope).toEqual(["api.example.com"]);
  });

  it("the 'Include authorized subdomains' checkbox expands the persisted scope (Section 16.3)", () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com", includeSubdomains: true });
    expect(getTarget(db, targetId)?.scope).toEqual(["example.com", "*.example.com"]);
  });

  it("rejects creation when Advanced Scope excludes the Target DNS itself, persisting nothing (Section 16.4)", () => {
    const db = freshDb();
    expect(() =>
      createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com", advancedScope: ["other-host.example.org"] }),
    ).toThrow(InvalidNewSecurityAuditInputError);
    expect(db.prepare("SELECT COUNT(*) as c FROM targets").get() as { c: number }).toEqual({ c: 0 });
  });

  it("Advanced Scope overrides the simplified default when creating the audit (Section 16.3)", () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, {
      projectName: "My Project",
      targetDns: "example.com",
      advancedScope: ["example.com", "other.example.org"],
    });
    expect(getTarget(db, targetId)?.scope).toEqual(["example.com", "other.example.org"]);
  });

  it("defaults localhost to DEVELOPMENT unless the operator explicitly chooses LOCAL_FIXTURE (Section 16.10)", () => {
    const db = freshDb();
    const implicitId = createNewSecurityAudit(db, { projectName: "Local implicit", targetDns: "localhost" });
    const explicitId = createNewSecurityAudit(db, { projectName: "Local explicit", targetDns: "localhost", environment: "LOCAL_FIXTURE" });
    expect(getTarget(db, implicitId)?.environment).toBe("DEVELOPMENT");
    expect(getTarget(db, explicitId)?.environment).toBe("LOCAL_FIXTURE");
  });

  it("defaults a PRODUCTION target to Passive/Safe-Read behavior (Section 16.10)", () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, { projectName: "Produção", targetDns: "example.com", environment: "PRODUCTION" });
    expect(getTarget(db, targetId)).toEqual(expect.objectContaining({ environment: "PRODUCTION", defaultScanMode: "PASSIVE" }));
  });
});
