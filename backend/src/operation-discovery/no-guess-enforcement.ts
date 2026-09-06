import { hasEligibleOperation, type DiscoveredOperation, type OperationConfidence } from "./discovered-operation";

export class NoWriteTemplateError extends Error {
  constructor(
    public readonly method: string,
    public readonly url: string,
  ) {
    super(`No eligible write-operation template for ${method} ${url} — refusing to guess a mutation exists`);
    this.name = "NoWriteTemplateError";
  }
}

export type WriteEligibility = "ELIGIBLE" | "SKIPPED_NO_WRITE_TEMPLATE";

/** The `candidates.eligibility_state` value a candidate with no eligible
 * write-operation template gets — computed here directly since
 * `candidate-eligibility` (Section 10) doesn't own this data yet. */
export function checkWriteEligibility(
  operations: readonly DiscoveredOperation[],
  method: string,
  url: string,
  minConfidence: OperationConfidence,
): WriteEligibility {
  return hasEligibleOperation(operations, method, url, minConfidence) ? "ELIGIBLE" : "SKIPPED_NO_WRITE_TEMPLATE";
}

/**
 * The guard every mutating scanner test must call before issuing its
 * request. Never inferring a write operation from a GET response is
 * enforced structurally here: there is no path through this function that
 * lets a caller proceed without an eligible `DiscoveredOperation`.
 */
export function assertWriteEligible(
  operations: readonly DiscoveredOperation[],
  method: string,
  url: string,
  minConfidence: OperationConfidence,
): void {
  if (!hasEligibleOperation(operations, method, url, minConfidence)) {
    throw new NoWriteTemplateError(method, url);
  }
}
