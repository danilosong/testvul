import type { Db } from "../db/connection";
import { classifyEndpoint } from "../analysis/endpoint-classifier";
import type { DiscoveredResource } from "./attack-surface";

export type DiscoveredEndpointSource = "STATIC" | "BROWSER" | "OPENAPI";

/**
 * Persists every resource a discovery pass found — the missing writer for
 * `discovered_endpoints` (this table existed since Section 1's migration
 * but had no insertion path until Section 15.3's Dashboard needed real
 * counts to read). Endpoint classification (Section 6.9) is computed once
 * here, at persistence time, rather than left for every later reader to
 * recompute.
 */
/** Records one resource and returns its new `discovered_endpoints.id` — `discovered_fields`/`recordEndpointAuthRequirement` (Section 15.4) key off this id, so a caller that needs either must use this rather than the bulk form below. */
export function recordDiscoveredEndpoint(db: Db, scanRunId: number, resource: DiscoveredResource, discoveredVia: DiscoveredEndpointSource): number {
  let path: string;
  try {
    path = new URL(resource.url).pathname;
  } catch {
    path = resource.url;
  }
  const { classification } = classifyEndpoint(path);
  const result = db
    .prepare(
      "INSERT INTO discovered_endpoints (scan_run_id, method, url, classification, content_type, discovered_via, is_page, is_form) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(scanRunId, resource.method, resource.url, classification, resource.contentType ?? null, discoveredVia, resource.isPage ? 1 : 0, resource.isForm ? 1 : 0);
  return Number(result.lastInsertRowid);
}

export function recordDiscoveredEndpoints(db: Db, scanRunId: number, resources: readonly DiscoveredResource[], discoveredVia: DiscoveredEndpointSource): void {
  for (const resource of resources) recordDiscoveredEndpoint(db, scanRunId, resource, discoveredVia);
}

/** An endpoint is only ever marked as requiring auth from a real observation (e.g. an unauthenticated request returning 401/403 vs. an authenticated one succeeding) — never guessed from its classification or path. */
export function recordEndpointAuthRequirement(db: Db, endpointId: number, required: boolean): void {
  db.prepare("UPDATE discovered_endpoints SET auth_required = ? WHERE id = ?").run(required ? 1 : 0, endpointId);
}

interface DiscoveredEndpointRow {
  method: string;
  url: string;
  classification: string;
  content_type: string | null;
  discovered_via: DiscoveredEndpointSource;
  is_page: number;
  is_form: number;
}

/** Reassembles the same `DiscoveredResource` shape `buildAttackSurface` (Section 5.9) consumes — the Dashboard (Section 15.3) reuses that same pure summarizer instead of recomputing counts a second way. */
export function listDiscoveredResources(db: Db, scanRunId: number): DiscoveredResource[] {
  const rows = db
    .prepare("SELECT method, url, classification, content_type, discovered_via, is_page, is_form FROM discovered_endpoints WHERE scan_run_id = ?")
    .all(scanRunId) as unknown as DiscoveredEndpointRow[];
  return rows.map((row) => {
    const resource: DiscoveredResource = { url: row.url, method: row.method };
    if (row.content_type !== null) resource.contentType = row.content_type;
    if (row.is_page === 1) resource.isPage = true;
    if (row.is_form === 1) resource.isForm = true;
    return resource;
  });
}

export function listDiscoveredEndpointsBySource(db: Db, scanRunId: number): { source: DiscoveredEndpointSource; count: number }[] {
  const rows = db
    .prepare("SELECT discovered_via as source, COUNT(*) as count FROM discovered_endpoints WHERE scan_run_id = ? GROUP BY discovered_via")
    .all(scanRunId) as unknown as { source: DiscoveredEndpointSource; count: number }[];
  return rows;
}

export interface DiscoveredEndpointSummary {
  id: number;
  method: string;
  url: string;
  classification: string;
  contentType?: string;
  discoveredVia: DiscoveredEndpointSource;
  /** `undefined` — never `false` — until an actual authenticated-vs-unauthenticated observation has been recorded. */
  authRequired?: boolean;
}

interface DiscoveredEndpointSummaryRow {
  id: number;
  method: string;
  url: string;
  classification: string;
  content_type: string | null;
  discovered_via: DiscoveredEndpointSource;
  auth_required: number | null;
}

export function getDiscoveredEndpointById(db: Db, endpointId: number): DiscoveredEndpointSummary | null {
  const row = db
    .prepare("SELECT id, method, url, classification, content_type, discovered_via, auth_required FROM discovered_endpoints WHERE id = ?")
    .get(endpointId) as unknown as DiscoveredEndpointSummaryRow | undefined;
  if (!row) return null;
  const summary: DiscoveredEndpointSummary = { id: row.id, method: row.method, url: row.url, classification: row.classification, discoveredVia: row.discovered_via };
  if (row.content_type !== null) summary.contentType = row.content_type;
  if (row.auth_required !== null) summary.authRequired = row.auth_required === 1;
  return summary;
}

export function listDiscoveredEndpointSummaries(db: Db, scanRunId: number): DiscoveredEndpointSummary[] {
  const rows = db
    .prepare("SELECT id, method, url, classification, content_type, discovered_via, auth_required FROM discovered_endpoints WHERE scan_run_id = ? ORDER BY id")
    .all(scanRunId) as unknown as DiscoveredEndpointSummaryRow[];
  return rows.map((row) => {
    const summary: DiscoveredEndpointSummary = { id: row.id, method: row.method, url: row.url, classification: row.classification, discoveredVia: row.discovered_via };
    if (row.content_type !== null) summary.contentType = row.content_type;
    if (row.auth_required !== null) summary.authRequired = row.auth_required === 1;
    return summary;
  });
}
