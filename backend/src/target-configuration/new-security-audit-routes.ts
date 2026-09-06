import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import { createNewSecurityAudit, InvalidNewSecurityAuditInputError, type NewSecurityAuditInput } from "./new-security-audit";
import { getTarget, listTargets, updateTargetEnvironment } from "./targets-repository";

export interface NewSecurityAuditRoutesOptions {
  db: Db;
}

export function newSecurityAuditRoutes(app: FastifyInstance, options: NewSecurityAuditRoutesOptions, done: () => void): void {
  const { db } = options;

  app.post<{ Body: NewSecurityAuditInput }>("/api/targets", async (request, reply) => {
    try {
      const id = createNewSecurityAudit(db, request.body);
      return reply.code(201).send(getTarget(db, id));
    } catch (err) {
      if (err instanceof InvalidNewSecurityAuditInputError) {
        return reply.code(400).send({ error: "INVALID_INPUT", details: err.errors });
      }
      throw err;
    }
  });

  app.get("/api/targets", async () => listTargets(db));

  app.get<{ Params: { id: string } }>("/api/targets/:id", async (request, reply) => {
    const target = getTarget(db, Number(request.params.id));
    if (!target) return reply.code(404).send({ error: "NOT_FOUND" });
    return target;
  });

  app.patch<{ Params: { id: string }; Body: { environment?: TargetEnvironmentClassification } }>("/api/targets/:id", async (request, reply) => {
    const { environment } = request.body;
    if (!environment || !(["LOCAL_FIXTURE", "DEVELOPMENT", "STAGING", "PRODUCTION"] as string[]).includes(environment)) {
      return reply.code(400).send({ error: "INVALID_ENVIRONMENT" });
    }
    if (!updateTargetEnvironment(db, Number(request.params.id), environment)) return reply.code(404).send({ error: "NOT_FOUND" });
    return getTarget(db, Number(request.params.id));
  });

  done();
}
