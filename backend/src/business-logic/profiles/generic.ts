import type { BusinessProfilePlugin, BusinessProfileContribution } from "./profile-plugin";

export interface GenericProfileContext {
  /** Every business object already discovered (Section 13.4), domain-agnostic. */
  discoveredObjectTypes: readonly string[];
}

export const GENERIC_ANALYSIS_TYPES = [
  "PARAMETER_CLASSIFICATION",
  "STATE_EXPOSURE",
  "WORKFLOW_OBSERVATION",
  "REPLAY_IDEMPOTENCY_OBSERVATION",
  "LIMIT_CANDIDATE",
] as const;

export type GenericAnalysisType = (typeof GENERIC_ANALYSIS_TYPES)[number];

export interface GenericAnalysisCandidate {
  source: "generic";
  objectType: string;
  analysisType: GenericAnalysisType;
}

/**
 * The Generic Profile: always active, and the only profile every scan
 * gets by default. It never presumes any domain-specific rule (no
 * Contest/Commerce/SaaS-shaped assumption) — its own output must be
 * identical whether or not any optional profile is also registered
 * (design.md Decision 36), which is exactly what Section 13.1's own test
 * verifies.
 */
export const GENERIC_PROFILE: BusinessProfilePlugin = {
  name: "generic",
  enabled: true,
  contribute(baseContext: unknown): BusinessProfileContribution {
    const context = baseContext as GenericProfileContext;
    const candidates: GenericAnalysisCandidate[] = context.discoveredObjectTypes.flatMap((objectType) =>
      GENERIC_ANALYSIS_TYPES.map((analysisType) => ({ source: "generic", objectType, analysisType })),
    );
    return { candidates, invariants: [] };
  },
};
