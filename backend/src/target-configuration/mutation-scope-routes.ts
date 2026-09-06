import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import {
  addMutationScopeEntry,
  deleteMutationScopeEntry,
  listMutationScopeEntryRecords,
  type MutationScopeEntryInput,
} from "../mutation/mutation-scope";
import { getTarget } from "./targets-repository";

export interface MutationScopeRoutesOptions {
  db: Db;
}

export function mutationScopeRoutes(app: FastifyInstance, options: MutationScopeRoutesOptions, done: () => void): void {
  const { db } = options;

  app.get<{ Params: { targetId: string } }>("/api/targets/:targetId/mutation-scope", async (request, reply) => {
    const targetId = Number(request.params.targetId);
    if (!getTarget(db, targetId)) return reply.code(404).send({ error: "NOT_FOUND" });
    return listMutationScopeEntryRecords(db, targetId);
  });

  app.post<{ Params: { targetId: string }; Body: Omit<MutationScopeEntryInput, "targetId"> }>(
    "/api/targets/:targetId/mutation-scope",
    async (request, reply) => {
      const targetId = Number(request.params.targetId);
      if (!getTarget(db, targetId)) return reply.code(404).send({ error: "NOT_FOUND" });
      const input = { targetId, ...request.body };
      if (!input.origin && !input.objectType && !input.resourceId && !input.tenantId) {
        return reply.code(400).send({ error: "At least one resource dimension is required" });
      }
      const id = addMutationScopeEntry(db, input);
      return reply.code(201).send(listMutationScopeEntryRecords(db, targetId).find((entry) => entry.id === id));
    },
  );

  app.delete<{ Params: { targetId: string; id: string } }>(
    "/api/targets/:targetId/mutation-scope/:id",
    async (request, reply) => {
      const deleted = deleteMutationScopeEntry(db, Number(request.params.targetId), Number(request.params.id));
      if (!deleted) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.code(204).send();
    },
  );

  done();
}
