/**
 * The ExternalTrustBoundary/WebhookOperation model (Section 13.23,
 * `webhook_operations`, design.md Decision 42). Populated passively from a
 * discovered endpoint's shape/naming and any *observed* external-callback
 * traffic — never by synthesizing or sending a callback of its own. That
 * (a forged/unauthenticated callback) is exclusively Section 13.25's job,
 * itself gated to a LOCAL_FIXTURE target with the resource declared
 * TEST_RESOURCE.
 */
export interface WebhookOperationInput {
  scanRunId: number;
  endpoint: string;
  provider?: string;
  authenticationMechanism?: string;
  signatureMechanism?: string;
  replayProtection?: string;
  idempotency?: string;
  /** e.g. "Ticket: PENDING_PAYMENT -> PAID" — what the observed external call actually did, never a guess. */
  resultingStateTransition?: string;
}

export interface WebhookOperation extends WebhookOperationInput {
  id: number;
}

const WEBHOOK_SHAPED_ENDPOINT_PATTERN = /webhook|callback|\bhook\b|\bipn\b/i;

/** A purely structural signal from the endpoint's own path/name — never itself proof anything is actually a webhook. */
export function isWebhookShapedEndpoint(endpoint: string): boolean {
  return WEBHOOK_SHAPED_ENDPOINT_PATTERN.test(endpoint);
}

/** Describes an observed state transition in the one fixed shape every `WebhookOperation.resultingStateTransition` uses. */
export function describeStateTransition(objectType: string, fromState: string, toState: string): string {
  return `${objectType}: ${fromState} -> ${toState}`;
}
