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
