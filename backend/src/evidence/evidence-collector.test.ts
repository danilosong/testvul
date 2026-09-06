import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recordEvidence } from "./evidence-collector";
import { getEvidenceById } from "./evidence-repository";
import { loadEvidenceSettings } from "./evidence-settings";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-evidence-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  return { db, scanRunId: 1 };
}

describe("recordEvidence", () => {
  it("produces a complete evidence record for a sample test run, per the spec's own test requirement", () => {
    const { db, scanRunId } = freshScanRun();

    const id = recordEvidence(db, scanRunId, {
      authProfileId: 1,
      endpoint: "https://example.com/api/certificates/1",
      fieldPath: "certificate.certificateText",
      request: {
        method: "PATCH",
        url: "https://example.com/api/certificates/1",
        headers: { Authorization: "Bearer userA-secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ certificateText: "<strong data-security-test=\"abc\">SECURITY_TEST</strong>" }),
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificateText: "<strong data-security-test=\"abc\">SECURITY_TEST</strong>" }),
      },
      originalValue: "Some original certificate text",
      testValue: '<strong data-security-test="abc">SECURITY_TEST</strong>',
      verificationOutcome: "RAW_HTML",
      restoreStatus: "RESTORE_OK",
    });

    const record = getEvidenceById(db, id)!;

    expect(record.endpoint).toBe("https://example.com/api/certificates/1");
    expect(record.fieldPath).toBe("certificate.certificateText");
    expect(record.authProfileId).toBe(1);
    expect(record.requestSanitized).toBeTruthy();
    expect(record.responseSanitized).toBeTruthy();
    expect(record.originalValueSanitized).toBe("Some original certificate text");
    expect(record.testValueSanitized).toBe('<strong data-security-test="abc">SECURITY_TEST</strong>');
    expect(record.verificationOutcome).toBe("RAW_HTML");
    expect(record.restoreStatus).toBe("RESTORE_OK");
    expect(record.createdAt).toBeTruthy();
  });

  it("masks a credential in the persisted request without needing the caller to do anything special", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordEvidence(db, scanRunId, {
      endpoint: "https://example.com/api/settings",
      fieldPath: "analyticsGtm",
      request: { method: "PATCH", url: "https://example.com/api/settings", headers: { Authorization: "Bearer super-secret-token-value" } },
      response: { status: 200, headers: {}, body: "{}" },
      originalValue: "GTM-OLD1234",
      testValue: "GTM-NEW5678",
      verificationOutcome: "AUTHORIZED",
    });

    const record = getEvidenceById(db, id)!;
    const requestJson = JSON.stringify(record.requestSanitized);
    expect(requestJson).not.toContain("super-secret-token-value");
  });

  it("masks a sensitive-named field value even though it's not wrapped in an object with other fields", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordEvidence(db, scanRunId, {
      endpoint: "https://example.com/api/profile",
      fieldPath: "password",
      request: { method: "PATCH", url: "https://example.com/api/profile", headers: {} },
      response: { status: 200, headers: {}, body: "{}" },
      originalValue: "old-password-value",
      testValue: "new-password-value",
      verificationOutcome: "INCONCLUSIVE",
    });

    const record = getEvidenceById(db, id)!;
    expect(record.originalValueSanitized).not.toBe("old-password-value");
    expect(record.testValueSanitized).not.toBe("new-password-value");
  });

  it("redacts PII found in a response body even though the caller (a scanner) applied no masking of its own", () => {
    const { db, scanRunId } = freshScanRun();
    // Simulates a scanner that just forwards the raw upstream response,
    // with no awareness that it happens to contain a customer's email
    // and phone number.
    const id = recordEvidence(db, scanRunId, {
      endpoint: "https://example.com/api/profile/42",
      fieldPath: "profile",
      request: { method: "GET", url: "https://example.com/api/profile/42", headers: {} },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "customer@example.com", phone: "555-987-6543", name: "Jane" }),
      },
      originalValue: "n/a",
      testValue: "n/a",
      verificationOutcome: "INFO",
    });

    const record = getEvidenceById(db, id)!;
    const responseJson = JSON.stringify(record.responseSanitized);
    expect(responseJson).not.toContain("customer@example.com");
    expect(responseJson).not.toContain("555-987-6543");
    expect(responseJson).toContain("[REDACTED_EMAIL]");
  });

  it("persists an oversized response body truncated, with a hash and original size, rather than in full", () => {
    const { db, scanRunId } = freshScanRun();
    const fullBody = "A".repeat(5000);
    const id = recordEvidence(
      db,
      scanRunId,
      {
        endpoint: "https://example.com/api/big",
        fieldPath: "notes",
        request: { method: "GET", url: "https://example.com/api/big", headers: {} },
        response: { status: 200, headers: {}, body: fullBody },
        originalValue: "n/a",
        testValue: "n/a",
        verificationOutcome: "INFO",
      },
      loadEvidenceSettings({ maxEvidenceBodyBytes: 100 }),
    );

    const record = getEvidenceById(db, id)!;
    expect(record.truncated).toBe(true);
    expect(record.originalSize).toBe(5000);
    expect(record.contentHash).toBeTruthy();
    const responseBody = (record.responseSanitized as { body: string }).body;
    expect(responseBody.length).toBe(100);
    expect(responseBody).not.toBe(fullBody);
  });

  it("does not mark a within-limit body as truncated", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordEvidence(db, scanRunId, {
      endpoint: "https://example.com/api/small",
      fieldPath: "notes",
      request: { method: "GET", url: "https://example.com/api/small", headers: {} },
      response: { status: 200, headers: {}, body: "small body" },
      originalValue: "n/a",
      testValue: "n/a",
      verificationOutcome: "INFO",
    });

    const record = getEvidenceById(db, id)!;
    expect(record.truncated).toBe(false);
    expect(record.originalSize).toBeUndefined();
    expect(record.contentHash).toBeUndefined();
  });

  it("does not crash when a scanner has no original value to report (e.g. a canary-only test) and stores it as null", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordEvidence(db, scanRunId, {
      endpoint: "https://example.com/api/certificates/1",
      fieldPath: "certificateText",
      request: { method: "PATCH", url: "https://example.com/api/certificates/1", headers: {} },
      response: { status: 200, headers: {}, body: "{}" },
      originalValue: null,
      testValue: "<strong>marker</strong>",
      verificationOutcome: "RAW_HTML",
    });

    const record = getEvidenceById(db, id)!;
    expect(record.originalValueSanitized).toBeNull();
  });
});
