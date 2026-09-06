import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";

/**
 * Webhook State Transition and Trust Boundary Testing (Section 13.25).
 * Unlike Section 13.23/13.24 (passive observation only), this is the one
 * place in the whole webhook model that ever forges an unauthenticated or
 * invalidly-signed callback — and it does so only against a target whose
 * Environment Classification is LOCAL_FIXTURE AND whose affected resource
 * is an explicit TEST_RESOURCE (Section 9.12/16), reusing the exact same
 * environment+mutation-scope gate as any other mutation (design.md
 * Decision 42) rather than a special-cased webhook-only permission model.
 */
export type WebhookTrustBoundaryGateOutcome = "TESTED" | "PASSIVE" | "INCONCLUSIVE";

export interface WebhookTrustBoundaryGateParams {
  targetEnvironment: TargetEnvironmentClassification;
  isTestResource: boolean;
}

/** A non-LOCAL_FIXTURE target is a hard exclusion (PASSIVE — never even considered for forging); a LOCAL_FIXTURE target whose resource isn't declared TEST_RESOURCE is INCONCLUSIVE — eligible in principle, but not yet authorized for this specific resource. */
export function evaluateWebhookTrustBoundaryGate(params: WebhookTrustBoundaryGateParams): WebhookTrustBoundaryGateOutcome {
  if (params.targetEnvironment !== "LOCAL_FIXTURE") return "PASSIVE";
  if (!params.isTestResource) return "INCONCLUSIVE";
  return "TESTED";
}

export type WebhookTrustBoundaryTestOutcome =
  | { status: "TESTED"; accepted: boolean; causedStateTransition: boolean; finding: boolean }
  | { status: "PASSIVE" }
  | { status: "INCONCLUSIVE" };

export interface TestWebhookTrustBoundaryParams extends WebhookTrustBoundaryGateParams {
  /** Sends the unauthenticated/invalidly-signed callback and reports whether it was accepted and whether it actually caused a real state transition; never invoked when the gate blocks. */
  performForgedCallback: () => Promise<{ accepted: boolean; stateTransitionOccurred: boolean }>;
}

/** A BUSINESS_TRUST_BOUNDARY finding is raised only once the forged callback is shown to be both accepted AND to have actually caused a real state transition — accepted-but-inert (e.g. 200 with no effect) is not itself a finding. */
export async function testWebhookTrustBoundary(params: TestWebhookTrustBoundaryParams): Promise<WebhookTrustBoundaryTestOutcome> {
  const gate = evaluateWebhookTrustBoundaryGate(params);
  if (gate !== "TESTED") return { status: gate };
  const { accepted, stateTransitionOccurred } = await params.performForgedCallback();
  return { status: "TESTED", accepted, causedStateTransition: stateTransitionOccurred, finding: accepted && stateTransitionOccurred };
}
