import type { SecurityHttpClient } from "../http/security-http-client";
import { runPipeline, type PipelineRunResult } from "../scan-orchestration/pipeline-sequencer";

/**
 * Manual mode (Section 16.7): the operator supplies endpoint/method/
 * headers/body/authentication directly, bypassing discovery entirely.
 * Reuses the Fixed Pipeline Sequencer (Section 14.2) with only the
 * Security Tests stage's runner ever supplied — every other stage
 * (DNS Resolver, Scope Validation, HTTP Discovery, Crawler, API
 * Discovery, ...) has no runner at all, so `runPipeline` skips it
 * outright rather than this module needing its own separate "skip
 * discovery" logic.
 */
export interface ManualModeRequestInput {
  endpoint: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ManualModeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export async function runManualModeScan(httpClient: SecurityHttpClient, input: ManualModeRequestInput): Promise<PipelineRunResult> {
  return runPipeline({
    stageRunners: {
      SECURITY_TESTS: () =>
        httpClient.request(input.endpoint, {
          method: input.method,
          ...(input.headers !== undefined ? { headers: input.headers } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        }),
    },
  });
}
