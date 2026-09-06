import type { BusinessInvariantInput } from "./invariant-engine";

/**
 * The optional Payment State Integrity rule for Contest/Commerce profiles
 * (Section 13.27): a `paymentStatus` field value alone is never
 * sufficient for ticket/order eligibility — a provider-verified
 * transaction record must also be present. Built as an ordinary
 * `BusinessInvariant` (Section 13.17), the same generic mechanism every
 * other configured rule uses — this is a convenience preset, not a
 * separate rule engine, and it has zero effect on a scan unless the
 * operator explicitly creates it (Section 13.21's "no profile ever
 * presumes a default rule" principle applies here identically).
 */
export function buildPaymentStateIntegrityInvariantInput(targetId: number, objectType: string): BusinessInvariantInput {
  return {
    targetId,
    objectType,
    name: "Payment State Integrity: paymentStatus alone is never sufficient without a provider-verified transaction",
    condition: {
      or: [
        { field: "paymentStatus", operator: "NEQ", value: "PAID" },
        { field: "hasVerifiedTransaction", operator: "EQ", value: true },
      ],
    },
    expected: true,
    severity: "HIGH",
  };
}
