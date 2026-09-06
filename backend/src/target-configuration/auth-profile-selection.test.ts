import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createAuthProfile, getAuthProfile, getDecryptedCredential } from "../auth/auth-profiles-repository";
import { buildAuthHeaders } from "../scan-orchestration/auth-header-mapping";
import { createNewSecurityAudit } from "./new-security-audit";
import { startScan } from "./start-scan";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
let originalKeyEnv: string | undefined;

beforeAll(() => {
  originalKeyEnv = process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterAll(() => {
  if (originalKeyEnv === undefined) delete process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = originalKeyEnv;
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): { db: Db; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-auth-profile-selection-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com" });
  return { db, targetId };
}

describe("Section 16.8 — authentication profile selection wired into audit creation", () => {
  it("multiple selected profiles are all available to security tests during that scan run", () => {
    const { db, targetId } = freshTarget();
    const userAId = createAuthProfile(db, { name: "userA", method: "BEARER", credential: "userA-token" });
    const userBId = createAuthProfile(db, { name: "userB", method: "BEARER", credential: "userB-token" });
    const adminId = createAuthProfile(db, { name: "admin", method: "BEARER", credential: "admin-token" });

    const { scanRunId } = startScan(db, { targetId, authProfileIds: [userAId, userBId] });

    const selectedRows = db.prepare("SELECT auth_profile_id FROM scan_run_auth_profiles WHERE scan_run_id = ? ORDER BY auth_profile_id").all(scanRunId) as {
      auth_profile_id: number;
    }[];
    expect(selectedRows.map((r) => r.auth_profile_id)).toEqual([userAId, userBId]);
    expect(selectedRows.map((r) => r.auth_profile_id)).not.toContain(adminId);

    // Each selected profile independently resolves to real, usable auth headers for a security test.
    for (const [id, expectedToken] of [
      [userAId, "userA-token"],
      [userBId, "userB-token"],
    ] as const) {
      const profile = getAuthProfile(db, id)!;
      const credential = getDecryptedCredential(db, id)!;
      expect(buildAuthHeaders(profile.method, credential)).toEqual({ Authorization: `Bearer ${expectedToken}` });
    }
  });

  it("a scan started with no explicit selection has no auth profiles associated", () => {
    const { db, targetId } = freshTarget();
    const { scanRunId } = startScan(db, { targetId });
    expect(db.prepare("SELECT COUNT(*) as c FROM scan_run_auth_profiles WHERE scan_run_id = ?").get(scanRunId)).toEqual({ c: 0 });
  });
});
