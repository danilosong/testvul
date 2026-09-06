import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import { getDashboardData } from "./dashboard";
import { getAttackSurfaceTree, getEndpointDetail } from "./endpoint-detail";
import { listDiscoveredEndpointSummaries } from "../discovery/discovered-endpoints-repository";
import { getFinding } from "./finding-repository";
import { getFindingDetail } from "./finding-detail";
import { buildReportData, renderReportAsHtml, renderReportAsJson } from "./report";

export interface FindingsReportingRoutesOptions { db: Db }

export function findingsReportingRoutes(app: FastifyInstance, options: FindingsReportingRoutesOptions, done: () => void): void {
  const { db } = options;
  app.get<{ Params: { scanRunId: string } }>("/api/scan-runs/:scanRunId/dashboard", async (request, reply) => {
    try {
      return getDashboardData(db, Number(request.params.scanRunId));
    } catch (error) {
      if ((error as Error).message.startsWith("No scan run found")) return reply.code(404).send({ error: "NOT_FOUND" });
      throw error;
    }
  });
  app.get<{ Params: { scanRunId: string } }>("/api/scan-runs/:scanRunId/attack-surface", async (request, reply) => {
    const scanRunId = Number(request.params.scanRunId);
    if (!db.prepare("SELECT id FROM scan_runs WHERE id = ?").get(scanRunId)) return reply.code(404).send({ error: "NOT_FOUND" });
    return { tree: getAttackSurfaceTree(db, scanRunId), endpoints: listDiscoveredEndpointSummaries(db, scanRunId) };
  });
  app.get<{ Params: { endpointId: string } }>("/api/endpoints/:endpointId", async (request, reply) => {
    const detail = getEndpointDetail(db, Number(request.params.endpointId));
    if (!detail) return reply.code(404).send({ error: "NOT_FOUND" });
    return detail;
  });
  app.get<{ Params: { findingId: string } }>("/api/findings/:findingId", async (request, reply) => {
    const finding = getFinding(db, Number(request.params.findingId));
    if (!finding) return reply.code(404).send({ error: "NOT_FOUND" });
    return getFindingDetail(db, finding);
  });
  app.get<{ Params: { scanRunId: string; format: string } }>("/api/scan-runs/:scanRunId/reports/:format", async (request, reply) => {
    const format = request.params.format.toLowerCase();
    if (format !== "html" && format !== "json") return reply.code(400).send({ error: "UNSUPPORTED_REPORT_FORMAT" });
    try {
      const report = buildReportData(db, Number(request.params.scanRunId));
      reply.header("Content-Disposition", `attachment; filename=auditoria-${request.params.scanRunId}.${format}`);
      if (format === "html") return reply.type("text/html; charset=utf-8").send(renderReportAsHtml(report));
      return reply.type("application/json; charset=utf-8").send(renderReportAsJson(report));
    } catch (error) {
      if ((error as Error).message.startsWith("No scan run found")) return reply.code(404).send({ error: "NOT_FOUND" });
      throw error;
    }
  });
  done();
}
