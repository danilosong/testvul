import type { EligibilityState } from "./eligibility-classifier";
import type { CandidateRecord, EvidentiaryOutcome } from "./candidates-repository";

const INCONCLUSIVE_STATES: readonly EligibilityState[] = ["INCONCLUSIVE", "INCONCLUSIVE_BUSINESS_EXPECTATION", "INCONCLUSIVE_TRUST_BOUNDARY"];

/**
 * A candidate's outcome, as a discriminated union report/dashboard code
 * must switch on explicitly (per `candidate-eligibility`'s "Skipped and
 * Inconclusive Are Never Reported as Safe" requirement). There is no
 * `kind` shared between a candidate that was actually tested and one that
 * was skipped or left inconclusive — a caller that only handles `"TESTED"`
 * cannot silently treat a skipped candidate as if it were a clean result,
 * because it will not even have an `evidentiaryOutcome` to read.
 */
export type CandidateOutcomeSummary =
  | { kind: "TESTED"; evidentiaryOutcome: EvidentiaryOutcome }
  | { kind: "PASSIVE_ONLY" }
  | { kind: "INCONCLUSIVE" }
  | { kind: "SKIPPED"; reason: EligibilityState };

export function summarizeCandidateOutcome(candidate: Pick<CandidateRecord, "eligibilityState" | "evidentiaryOutcome">): CandidateOutcomeSummary {
  if (candidate.eligibilityState === "TESTABLE") {
    return { kind: "TESTED", evidentiaryOutcome: candidate.evidentiaryOutcome };
  }
  if (candidate.eligibilityState === "PASSIVE_ONLY") {
    return { kind: "PASSIVE_ONLY" };
  }
  if (INCONCLUSIVE_STATES.includes(candidate.eligibilityState)) {
    return { kind: "INCONCLUSIVE" };
  }
  return { kind: "SKIPPED", reason: candidate.eligibilityState };
}
