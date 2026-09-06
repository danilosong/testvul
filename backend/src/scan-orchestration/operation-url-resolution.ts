/**
 * Resolves an OpenAPI-documented template path (e.g. "/api/projects/{id}",
 * as `operationsFromOpenApi` — Section 7 — returns it, unresolved) against
 * a concrete resource id into a real, absolute URL a `DiscoveredOperation`
 * and a `Candidate.resourceUrl` can both match by exact string equality.
 * A narrow, honest heuristic: every `{...}`-shaped path parameter is
 * replaced with the same `resourceId` — correct for the common
 * single-parameter-per-path case; a template with more than one distinct
 * path parameter is out of scope here.
 */
export function resolveOperationUrl(origin: string, templatePath: string, resourceId: string): string {
  const resolvedPath = templatePath.replace(/\{[^}]+\}/g, resourceId);
  return new URL(resolvedPath, origin).toString();
}
