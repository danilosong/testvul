import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import { testReplay, type ReplayTestOutcome } from "./replay-analyzer";

/**
 * Webhook Replay Protection Analysis (Section 13.26), integrating
 * directly with Section 13.13's Replay and Idempotency Analysis rather
 * than reimplementing its own comparison logic — a webhook callback is
 * itself just a FINANCIAL/SENSITIVE operation from `testReplay`'s point
 * of view. Layers one additional gate on top of `testReplay`'s own
 * LOCAL_FIXTURE requirement: the affected resource must also be an
 * explicit TEST_RESOURCE (Section 9.12/16, mirroring Section 13.25's
 * identical gate shape) before a callback is ever replayed — never
 * against a production, non-TEST_RESOURCE target.
 */
export type WebhookReplayGateOutcome = "TESTED" | "PASSIVE" | "INCONCLUSIVE";

export interface WebhookReplayGateParams {
  targetEnvironment: TargetEnvironmentClassification;
  isTestResource: boolean;
}

export function evaluateWebhookReplayGate(params: WebhookReplayGateParams): WebhookReplayGateOutcome {
  if (params.targetEnvironment !== "LOCAL_FIXTURE") return "PASSIVE";
  if (!params.isTestResource) return "INCONCLUSIVE";
  return "TESTED";
}

export type WebhookReplayProtectionOutcome = { status: "TESTED"; replay: ReplayTestOutcome } | { status: "PASSIVE" } | { status: "INCONCLUSIVE" };

export interface TestWebhookReplayProtectionParams extends WebhookReplayGateParams {
  operation: string;
  /** Sends the webhook callback once; called exactly twice (original, then replay) by `testReplay` once the gate allows it. */
  performCallback: () => Promise<unknown>;
}

export async function testWebhookReplayProtection(params: TestWebhookReplayProtectionParams): Promise<WebhookReplayProtectionOutcome> {
  const gate = evaluateWebhookReplayGate(params);
  if (gate !== "TESTED") return { status: gate };
  const replay = await testReplay({
    operation: params.operation,
    targetEnvironment: params.targetEnvironment,
    isFinancialOrSensitive: true,
    expectedIdempotent: true,
    performOperation: params.performCallback,
  });
  return { status: "TESTED", replay };
}
