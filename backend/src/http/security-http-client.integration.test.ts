import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { PrivateIpBlockedError, SecurityHttpClient, WriteTestsPausedError } from "./security-http-client";
import { HostRateLimiter } from "./rate-limiter";
import { openDb } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { getAllowedHosts } from "../auth/allowed-hosts-repository";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
});

afterAll(async () => {
  await servers.stop();
});

describe("SecurityHttpClient against the fixture app", () => {
  it("issues a real request end to end once allowPrivateNetworks is enabled for the audit", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/`);
    expect(response.status).toBe(200);
    expect(response.body).toMatch(/<html/i);
  });

  it("blocks the same request by default (allowPrivateNetworks off)", async () => {
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]) });
    await expect(client.request(`http://127.0.0.1:${ports.httpPort}/`)).rejects.toThrow(PrivateIpBlockedError);
  });

  it("paces real requests to the configured rate against the fixture app", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
      rateLimiter: new HostRateLimiter({ requestsPerSecond: 5, concurrency: 5 }), // ~200ms apart
    });
    const url = `http://127.0.0.1:${ports.httpPort}/paginate`;
    const start = Date.now();
    await client.request(url);
    await client.request(url);
    await client.request(url);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(380); // two full ~200ms gaps
  });

  it("caps concurrent in-flight requests to the fixture app per host", async () => {
    const inner = new HostRateLimiter({ requestsPerSecond: 1000, concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    const instrumented = {
      run: <T,>(host: string, task: () => Promise<T>) =>
        inner.run(host, async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          try {
            return await task();
          } finally {
            active--;
          }
        }),
    };
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
      rateLimiter: instrumented,
    });
    const url = `http://127.0.0.1:${ports.httpPort}/paginate`;
    await Promise.all([client.request(url), client.request(url), client.request(url), client.request(url)]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("aborts a download that exceeds its response-size limit and records the event", async () => {
    const events: Array<{ type: string }> = [];
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
      onEvent: (event) => events.push(event),
    });
    // 6MB body, text/plain content type — above the 5MB default limit.
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/oversized`);
    expect(response.truncated).toBe(true);
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(events).toEqual([
      expect.objectContaining({ type: "RESPONSE_SIZE_LIMIT_EXCEEDED", limitBytes: 5 * 1024 * 1024 }),
    ]);
  });

  it("does not truncate a response within its size limit", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/oversized?bytes=1000`);
    expect(response.truncated).toBe(false);
    expect(Buffer.byteLength(response.body)).toBe(1000);
  });

  it("pauses write-based requests after sustained 5xx/429 responses from the fixture app, while reads keep working", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    await client.request(`http://127.0.0.1:${ports.httpPort}/errors/500`);
    await client.request(`http://127.0.0.1:${ports.httpPort}/errors/502`);
    await client.request(`http://127.0.0.1:${ports.httpPort}/errors/503`);

    await expect(
      client.request(`http://127.0.0.1:${ports.httpPort}/api/projects/1`, { method: "PATCH", headers: { "Content-Type": "application/json" } }),
    ).rejects.toThrow(WriteTestsPausedError);

    const readResponse = await client.request(`http://127.0.0.1:${ports.httpPort}/`);
    expect(readResponse.status).toBe(200);
  });

  it("pauses write-based requests after repeated 429s, and resumes once the host recovers", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    await client.request(`http://127.0.0.1:${ports.httpPort}/errors/429`);
    await client.request(`http://127.0.0.1:${ports.httpPort}/errors/429`);
    await client.request(`http://127.0.0.1:${ports.httpPort}/errors/429`);

    await expect(
      client.request(`http://127.0.0.1:${ports.httpPort}/api/projects/1`, { method: "PATCH", headers: { "Content-Type": "application/json" } }),
    ).rejects.toThrow(WriteTestsPausedError);

    // Enough healthy reads push the bad outcomes out of the sliding window.
    await client.request(`http://127.0.0.1:${ports.httpPort}/`);
    await client.request(`http://127.0.0.1:${ports.httpPort}/`);
    await client.request(`http://127.0.0.1:${ports.httpPort}/`);

    const patchRes = await client.request(`http://127.0.0.1:${ports.httpPort}/api/projects/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer userA-token" },
    });
    expect(patchRes.status).toBe(200);
  });

  it("connects to the exact pinned address rather than letting undici re-resolve the hostname itself", async () => {
    // "pinned-test.invalid" has no real DNS record at all. If the
    // connection relied on undici's own default resolution instead of the
    // pinned address from validateHop, this would fail with an DNS/ENOTFOUND
    // error instead of reaching the fixture app.
    const dnsLookup = async () => ({ address: "127.0.0.1", family: 4 });
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["pinned-test.invalid"]),
      allowPrivateNetworks: true,
      dnsLookup,
    });
    const response = await client.request(`http://pinned-test.invalid:${ports.httpPort}/`);
    expect(response.status).toBe(200);
  });

  it("strips Authorization on a cross-origin redirect by default", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/redirect/cross-origin-auth`, {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(JSON.parse(response.body).headers.authorization).toBeUndefined();
  });

  it("retains Authorization across a same-origin redirect", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/redirect/same-origin-auth`, {
      headers: { Authorization: "Bearer userA-token" },
    });
    expect(response.status).toBe(200); // would be 401 UNAUTHENTICATED if the header had been stripped
  });

  it("retains Authorization on a cross-origin redirect to a host pre-seeded in the profile's sharing list", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/redirect/cross-origin-auth`, {
      headers: { Authorization: "Bearer secret-token" },
      credentialSharingAllowedHosts: ["127.0.0.1"],
    });
    expect(JSON.parse(response.body).headers.authorization).toBe("Bearer secret-token");
  });

  it("reads a real Authentication Profile's sharing list from the database and honors it end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sca-cred-sharing-"));
    try {
      const db = openDb(join(dir, "test.db"));
      runMigrations(db, MIGRATIONS_DIR);
      db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Profile A', 'BEARER')").run();
      db.prepare("INSERT INTO auth_profile_allowed_hosts (auth_profile_id, hostname) VALUES (1, '127.0.0.1')").run();
      const allowedHosts = getAllowedHosts(db, 1);
      db.close();

      const client = new SecurityHttpClient({
        scopeValidator: new ScopeValidator(["127.0.0.1"]),
        allowPrivateNetworks: true,
      });
      const response = await client.request(`http://127.0.0.1:${ports.httpPort}/redirect/cross-origin-auth`, {
        headers: { Authorization: "Bearer secret-token" },
        credentialSharingAllowedHosts: allowedHosts,
      });
      expect(JSON.parse(response.body).headers.authorization).toBe("Bearer secret-token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends a request body on a PATCH — required for the mutation/restore pipeline to function at all", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/api/projects/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer userA-token" },
      body: JSON.stringify({ notes: "written via SecurityHttpClient body support" }),
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).notes).toBe("written via SecurityHttpClient body support");
  });
});
