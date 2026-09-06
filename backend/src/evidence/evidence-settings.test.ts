import { describe, expect, it } from "vitest";
import { loadEvidenceSettings, DEFAULT_EVIDENCE_SETTINGS } from "./evidence-settings";

describe("loadEvidenceSettings", () => {
  it("exposes maxEvidenceBodyBytes and the three retention settings as distinct, independently configurable values", () => {
    const settings = loadEvidenceSettings();
    expect(settings.maxEvidenceBodyBytes).toBeGreaterThan(0);
    expect(settings.evidenceRetentionDays).toBeGreaterThan(0);
    expect(settings.browserEvidenceRetentionDays).toBeGreaterThan(0);
    expect(settings.auditEventRetentionDays).toBeGreaterThan(0);

    // Distinct: not secretly aliases of one shared value.
    const values = [settings.evidenceRetentionDays, settings.browserEvidenceRetentionDays, settings.auditEventRetentionDays];
    expect(new Set(values).size).toBe(3);
  });

  it("allows overriding each retention value independently of the others", () => {
    const settings = loadEvidenceSettings({ evidenceRetentionDays: 7 });
    expect(settings.evidenceRetentionDays).toBe(7);
    expect(settings.browserEvidenceRetentionDays).toBe(DEFAULT_EVIDENCE_SETTINGS.browserEvidenceRetentionDays);
    expect(settings.auditEventRetentionDays).toBe(DEFAULT_EVIDENCE_SETTINGS.auditEventRetentionDays);
  });

  it("allows overriding maxEvidenceBodyBytes independently of the retention settings", () => {
    const settings = loadEvidenceSettings({ maxEvidenceBodyBytes: 1024 });
    expect(settings.maxEvidenceBodyBytes).toBe(1024);
    expect(settings.evidenceRetentionDays).toBe(DEFAULT_EVIDENCE_SETTINGS.evidenceRetentionDays);
  });
});
