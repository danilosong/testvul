/**
 * The Fixed Pipeline Sequencer (Section 14.2): DNS Resolver → Scope
 * Validation → HTTP Discovery → Crawler+Browser Runtime Discovery → API
 * Discovery → JSON/DOM Analyzer → Operation Discovery → Business
 * Object/State Discovery → Candidate Generator → Eligibility
 * Classification → Authentication Mapping → Security Tests → Evidence →
 * Restore → Report. "Restore" is a logical checkpoint here, not a
 * separate execution step (design.md Decision 17) — the actual restore
 * for each mutating test already completed inside that test's own
 * Section 9 backup→mutate→verify→restore cycle, during the Security
 * Tests stage.
 */
export const PIPELINE_STAGES = [
  "DNS_RESOLVER",
  "SCOPE_VALIDATION",
  "HTTP_DISCOVERY",
  "CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY",
  "API_DISCOVERY",
  "JSON_DOM_ANALYZER",
  "OPERATION_DISCOVERY",
  "BUSINESS_OBJECT_STATE_DISCOVERY",
  "CANDIDATE_GENERATOR",
  "ELIGIBILITY_CLASSIFICATION",
  "AUTHENTICATION_MAPPING",
  "SECURITY_TESTS",
  "EVIDENCE",
  "RESTORE",
  "REPORT",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineStageStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface PipelineStageProgress {
  stage: PipelineStage;
  status: PipelineStageStatus;
  startedAt: number;
  finishedAt?: number;
}

/** Receives every stage result completed so far — a stage runner can read an earlier stage's output, but can never be scheduled before it. */
export type PipelineStageRunner<T = unknown> = (previousResults: Readonly<Partial<Record<PipelineStage, unknown>>>) => Promise<T>;

export interface RunPipelineParams {
  /** A stage with no runner supplied is simply skipped — it never blocks or reorders the rest of the fixed sequence. */
  stageRunners: Partial<Record<PipelineStage, PipelineStageRunner>>;
  onProgress?: (progress: Readonly<PipelineStageProgress>) => void;
}

export interface PipelineRunResult {
  results: Partial<Record<PipelineStage, unknown>>;
  progress: PipelineStageProgress[];
}

/**
 * Runs every supplied stage runner strictly in `PIPELINE_STAGES` order —
 * each stage is fully awaited before the next one is even started, so a
 * later stage can never begin while an earlier one (including every
 * mutating test's own per-resource restore, which completes inside the
 * Security Tests stage) is still in flight. A stage throwing stops the
 * sequence immediately; no later stage ever runs after a failure.
 */
export async function runPipeline(params: RunPipelineParams): Promise<PipelineRunResult> {
  const results: Partial<Record<PipelineStage, unknown>> = {};
  const progress: PipelineStageProgress[] = [];

  for (const stage of PIPELINE_STAGES) {
    const runner = params.stageRunners[stage];
    if (!runner) continue;

    const entry: PipelineStageProgress = { stage, status: "RUNNING", startedAt: Date.now() };
    progress.push(entry);
    params.onProgress?.({ ...entry });

    try {
      results[stage] = await runner(results);
      entry.status = "COMPLETED";
      entry.finishedAt = Date.now();
      params.onProgress?.({ ...entry });
    } catch (err) {
      entry.status = "FAILED";
      entry.finishedAt = Date.now();
      params.onProgress?.({ ...entry });
      throw err;
    }
  }

  return { results, progress };
}
