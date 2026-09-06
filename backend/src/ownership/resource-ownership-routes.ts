import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import { declareResourceOwnership, deleteResourceOwnership, listResourceOwnership } from "./resource-ownership-repository";
import type { ResourceOwnershipInput } from "./resource-ownership";

export interface ResourceOwnershipRoutesOptions {
  db: Db;
}

export function resourceOwnershipRoutes(app: FastifyInstance, options: ResourceOwnershipRoutesOptions, done: () => void): void {
  const { db } = options;

  app.post<{ Body: ResourceOwnershipInput }>("/api/resource-ownership", async (request, reply) => {
    const { resourceKey, ownerAuthProfileId } = request.body;
    if (!resourceKey?.targetId || !resourceKey.origin || !resourceKey.objectType || !resourceKey.resourceId || !ownerAuthProfileId) {
      return reply
        .code(400)
        .send({ error: "resourceKey (targetId, origin, objectType, resourceId) and ownerAuthProfileId are required" });
    }
    const id = declareResourceOwnership(db, request.body);
    return reply.code(201).send({ id, ...request.body });
  });

  app.get<{ Querystring: { targetId: string } }>("/api/resource-ownership", async (request, reply) => {
    const targetId = Number(request.query.targetId);
    if (!targetId) return reply.code(400).send({ error: "targetId query parameter is required" });
    return listResourceOwnership(db, targetId);
  });

  app.delete<{ Params: { id: string } }>("/api/resource-ownership/:id", async (request, reply) => {
    if (!deleteResourceOwnership(db, Number(request.params.id))) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.code(204).send();
  });

  done();
}
