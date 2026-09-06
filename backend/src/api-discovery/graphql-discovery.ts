export interface GraphQlRequester {
  request(url: string): Promise<{ status: number; body: string }>;
}

export interface GraphQlIdentificationResult {
  isGraphQlEndpoint: boolean;
  evidence: string;
}

/**
 * Identifies a `/graphql` endpoint from the shape of its response to a
 * plain, query-less GET — most GraphQL servers answer with a distinctive
 * "must provide a query" error — and never sends an introspection query
 * (`{ __schema { ... } }`) to do it. This function has no code path that
 * could construct one: it only ever calls `client.request(url)` with no
 * body and no query parameters.
 */
export async function identifyGraphQlEndpoint(client: GraphQlRequester, url: string): Promise<GraphQlIdentificationResult> {
  const response = await client.request(url);

  let isGraphQlEndpoint = false;
  try {
    const parsed = JSON.parse(response.body) as { errors?: Array<{ message?: unknown }> };
    isGraphQlEndpoint = Array.isArray(parsed.errors) && parsed.errors.some((e) => typeof e.message === "string" && /query/i.test(e.message));
  } catch {
    isGraphQlEndpoint = false;
  }

  return { isGraphQlEndpoint, evidence: response.body };
}
