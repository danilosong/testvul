import { describe, expect, it } from "vitest";
import { discoverOpenApi, KNOWN_OPENAPI_PATHS, type OpenApiRequester } from "./openapi-discovery";

const VALID_DOC = {
  openapi: "3.0.3",
  paths: {
    "/api/projects/{id}": {
      get: { summary: "Get", parameters: [{ name: "id", in: "path" }] },
      patch: { summary: "Update", parameters: [{ name: "id", in: "path" }] },
    },
  },
};

function fakeClient(responses: Record<string, { status: number; body: string }>): OpenApiRequester {
  return {
    request: async (url) => {
      const path = new URL(url).pathname;
      return responses[path] ?? { status: 404, body: "" };
    },
  };
}

describe("discoverOpenApi", () => {
  it("imports endpoints, methods, and parameters from a valid document", async () => {
    const client = fakeClient({ "/openapi.json": { status: 200, body: JSON.stringify(VALID_DOC) } });
    const result = await discoverOpenApi(client, "http://example.com/");
    expect(result).not.toBeNull();
    expect(result!.operations).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/api/projects/{id}", parameters: [{ name: "id", in: "path" }] },
        { method: "PATCH", path: "/api/projects/{id}", parameters: [{ name: "id", in: "path" }] },
      ]),
    );
  });

  it("only checks the fixed known-path list, never anything else", async () => {
    const requestedPaths: string[] = [];
    const client: OpenApiRequester = {
      request: async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return { status: 404, body: "" };
      },
    };
    await discoverOpenApi(client, "http://example.com/");
    expect(requestedPaths).toEqual(KNOWN_OPENAPI_PATHS);
  });

  it("returns null when no known path yields a document", async () => {
    const client = fakeClient({});
    expect(await discoverOpenApi(client, "http://example.com/")).toBeNull();
  });

  it("does not treat a 200 response with unrelated JSON as an OpenAPI document", async () => {
    const client = fakeClient({ "/openapi.json": { status: 200, body: JSON.stringify({ hello: "world" }) } });
    expect(await discoverOpenApi(client, "http://example.com/")).toBeNull();
  });

  it("does not throw on a 200 response with invalid JSON", async () => {
    const client = fakeClient({ "/openapi.json": { status: 200, body: "not json" } });
    await expect(discoverOpenApi(client, "http://example.com/")).resolves.toBeNull();
  });

  it("recognizes a swagger 2.0 document via the swagger field", async () => {
    const client = fakeClient({
      "/swagger.json": { status: 404, body: "" },
      "/openapi.json": { status: 404, body: "" },
      "/api-docs": { status: 200, body: JSON.stringify({ swagger: "2.0", paths: {} }) },
    });
    const result = await discoverOpenApi(client, "http://example.com/");
    expect(result).toEqual({ paths: {}, operations: [] });
  });
});
