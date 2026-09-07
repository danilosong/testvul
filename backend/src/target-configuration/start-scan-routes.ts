import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import { MutationAuthorizationRequiredError, startScan, type StartScanInput } from "./start-scan";
import { listAuditEvents, recordAuditEvent } from "../mutation/audit-events-repository";
import { PIPELINE_STAGES } from "../scan-orchestration/pipeline-sequencer";
import { requestScanCancellation } from "../scan-orchestration/scan-cancellation";
import { runLiveDiscoveryScan } from "../scan-orchestration/live-discovery-runner";

export interface StartScanRoutesOptions {
  db: Db;
}

export function startScanRoutes(app: FastifyInstance, options: StartScanRoutesOptions, done: () => void): void {
  const { db } = options;

  app.post<{ Params: { targetId: string }; Body: Omit<StartScanInput, "targetId"> }>("/api/targets/:targetId/scans", async (request, reply) => {
    try {
      const result = startScan(db, { targetId: Number(request.params.targetId), ...request.body });
      // Fire-and-forget: the HTTP response reports the scan run was created,
      // not that it finished — progress is polled via GET .../progress.
      void runLiveDiscoveryScan(db, result.scanRunId).catch((error: Error) => {
        app.log.error({ err: error, scanRunId: result.scanRunId }, "live discovery scan failed");
      });
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof MutationAuthorizationRequiredError) {
        return reply.code(403).send({ error: "MUTATION_AUTHORIZATION_REQUIRED", message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { scanRunId: string } }>("/api/scan-runs/:scanRunId/progress", async (request, reply) => {
    const scanRunId = Number(request.params.scanRunId);
    const scanRun = db.prepare("SELECT state, cancellation_requested_at FROM scan_runs WHERE id = ?").get(scanRunId) as
      | { state: string; cancellation_requested_at: string | null }
      | undefined;
    if (!scanRun) return reply.code(404).send({ error: "NOT_FOUND" });
    const events = listAuditEvents(db, scanRunId);
    const stages = PIPELINE_STAGES.map((stage) => {
      const matching = events.filter((event) => event.eventType.startsWith(`STAGE_${stage}_`));
      const last = matching.at(-1);
      return { stage, status: last?.eventType.slice(`STAGE_${stage}_`.length) ?? "PENDING" };
    });
    return { scanRunId, state: scanRun.state, cancellationRequested: scanRun.cancellation_requested_at !== null, stages, events };
  });

  app.post<{ Params: { scanRunId: string }; Body: { requestedBy?: string } }>("/api/scan-runs/:scanRunId/cancel", async (request, reply) => {
    const scanRunId = Number(request.params.scanRunId);
    if (!db.prepare("SELECT id FROM scan_runs WHERE id = ?").get(scanRunId)) return reply.code(404).send({ error: "NOT_FOUND" });
    const requestedBy = request.body.requestedBy?.trim() || "ui-operator";
    requestScanCancellation(db, scanRunId, requestedBy);
    recordAuditEvent(db, scanRunId, "SCAN_CANCELLATION_REQUESTED", { requestedBy });
    return reply.code(202).send({ scanRunId, cancellationRequested: true });
  });

  done();
}
