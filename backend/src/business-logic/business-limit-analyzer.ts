import type { Locator } from "playwright";

/**
 * Business Limit representation and enforcement testing (Section 13.16),
 * built on Section 12's client-side-limit detection: reads a control's raw
 * disabled/hidden/readonly DOM state to identify a UI-only limit — never
 * itself proof the backend enforces anything, purely an observation of
 * what the UI currently shows.
 */
export type ClientLimitSignal = "DISABLED" | "HIDDEN" | "READONLY" | "NONE";

export interface ClientLimitElementState {
  disabled: boolean;
  hidden: boolean;
  readonly: boolean;
}

export function classifyClientLimitSignal(state: ClientLimitElementState): ClientLimitSignal {
  if (state.disabled) return "DISABLED";
  if (state.hidden) return "HIDDEN";
  if (state.readonly) return "READONLY";
  return "NONE";
}

/** Reads a single control's raw disabled/hidden/readonly DOM state, unclassified. */
export async function observeClientLimitElementState(locator: Locator): Promise<ClientLimitElementState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return locator.evaluate((el: any) => ({
    disabled: !!el.disabled,
    hidden: el.hidden === true || el.style?.display === "none",
    readonly: !!el.readOnly,
  }));
}

export interface BusinessLimitEnforcementResult {
  clientLimitSignal: ClientLimitSignal;
  backendAccepted: boolean;
  /** Raised only when the UI signaled a limit (disabled/hidden/readonly) yet the backend still accepted a request beyond it — Server-Side Business Limit Not Enforced. */
  finding: boolean;
}

export function evaluateBusinessLimitEnforcement(clientLimitSignal: ClientLimitSignal, backendAccepted: boolean): BusinessLimitEnforcementResult {
  return { clientLimitSignal, backendAccepted, finding: clientLimitSignal !== "NONE" && backendAccepted };
}

export interface TestBusinessLimitEnforcementParams {
  observeClientLimitSignal: () => Promise<ClientLimitSignal>;
  /** Sends a request beyond the observed UI limit directly to the backend, bypassing the UI control entirely. */
  attemptOverLimitRequest: () => Promise<{ accepted: boolean }>;
}

export async function testBusinessLimitEnforcement(params: TestBusinessLimitEnforcementParams): Promise<BusinessLimitEnforcementResult> {
  const clientLimitSignal = await params.observeClientLimitSignal();
  const { accepted } = await params.attemptOverLimitRequest();
  return evaluateBusinessLimitEnforcement(clientLimitSignal, accepted);
}
