import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import {
  createBusinessExpectation,
  deleteBusinessExpectation,
  listBusinessExpectationsForTarget,
  updateBusinessExpectation,
} from "./business-expectations-repository";
import type { BusinessExpectationInput } from "./business-expectation";
import {
  createBusinessInvariant,
  deleteBusinessInvariant,
  listBusinessInvariantsForTarget,
  updateBusinessInvariant,
} from "./business-invariants-repository";
import type { BusinessInvariantInput } from "./invariant-engine";
import { listTargetBusinessProfiles, setTargetBusinessProfileEnabled } from "./target-business-profiles-repository";
import { listAllObservedPropertiesForScanRun } from "./business-observed-properties-repository";
import { listBusinessFindings } from "./business-findings-repository";

export interface BusinessLogicRulesRoutesOptions {
  db: Db;
}

/**
 * The Business Logic Rules management API (Section 13.22): enable/disable
 * profiles, and full CRUD over Generic `BusinessExpectation` and
 * `BusinessInvariant` entries — the same entries the Contest Profile's
 * "rule fields" are, just scoped to Contest-shaped object types, so no
 * separate mechanism exists for those. Also serves the read-only data
 * behind the Observed Behavior and Violations views, kept as distinct
 * endpoints from Configured Rules so the three views can never be
 * conflated client-side.
 */
export function businessLogicRulesRoutes(app: FastifyInstance, options: BusinessLogicRulesRoutesOptions, done: () => void): void {
  const { db } = options;

  // ── Configured Rules: profile enablement ────────────────────────────

  app.get<{ Params: { targetId: string } }>("/api/targets/:targetId/business-profiles", async (request, reply) => {
    const targetId = Number(request.params.targetId);
    if (!targetId) return reply.code(400).send({ error: "targetId must be a positive integer" });
    return listTargetBusinessProfiles(db, targetId);
  });

  app.put<{ Params: { targetId: string; profileName: string }; Body: { enabled: boolean } }>(
    "/api/targets/:targetId/business-profiles/:profileName",
    async (request, reply) => {
      const targetId = Number(request.params.targetId);
      if (!targetId) return reply.code(400).send({ error: "targetId must be a positive integer" });
      if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ error: "enabled (boolean) is required" });
      setTargetBusinessProfileEnabled(db, targetId, request.params.profileName, request.body.enabled);
      return reply.code(204).send();
    },
  );

  // ── Configured Rules: BusinessExpectation CRUD ──────────────────────

  app.get<{ Querystring: { targetId: string } }>("/api/business-expectations", async (request, reply) => {
    const targetId = Number(request.query.targetId);
    if (!targetId) return reply.code(400).send({ error: "targetId query parameter is required" });
    return listBusinessExpectationsForTarget(db, targetId);
  });

  app.post<{ Body: BusinessExpectationInput }>("/api/business-expectations", async (request, reply) => {
    const { targetId, objectType, propertyOrAction, expectationType, expectedValue, severity } = request.body;
    if (!targetId || !objectType || !propertyOrAction || !expectationType || !expectedValue || !severity) {
      return reply.code(400).send({ error: "targetId, objectType, propertyOrAction, expectationType, expectedValue, and severity are required" });
    }
    const id = createBusinessExpectation(db, request.body);
    return reply.code(201).send({ id, ...request.body });
  });

  app.patch<{ Params: { id: string }; Body: Parameters<typeof updateBusinessExpectation>[2] }>(
    "/api/business-expectations/:id",
    async (request, reply) => {
      updateBusinessExpectation(db, Number(request.params.id), request.body);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>("/api/business-expectations/:id", async (request, reply) => {
    deleteBusinessExpectation(db, Number(request.params.id));
    return reply.code(204).send();
  });

  // ── Configured Rules: BusinessInvariant CRUD ────────────────────────

  app.get<{ Querystring: { targetId: string } }>("/api/business-invariants", async (request, reply) => {
    const targetId = Number(request.query.targetId);
    if (!targetId) return reply.code(400).send({ error: "targetId query parameter is required" });
    return listBusinessInvariantsForTarget(db, targetId);
  });

  app.post<{ Body: BusinessInvariantInput }>("/api/business-invariants", async (request, reply) => {
    const { targetId, name, objectType, condition, expected, severity } = request.body;
    if (!targetId || !name || !objectType || condition === undefined || expected === undefined || !severity) {
      return reply.code(400).send({ error: "targetId, name, objectType, condition, expected, and severity are required" });
    }
    const id = createBusinessInvariant(db, request.body);
    return reply.code(201).send({ id, ...request.body });
  });

  app.patch<{ Params: { id: string }; Body: Parameters<typeof updateBusinessInvariant>[2] }>(
    "/api/business-invariants/:id",
    async (request, reply) => {
      updateBusinessInvariant(db, Number(request.params.id), request.body);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>("/api/business-invariants/:id", async (request, reply) => {
    deleteBusinessInvariant(db, Number(request.params.id));
    return reply.code(204).send();
  });

  // ── Observed Behavior (read-only, from business_observed_properties) ──

  app.get<{ Params: { scanRunId: string } }>("/api/scan-runs/:scanRunId/observed-properties", async (request, reply) => {
    const scanRunId = Number(request.params.scanRunId);
    if (!scanRunId) return reply.code(400).send({ error: "scanRunId must be a positive integer" });
    return listAllObservedPropertiesForScanRun(db, scanRunId);
  });

  // ── Violations (read-only, from findings) ───────────────────────────

  app.get<{ Params: { scanRunId: string } }>("/api/scan-runs/:scanRunId/findings", async (request, reply) => {
    const scanRunId = Number(request.params.scanRunId);
    if (!scanRunId) return reply.code(400).send({ error: "scanRunId must be a positive integer" });
    return listBusinessFindings(db, scanRunId);
  });

  // ── Minimal scan-run listing, only so the UI can pick a scan run ────

  app.get<{ Params: { targetId: string } }>("/api/targets/:targetId/scan-runs", async (request, reply) => {
    const targetId = Number(request.params.targetId);
    if (!targetId) return reply.code(400).send({ error: "targetId must be a positive integer" });
    const rows = db
      .prepare("SELECT id, state, started_at as startedAt FROM scan_runs WHERE target_id = ? ORDER BY id DESC")
      .all(targetId) as unknown as { id: number; state: string; startedAt: string }[];
    return rows;
  });

  done();
}
