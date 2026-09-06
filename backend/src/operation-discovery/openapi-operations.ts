import type { ImportedOpenApiSchema } from "../api-discovery/openapi-discovery";
import type { DiscoveredOperation } from "./discovered-operation";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

interface OpenApiRequestBody {
  content?: Record<string, { schema?: unknown }>;
}

interface OpenApiResponses {
  [status: string]: { content?: Record<string, { schema?: unknown }> } | undefined;
}

interface OpenApiOperationDef {
  requestBody?: OpenApiRequestBody;
  responses?: OpenApiResponses;
}

function firstContentEntry(content: Record<string, { schema?: unknown }> | undefined): [string, unknown] | null {
  if (!content) return null;
  const [contentType, body] = Object.entries(content)[0] ?? [];
  return contentType ? [contentType, body?.schema] : null;
}

function successResponseSchema(responses: OpenApiResponses | undefined): unknown {
  if (!responses) return undefined;
  const success = responses["200"] ?? responses["201"] ?? Object.values(responses)[0];
  return firstContentEntry(success?.content)?.[1];
}

/**
 * Every operation an imported OpenAPI document documents is HIGH
 * confidence by construction — the operator's own API documentation is as
 * trustworthy a source as this system has.
 */
export function operationsFromOpenApi(schema: ImportedOpenApiSchema): DiscoveredOperation[] {
  const results: DiscoveredOperation[] = [];

  for (const [path, methodsObj] of Object.entries(schema.paths)) {
    if (typeof methodsObj !== "object" || methodsObj === null) continue;
    for (const [method, operationDef] of Object.entries(methodsObj as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const def = operationDef as OpenApiOperationDef;

      const requestEntry = firstContentEntry(def.requestBody?.content);
      const operation: DiscoveredOperation = {
        method: method.toUpperCase(),
        url: path,
        source: "OPENAPI",
        confidence: "HIGH",
      };
      if (requestEntry) {
        operation.contentType = requestEntry[0];
        operation.requestSchema = requestEntry[1];
      }
      const responseSchema = successResponseSchema(def.responses);
      if (responseSchema !== undefined) operation.responseSchema = responseSchema;

      results.push(operation);
    }
  }

  return results;
}
