import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import { setAuthorizationExpectation, getAuthorizationExpectation, listAuthorizationExpectations } from "./authorization-expectations-repository";
import type { AuthorizationExpectationInput } from "./authorization-expectation";

export interface AuthorizationExpectationsRoutesOptions {
  db: Db;
}

export function authorizationExpectationsRoutes(
  app: FastifyInstance,
  options: AuthorizationExpectationsRoutesOptions,
  done: () => void,
): void {
  const { db } = options;

  app.post<{ Body: AuthorizationExpectationInput }>("/api/authorization-expectations", async (request, reply) => {
    const { authProfileId, action, expected } = request.body;
    if (!authProfileId || !action || !expected) {
      return reply.code(400).send({ error: "authProfileId, action, and expected are required" });
    }
    const id = setAuthorizationExpectation(db, request.body);
    return reply.code(201).send({ id, ...request.body });
  });

  app.get<{ Querystring: { authProfileId: string; action?: string } }>("/api/authorization-expectations", async (request, reply) => {
    const authProfileId = Number(request.query.authProfileId);
    if (!authProfileId) return reply.code(400).send({ error: "authProfileId query parameter is required" });
    if (request.query.action) {
      return { expected: getAuthorizationExpectation(db, authProfileId, request.query.action) };
    }
    return listAuthorizationExpectations(db, authProfileId);
  });

  done();
}
