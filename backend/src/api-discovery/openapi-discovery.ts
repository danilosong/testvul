export interface OpenApiRequester {
  request(url: string): Promise<{ status: number; body: string }>;
}

export interface ImportedOpenApiOperation {
  method: string;
  path: string;
  parameters: unknown[];
}

export interface ImportedOpenApiSchema {
  paths: Record<string, unknown>;
  operations: ImportedOpenApiOperation[];
}

/** Non-destructive, fixed set of conventional locations to check — never a
 * brute-force path scan. */
export const KNOWN_OPENAPI_PATHS = ["/openapi.json", "/swagger.json", "/api-docs", "/docs", "/swagger"];

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function looksLikeOpenApiDocument(doc: unknown): doc is { paths?: Record<string, unknown> } {
  return typeof doc === "object" && doc !== null && ("openapi" in doc || "swagger" in doc);
}

function importOpenApiDocument(doc: { paths?: Record<string, unknown> }): ImportedOpenApiSchema {
  const paths = doc.paths ?? {};
  const operations: ImportedOpenApiOperation[] = [];

  for (const [path, methodsObj] of Object.entries(paths)) {
    if (typeof methodsObj !== "object" || methodsObj === null) continue;
    for (const [method, operationDef] of Object.entries(methodsObj as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const parameters =
        typeof operationDef === "object" && operationDef !== null && Array.isArray((operationDef as { parameters?: unknown }).parameters)
          ? ((operationDef as { parameters: unknown[] }).parameters)
          : [];
      operations.push({ method: method.toUpperCase(), path, parameters });
    }
  }

  return { paths, operations };
}

/**
 * Checks the fixed list of conventional, non-destructive OpenAPI/Swagger
 * paths and imports the first valid document found — never a path guessed
 * or brute-forced beyond this list.
 */
export async function discoverOpenApi(client: OpenApiRequester, baseUrl: string): Promise<ImportedOpenApiSchema | null> {
  for (const path of KNOWN_OPENAPI_PATHS) {
    let response;
    try {
      response = await client.request(new URL(path, baseUrl).toString());
    } catch {
      continue;
    }
    if (response.status !== 200) continue;

    let doc: unknown;
    try {
      doc = JSON.parse(response.body);
    } catch {
      continue;
    }
    if (looksLikeOpenApiDocument(doc)) return importOpenApiDocument(doc);
  }
  return null;
}
