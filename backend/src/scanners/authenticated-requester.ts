import type { SecurityHttpClient, SecurityHttpRequestInit } from "../http/security-http-client";
import type { RestoreRequester } from "../restore/restore-engine";

/**
 * Wraps a `SecurityHttpClient` so every request made through it carries the
 * given headers (typically an Authentication Profile's resolved
 * `Authorization`/cookie header) without the caller needing to remember to
 * attach them on each individual call — used to give the shared mutation
 * cycle (`runMutationTestCycle`) a `RestoreRequester` that authenticates as
 * a specific identity.
 */
export function withAuthHeaders(httpClient: SecurityHttpClient, headers: Record<string, string> | undefined): RestoreRequester {
  if (!headers || Object.keys(headers).length === 0) return httpClient;
  return {
    request: (url: string, init?: SecurityHttpRequestInit) =>
      httpClient.request(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }),
  };
}
