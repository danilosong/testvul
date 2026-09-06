export interface EvidenceSettings {
  /** A request/response body at or under this many bytes (post-sanitization)
   * is stored in full in `evidence`; a larger one is stored as a sanitized
   * prefix plus a content hash instead. Independent of `safe-http-client`'s
   * transport-level response-size limits (which bound what is ever read off
   * the wire at all, not what is worth persisting as evidence). */
  maxEvidenceBodyBytes: number;
  evidenceRetentionDays: number;
  browserEvidenceRetentionDays: number;
  auditEventRetentionDays: number;
}

export const DEFAULT_EVIDENCE_SETTINGS: EvidenceSettings = {
  maxEvidenceBodyBytes: 65_536,
  evidenceRetentionDays: 90,
  browserEvidenceRetentionDays: 30,
  auditEventRetentionDays: 365,
};

/**
 * The retention-policy settings scaffold: three distinct, independently
 * configurable values. A future Section 16 settings UI/API supplies
 * `overrides` from persisted operator configuration; automated cleanup
 * enforcement of the retention windows is intentionally not implemented
 * here (tasks.md 9.14) — this only establishes that the values exist and
 * can differ from one another.
 */
export function loadEvidenceSettings(overrides?: Partial<EvidenceSettings>): EvidenceSettings {
  return { ...DEFAULT_EVIDENCE_SETTINGS, ...overrides };
}
