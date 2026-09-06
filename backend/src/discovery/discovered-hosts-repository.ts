import type { Db } from "../db/connection";
import type { HostCandidate } from "./host-candidate-discovery";

export function saveHostCandidates(db: Db, scanRunId: number, candidates: readonly HostCandidate[]): void {
  const insert = db.prepare(
    "INSERT INTO discovered_hosts (scan_run_id, hostname, in_scope, discovery_source) VALUES (?, ?, ?, ?)",
  );
  for (const candidate of candidates) {
    insert.run(scanRunId, candidate.hostname, candidate.inScope ? 1 : 0, candidate.source);
  }
}

export interface DiscoveredHostRecord {
  id: number;
  hostname: string;
  inScope: boolean;
  discoverySource: HostCandidate["source"];
}

interface DiscoveredHostRow {
  id: number;
  hostname: string;
  in_scope: number;
  discovery_source: HostCandidate["source"];
}

/** Section 15.6's report needs the real list, not just the routing decision `routeHostCandidates` already made — every host this scan ever learned about, in or out of scope alike. */
export function listDiscoveredHosts(db: Db, scanRunId: number): DiscoveredHostRecord[] {
  const rows = db.prepare("SELECT id, hostname, in_scope, discovery_source FROM discovered_hosts WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as DiscoveredHostRow[];
  return rows.map((row) => ({ id: row.id, hostname: row.hostname, inScope: row.in_scope === 1, discoverySource: row.discovery_source }));
}
