import type { FastifyInstance } from "fastify";
import type { Db } from "../db/connection";
import {
  createAuthProfile,
  getAuthProfile,
  listAuthProfiles,
  updateAuthProfile,
  deleteAuthProfile,
  getDecryptedCredential,
} from "./auth-profiles-repository";
import { getAllowedHosts } from "./allowed-hosts-repository";
import type { AuthMethod, AuthProfile, AuthProfileInput } from "./auth-profile";
import { maskSecret } from "../evidence/mask-secrets";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";

export interface AuthProfilesRoutesOptions {
  db: Db;
}

interface TestProfileBody {
  targetUrl: string;
  scope: string[];
  allowPrivateNetworks?: boolean;
}

/** The public view of a profile — the credential itself is never returned,
 * masked or otherwise; only whether one exists and, if so, a masked
 * preview computed fresh from the decrypted value, never stored. */
function toMaskedView(db: Db, profile: AuthProfile): AuthProfile & { maskedCredential?: string } {
  const credential = profile.hasCredential ? getDecryptedCredential(db, profile.id) : undefined;
  return credential !== undefined ? { ...profile, maskedCredential: maskSecret(credential) } : { ...profile };
}

function buildAuthHeaders(method: AuthMethod, credential: string | undefined): Record<string, string> {
  if (!credential) return {};
  switch (method) {
    case "BEARER":
      return { Authorization: `Bearer ${credential}` };
    case "COOKIE":
      return { Cookie: credential };
    case "API_KEY":
      return { "X-API-Key": credential };
    case "CUSTOM_HEADERS":
      try {
        return JSON.parse(credential);
      } catch {
        return {};
      }
  }
}

export function authProfilesRoutes(app: FastifyInstance, options: AuthProfilesRoutesOptions, done: () => void): void {
  const { db } = options;

  app.post<{ Body: AuthProfileInput }>("/api/auth-profiles", async (request, reply) => {
    const { name, method } = request.body;
    if (!name || !method) return reply.code(400).send({ error: "name and method are required" });
    const id = createAuthProfile(db, request.body);
    return reply.code(201).send(toMaskedView(db, getAuthProfile(db, id)!));
  });

  app.get("/api/auth-profiles", async () => listAuthProfiles(db).map((profile) => toMaskedView(db, profile)));

  app.get<{ Params: { id: string } }>("/api/auth-profiles/:id", async (request, reply) => {
    const profile = getAuthProfile(db, Number(request.params.id));
    if (!profile) return reply.code(404).send({ error: "NOT_FOUND" });
    return toMaskedView(db, profile);
  });

  app.patch<{ Params: { id: string }; Body: Partial<AuthProfileInput> }>("/api/auth-profiles/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!getAuthProfile(db, id)) return reply.code(404).send({ error: "NOT_FOUND" });
    updateAuthProfile(db, id, request.body);
    return toMaskedView(db, getAuthProfile(db, id)!);
  });

  app.delete<{ Params: { id: string } }>("/api/auth-profiles/:id", async (request, reply) => {
    deleteAuthProfile(db, Number(request.params.id));
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: { hostname?: string } }>(
    "/api/auth-profiles/:id/allowed-hosts",
    async (request, reply) => {
      const { hostname } = request.body;
      if (!hostname) return reply.code(400).send({ error: "hostname is required" });
      db.prepare("INSERT INTO auth_profile_allowed_hosts (auth_profile_id, hostname) VALUES (?, ?)").run(
        Number(request.params.id),
        hostname.toLowerCase(),
      );
      return reply.code(201).send({ hostname: hostname.toLowerCase() });
    },
  );

  app.get<{ Params: { id: string } }>("/api/auth-profiles/:id/allowed-hosts", async (request) =>
    getAllowedHosts(db, Number(request.params.id)),
  );

  app.post<{ Params: { id: string }; Body: TestProfileBody }>("/api/auth-profiles/:id/test", async (request, reply) => {
    const profile = getAuthProfile(db, Number(request.params.id));
    if (!profile) return reply.code(404).send({ error: "NOT_FOUND" });

    const { targetUrl, scope, allowPrivateNetworks } = request.body;
    if (!targetUrl || !Array.isArray(scope)) return reply.code(400).send({ error: "targetUrl and scope are required" });

    const credential = getDecryptedCredential(db, profile.id);
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(scope),
      ...(allowPrivateNetworks !== undefined ? { allowPrivateNetworks } : {}),
    });

    try {
      const response = await client.request(targetUrl, { headers: buildAuthHeaders(profile.method, credential) });
      return { status: response.status };
    } catch (err) {
      return reply.code(422).send({ error: "TEST_FAILED", message: (err as Error).message });
    }
  });

  done();
}
