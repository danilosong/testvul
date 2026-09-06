import type { Db } from "../db/connection";
import { recordObservedProperty } from "./business-observed-properties-repository";
import { compareObservationAgainstExpectation, type BusinessExpectationComparisonResult } from "./business-expectation-comparison";
import { fingerprint } from "../evidence/sanitize-evidence";

export type StateExposureLocation = "API" | "HTML" | "JS" | "BROWSER_STORAGE" | "GRAPHQL";

export type StateExposureState = "PUBLIC" | "PRIVATE";

/** Fixed denylist of credential-shaped key names (Section 13.10) — matched case-insensitively as a substring, so `accessToken`/`refreshToken` are caught by `token` alone. */
const CREDENTIAL_SHAPED_KEY_PATTERN = /token|authorization|session|jwt|secret|apikey/i;

export function isCredentialShapedKey(keyName: string): boolean {
  return CREDENTIAL_SHAPED_KEY_PATTERN.test(keyName);
}

export interface RecordStateExposureParams {
  db: Db;
  scanRunId: number;
  objectType: string;
  fieldName: string;
  location: StateExposureLocation;
  /** Whether the field's value was actually observed present at this location — the sole mechanical fact recorded. */
  exposed: boolean;
  /** The field's raw value — used only to compute a fingerprint for a credential-shaped key; never itself persisted. */
  rawValue?: unknown;
}

/**
 * Records a State Exposure observation as an `ObservedProperty` (Section
 * 13.2). For a credential-shaped key, only key-name presence and a
 * sanitized fingerprint are ever persisted — never the raw value.
 */
export function recordStateExposureObservation(params: RecordStateExposureParams): void {
  const exposureState: StateExposureState = params.exposed ? "PUBLIC" : "PRIVATE";
  const observedValue: unknown = isCredentialShapedKey(params.fieldName)
    ? { location: params.location, keyPresent: params.exposed, fingerprint: params.exposed ? fingerprint(String(params.rawValue)) : null }
    : { location: params.location, exposureState };

  recordObservedProperty(params.db, { scanRunId: params.scanRunId, objectType: params.objectType, propertyOrAction: params.fieldName, observedValue });
}

export interface AnalyzeStateExposureParams {
  db: Db;
  scanRunId: number;
  targetId: number;
  objectType: string;
  fieldName: string;
  location: StateExposureLocation;
  exposed: boolean;
  rawValue?: unknown;
  /** The object's current field state — evaluated against any configured `lifecycleCondition` (e.g. whether a campaign is closed). */
  currentObjectState: Record<string, unknown>;
}

export type StateExposureAnalysisResult =
  | { credentialShaped: true }
  | { credentialShaped: false; comparison: BusinessExpectationComparisonResult; finding: boolean };

/**
 * State Exposure Analysis (Section 13.10): a Potential Business State
 * Exposure finding is raised only when the observed exposure state
 * (PUBLIC/PRIVATE) contradicts a configured VISIBILITY `BusinessExpectation`
 * (honoring any `lifecycleCondition`) — an unconfigured expectation is
 * INCONCLUSIVE_BUSINESS_EXPECTATION, never a finding. A credential-shaped
 * key is never compared against any expectation at all — its mere
 * presence can never itself become a finding here.
 */
export function analyzeStateExposure(params: AnalyzeStateExposureParams): StateExposureAnalysisResult {
  recordStateExposureObservation(params);

  if (isCredentialShapedKey(params.fieldName)) {
    return { credentialShaped: true };
  }

  const exposureState: StateExposureState = params.exposed ? "PUBLIC" : "PRIVATE";
  const comparison = compareObservationAgainstExpectation({
    db: params.db,
    targetId: params.targetId,
    objectType: params.objectType,
    propertyOrAction: params.fieldName,
    observedValue: exposureState,
    currentObjectState: params.currentObjectState,
  });

  return { credentialShaped: false, comparison, finding: comparison === "CONTRADICTION" };
}
