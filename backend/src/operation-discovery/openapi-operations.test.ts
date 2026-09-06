import { describe, expect, it } from "vitest";
import { operationsFromOpenApi } from "./openapi-operations";
import type { ImportedOpenApiSchema } from "../api-discovery/openapi-discovery";

describe("operationsFromOpenApi", () => {
  it("creates a HIGH-confidence OPENAPI operation for a documented PATCH with a JSON request schema, per the spec scenario", () => {
    const schema: ImportedOpenApiSchema = {
      paths: {
        "/api/settings": {
          patch: {
            requestBody: { content: { "application/json": { schema: { type: "object" } } } },
            responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
          },
        },
      },
      operations: [{ method: "PATCH", path: "/api/settings", parameters: [] }],
    };

    const [operation] = operationsFromOpenApi(schema);

    expect(operation).toEqual({
      method: "PATCH",
      url: "/api/settings",
      source: "OPENAPI",
      confidence: "HIGH",
      contentType: "application/json",
      requestSchema: { type: "object" },
      responseSchema: { type: "object" },
    });
  });

  it("creates an operation with no request schema for a GET with no request body", () => {
    const schema: ImportedOpenApiSchema = {
      paths: { "/api/settings": { get: { responses: { "200": {} } } } },
      operations: [{ method: "GET", path: "/api/settings", parameters: [] }],
    };
    const [operation] = operationsFromOpenApi(schema);
    expect(operation?.method).toBe("GET");
    expect(operation?.requestSchema).toBeUndefined();
  });

  it("produces one operation per method on a path with multiple methods", () => {
    const schema: ImportedOpenApiSchema = {
      paths: {
        "/api/projects/{id}": {
          get: { responses: { "200": {} } },
          patch: { requestBody: { content: { "application/json": { schema: {} } } }, responses: { "200": {} } },
        },
      },
      operations: [],
    };
    const operations = operationsFromOpenApi(schema);
    expect(operations.map((o) => o.method).sort()).toEqual(["GET", "PATCH"]);
  });
});
