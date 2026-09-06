import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db/connection";
import { ScopeValidator } from "./scope";
import { SecurityHttpClient } from "./http/security-http-client";
import { runStaticDiscovery } from "./discovery/run-static-discovery";
import { buildAttackSurface } from "./discovery/attack-surface";
import { authProfilesRoutes } from "./auth/auth-profiles-routes";
import { resourceOwnershipRoutes } from "./ownership/resource-ownership-routes";
import { authorizationExpectationsRoutes } from "./auth/authorization-expectations-routes";
import { businessLogicRulesRoutes } from "./business-logic/business-logic-rules-routes";

interface AttackSurfaceRequestBody {
  targetUrl: string;
  scope: string[];
  allowPrivateNetworks?: boolean;
  maxDepth?: number;
  maxPages?: number;
}

/**
 * Builds the Fastify app without starting a listener — `index.ts` is the
 * only place that calls `.listen()`; tests use `.inject()` instead.
 */
export function buildApp(db: Db): FastifyInstance {
  const app = Fastify();

  app.register(authProfilesRoutes, { db });
  app.register(resourceOwnershipRoutes, { db });
  app.register(authorizationExpectationsRoutes, { db });
  app.register(businessLogicRulesRoutes, { db });

  app.post<{ Body: AttackSurfaceRequestBody }>("/api/discovery/attack-surface", async (request, reply) => {
    const { targetUrl, scope, allowPrivateNetworks, maxDepth, maxPages } = request.body;
    if (!targetUrl || !Array.isArray(scope)) {
      return reply.code(400).send({ error: "targetUrl and scope are required" });
    }

    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(scope),
      ...(allowPrivateNetworks !== undefined ? { allowPrivateNetworks } : {}),
    });

    try {
      const resources = await runStaticDiscovery(client, targetUrl, {
        ...(maxDepth !== undefined ? { maxDepth } : {}),
        ...(maxPages !== undefined ? { maxPages } : {}),
      });
      return buildAttackSurface(resources);
    } catch (err) {
      return reply.code(422).send({ error: "DISCOVERY_FAILED", message: (err as Error).message });
    }
  });

  return app;
}
