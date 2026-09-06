import type { ReadIdorOutcome } from "../scanners/idor/read-idor-test";

/**
 * Predictability Analysis (Section 13.12): classifies a sequence of
 * legitimately-observed identifiers as SEQUENTIAL, RANDOM_LOOKING,
 * INSUFFICIENT_DATA, or POTENTIALLY_PREDICTABLE — arithmetic pattern
 * detection only, never a cryptographic attack (no brute-forcing, no
 * statistical randomness testing of a PRNG).
 */
export type PredictabilityClassification = "SEQUENTIAL" | "RANDOM_LOOKING" | "INSUFFICIENT_DATA" | "POTENTIALLY_PREDICTABLE";

const MIN_OBSERVATIONS = 3;
const POTENTIALLY_PREDICTABLE_MAX_STEP = 10;

export function classifyIdentifierPredictability(observedIds: readonly number[]): PredictabilityClassification {
  if (observedIds.length < MIN_OBSERVATIONS) return "INSUFFICIENT_DATA";

  const steps: number[] = [];
  for (let i = 1; i < observedIds.length; i++) {
    steps.push(observedIds[i]! - observedIds[i - 1]!);
  }

  if (steps.every((step) => step === 1)) return "SEQUENTIAL";

  const allPositive = steps.every((step) => step > 0);
  const maxStep = Math.max(...steps.map(Math.abs));
  if (allPositive && maxStep <= POTENTIALLY_PREDICTABLE_MAX_STEP) return "POTENTIALLY_PREDICTABLE";

  return "RANDOM_LOOKING";
}

/**
 * Predicts the next identifier from a SEQUENTIAL or POTENTIALLY_PREDICTABLE
 * sequence by extrapolating its average step — `null` for RANDOM_LOOKING or
 * INSUFFICIENT_DATA, where no prediction is defensible.
 */
export function predictNextIdentifier(observedIds: readonly number[]): number | null {
  const classification = classifyIdentifierPredictability(observedIds);
  if (classification !== "SEQUENTIAL" && classification !== "POTENTIALLY_PREDICTABLE") return null;

  const steps: number[] = [];
  for (let i = 1; i < observedIds.length; i++) {
    steps.push(observedIds[i]! - observedIds[i - 1]!);
  }
  const averageStep = Math.round(steps.reduce((sum, step) => sum + step, 0) / steps.length);
  return observedIds[observedIds.length - 1]! + averageStep;
}

export interface PredictabilityExploitationResult {
  classification: PredictabilityClassification;
  finding: boolean;
}

/**
 * A finding is raised only once predictability is *shown* to enable actual
 * unauthorized access — never from the classification alone. The
 * access-verification step reuses the Read IDOR test's positive-content
 * match (Section 15's false-positive fix): a predicted identifier that
 * merely returns 200 is insufficient; `accessOutcome` must already be the
 * confirmed `"POTENTIAL_BOLA"` outcome of testing the predicted id against
 * another user's real resource.
 */
export function analyzePredictabilityExploitation(
  classification: PredictabilityClassification,
  accessOutcome: ReadIdorOutcome,
): PredictabilityExploitationResult {
  const exploitable = classification === "SEQUENTIAL" || classification === "POTENTIALLY_PREDICTABLE";
  return { classification, finding: exploitable && accessOutcome === "POTENTIAL_BOLA" };
}
