import type { PermissionQueryResult } from "../../auth/authorization-expectation";
import type { GtmPermissionOutcome } from "./gtm-permission-test";

export type GtmFindingClassification = "AUTHORIZATION_POLICY_VIOLATION" | "NO_FINDING" | "INCONCLUSIVE_PERMISSION_EXPECTATION";

/**
 * Gates a GTM permission test's outcome on Section 8.8's Expected
 * Permission Policy (`authorization_expectations`) rather than treating
 * every AUTHORIZED result as a finding: an AUTHORIZED result only becomes
 * an Authorization Policy Violation finding when it contradicts a
 * configured DENIED expectation. An AUTHORIZED result matching a
 * configured ALLOWED expectation (e.g. an Admin profile) produces no
 * finding, and an AUTHORIZED result with no configured expectation at all
 * is INCONCLUSIVE_PERMISSION_EXPECTATION rather than silently assumed
 * either way. UNAUTHORIZED/VALIDATION_REJECTED/INCONCLUSIVE outcomes never
 * produce a finding here — a rejected or ambiguous mutation attempt is not
 * itself a policy violation.
 */
export function evaluateGtmPermissionFinding(outcome: GtmPermissionOutcome, expectation: PermissionQueryResult): GtmFindingClassification {
  if (outcome !== "AUTHORIZED") return "NO_FINDING";
  if (expectation === "NO_EXPECTATION_CONFIGURED") return "INCONCLUSIVE_PERMISSION_EXPECTATION";
  if (expectation === "DENIED") return "AUTHORIZATION_POLICY_VIOLATION";
  return "NO_FINDING";
}
