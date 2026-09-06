export interface ActiveXssConfirmationOptions {
  /** Operator opt-in — "Enable active browser security validation." Never true by default. */
  enabled: boolean;
  /** The domain active confirmation must stay scoped to, regardless of what URL is passed. */
  authorizedDomain: string;
}

export type ActiveConfirmationOutcome = "EXECUTION_CONFIRMED" | "EXECUTION_NOT_OBSERVED" | "NOT_RUN";

/** A real browser-driven confirmation runner — provided by the Browser Security Testing Engine (Section 12), not yet built. */
export interface ActiveXssConfirmationRunner {
  confirmExecution(url: string): Promise<boolean>;
}

export class OutOfDomainConfirmationError extends Error {
  constructor(hostname: string, authorizedDomain: string) {
    super(`Active XSS Confirmation refused: ${hostname} is outside the authorized domain ${authorizedDomain}`);
    this.name = "OutOfDomainConfirmationError";
  }
}

function isWithinAuthorizedDomain(hostname: string, authorizedDomain: string): boolean {
  return hostname === authorizedDomain || hostname.endsWith(`.${authorizedDomain}`);
}

/**
 * The Active XSS Confirmation gate (design.md — `scanners-xss-gtm-idor`'s
 * Active XSS Confirmation Disabled by Default requirement): disabled
 * unless the operator has explicitly opted in, always re-validated against
 * the authorized domain regardless of opt-in, and EXECUTION_CONFIRMED is
 * only ever returned when a real runner actually ran and actually
 * observed execution — never inferred from a static classification, and
 * never the outcome when disabled or unavailable.
 */
export async function runActiveXssConfirmation(
  options: ActiveXssConfirmationOptions,
  resourceUrl: string,
  runner?: ActiveXssConfirmationRunner,
): Promise<ActiveConfirmationOutcome> {
  if (!options.enabled) return "NOT_RUN";

  const hostname = new URL(resourceUrl).hostname;
  if (!isWithinAuthorizedDomain(hostname, options.authorizedDomain)) {
    throw new OutOfDomainConfirmationError(hostname, options.authorizedDomain);
  }

  if (!runner) return "NOT_RUN";

  const executed = await runner.confirmExecution(resourceUrl);
  return executed ? "EXECUTION_CONFIRMED" : "EXECUTION_NOT_OBSERVED";
}
