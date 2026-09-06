import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../../scope";
import { SecurityHttpClient } from "../../http/security-http-client";
import { runReadIdorTest } from "./read-idor-test";
import { withAuthHeaders } from "../authenticated-requester";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
});

afterAll(async () => {
  await servers.stop();
});

describe("Read IDOR test with positive content confirmation against the real fixture app", () => {
  it("produces a POTENTIAL_BOLA finding against the vulnerable endpoint, whose body genuinely matches the other user's project", async () => {
    const result = await runReadIdorTest({
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userB-token" }),
      resourceUrl: `http://127.0.0.1:${ports.httpPort}/api/projects/1`, // owned by userA
      resourceIdFieldPath: "id",
      expectedResourceId: "1",
      ownerFieldPath: "owner",
      expectedOwnerId: "userA",
    });

    expect(result.outcome).toBe("POTENTIAL_BOLA");
    expect(result.status).toBe(200);
  });

  it("produces no finding against the protected variant, which returns 403 for a non-owner", async () => {
    const result = await runReadIdorTest({
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userB-token" }),
      resourceUrl: `http://127.0.0.1:${ports.httpPort}/api/protected-projects/1`,
      resourceIdFieldPath: "id",
      expectedResourceId: "1",
      ownerFieldPath: "owner",
      expectedOwnerId: "userA",
    });

    expect(result.outcome).toBe("PROTECTED");
    expect(result.status).toBe(403);
  });

  it("produces no finding for a 200 response whose body doesn't actually match the targeted resource (false-positive avoidance)", async () => {
    // /api/my-projects returns 200 with the caller's OWN projects — a
    // real endpoint that could look superficially like a hit if the
    // scanner only checked the status code.
    const result = await runReadIdorTest({
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userB-token" }),
      resourceUrl: `http://127.0.0.1:${ports.httpPort}/api/my-projects`,
      resourceIdFieldPath: "id",
      expectedResourceId: "1",
      ownerFieldPath: "owner",
      expectedOwnerId: "userA",
    });

    expect(result.status).toBe(200);
    expect(result.outcome).toBe("NO_FINDING");
  });
});
