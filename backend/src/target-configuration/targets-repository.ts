import type { Db } from "../db/connection";
import type { ScanMode } from "../scan-orchestration/scan-mode-gate";
import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";

export interface TargetInput {
  name: string;
  hostname: string;
  scope: string[];
  defaultScanMode?: ScanMode;
  rateLimitRps?: number;
  allowPrivateNetworks?: boolean;
  /** Section 16.10 — defaults to DEVELOPMENT (design.md Decision 53); never inferred from hostname/IP. */
  environment?: TargetEnvironmentClassification;
}

export interface Target {
  id: number;
  name: string;
  hostname: string;
  scope: string[];
  defaultScanMode: ScanMode;
  rateLimitRps: number;
  allowPrivateNetworks: boolean;
  environment: TargetEnvironmentClassification;
}

/** Creates a Target row — the "New Security Audit" screen's own persistence (Section 16.1). Every default here (Passive scan mode, 2 req/s, DEVELOPMENT environment) matches the table's own schema defaults; nothing is silently inferred beyond what the schema already declares. */
export function createTarget(db: Db, input: TargetInput): number {
  const result = db
    .prepare(
      `INSERT INTO targets (name, hostname, scope_json, default_scan_mode, rate_limit_rps, allow_private_networks, environment)
       VALUES (?, ?, ?, COALESCE(?, 'PASSIVE'), COALESCE(?, 2), ?, COALESCE(?, 'DEVELOPMENT'))`,
    )
    .run(
      input.name,
      input.hostname,
      JSON.stringify(input.scope),
      input.defaultScanMode ?? null,
      input.rateLimitRps ?? null,
      input.allowPrivateNetworks ? 1 : 0,
      input.environment ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface TargetRow {
  id: number;
  name: string;
  hostname: string;
  scope_json: string;
  default_scan_mode: ScanMode;
  rate_limit_rps: number;
  allow_private_networks: number;
  environment: TargetEnvironmentClassification;
}

function rowToTarget(row: TargetRow): Target {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    scope: JSON.parse(row.scope_json) as string[],
    defaultScanMode: row.default_scan_mode,
    rateLimitRps: row.rate_limit_rps,
    allowPrivateNetworks: row.allow_private_networks === 1,
    environment: row.environment,
  };
}

export function getTarget(db: Db, id: number): Target | null {
  const row = db.prepare("SELECT * FROM targets WHERE id = ?").get(id) as unknown as TargetRow | undefined;
  return row ? rowToTarget(row) : null;
}

export function listTargets(db: Db): Target[] {
  const rows = db.prepare("SELECT * FROM targets ORDER BY id").all() as unknown as TargetRow[];
  return rows.map(rowToTarget);
}

export function updateTargetEnvironment(db: Db, id: number, environment: TargetEnvironmentClassification): boolean {
  return db.prepare("UPDATE targets SET environment = ?, updated_at = datetime('now') WHERE id = ?").run(environment, id).changes > 0;
}
