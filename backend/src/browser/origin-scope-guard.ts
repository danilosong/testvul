import { ScopeViolationError, type ScopeValidator } from "../scope";
import type { ObservedRequest } from "./network-observer";

/**
 * True only when the Scope Engine (Section 2/3) itself would authorize
 * this URL — never inferred from the fact that the browser's own
 * navigation happened to reach it. A third-party script, a cross-origin
 * fetch a page fires on its own, or any other origin the browser lands on
 * gets no implicit trust just because it was reachable; Section 12.1's
 * Controlled Egress Proxy already refuses to *connect* to it, and this is
 * the identical rule applied to what gets *recorded* as discovered/
 * authorized versus out-of-scope.
 */
export function isInScope(url: string, scopeValidator: ScopeValidator): boolean {
  try {
    scopeValidator.assertAllowed(url);
    return true;
  } catch (err) {
    if (err instanceof ScopeViolationError) return false;
    return false; // an unsupported scheme, malformed URL, etc. is also never treated as authorized
  }
}

export interface PartitionedObservations {
  inScope: ObservedRequest[];
  outOfScope: ObservedRequest[];
}

/**
 * Splits observed browser requests into in-scope (safe to feed into
 * operation registration/attack-surface merging) and out-of-scope (a
 * third-party domain the browser reached, recorded as exactly that —
 * never silently merged in as if it were authorized).
 */
export function partitionObservationsByScope(observations: readonly ObservedRequest[], scopeValidator: ScopeValidator): PartitionedObservations {
  const inScope: ObservedRequest[] = [];
  const outOfScope: ObservedRequest[] = [];
  for (const observation of observations) {
    (isInScope(observation.url, scopeValidator) ? inScope : outOfScope).push(observation);
  }
  return { inScope, outOfScope };
}
