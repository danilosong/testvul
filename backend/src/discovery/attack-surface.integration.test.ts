import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { openDb } from "../db/connection";
import { runMigrations } from "../db/migrator";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let app: FastifyInstance;
let dbDir: string;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  dbDir = mkdtempSync(join(tmpdir(), "sca-app-test-"));
  const db = openDb(join(dbDir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  app = buildApp(db);
});

afterAll(async () => {
  await app.close();
  await servers.stop();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("POST /api/discovery/attack-surface against the fixture app", () => {
  it("returns correct counts for a fixture crawl", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/discovery/attack-surface",
      payload: {
        targetUrl: `http://127.0.0.1:${ports.httpPort}/`,
        scope: ["127.0.0.1"],
        allowPrivateNetworks: true,
        maxDepth: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // The fixture's root page (from 1.4) has: a link to /projects, a link
    // to /api/openapi.json (also an API+JSON endpoint), a form posting to
    // /api/projects/1, and a script tag for /app.js.
    expect(body.counts.pages).toBeGreaterThanOrEqual(1);
    expect(body.counts.forms).toBe(1);
    expect(body.counts.apiEndpoints).toBeGreaterThanOrEqual(2); // /api/openapi.json + /api/projects/1
    expect(body.counts.jsonEndpoints).toBeGreaterThanOrEqual(1); // /api/openapi.json

    const rootNode = body.tree.find((n: { name: string }) => n.name === "127.0.0.1");
    expect(rootNode).toBeDefined();
  });

  it("rejects a request missing targetUrl/scope", async () => {
    const response = await app.inject({ method: "POST", url: "/api/discovery/attack-surface", payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("returns 422 rather than crashing when the target is out of scope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/discovery/attack-surface",
      payload: { targetUrl: "http://127.0.0.1:1/", scope: ["only-this.example"] },
    });
    expect(response.statusCode).toBe(422);
  });
});
