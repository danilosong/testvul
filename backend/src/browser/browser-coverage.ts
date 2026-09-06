import type { Db } from "../db/connection";
import type { ActionClassification } from "./action-discovery";

/**
 * Section 12 browser-runtime coverage (Section 15.3's Dashboard input):
 * how many browser-discovered actions were found, broken down by safety
 * classification (Section 12.14), plus how many Dry-Run Capture (Section
 * 12.19) operations were actually discovered and registered as real
 * `DiscoveredOperation`s (`BROWSER_DRY_RUN`-sourced rows) — never
 * recomputed from scratch, always read from what discovery already
 * persisted.
 */
export interface BrowserCoverageSummary {
  pagesVisited: number;
  routesDiscovered: number;
  actionsDiscovered: number;
  actionsByClassification: Partial<Record<ActionClassification, number>>;
  operationsDiscovered: number;
  safeActionsTested: number;
  sensitiveActionsBlocked: number;
  inconclusiveRuntimeTests: number;
  dryRunOperationsDiscovered: number;
}

export function computeBrowserCoverage(db: Db, scanRunId: number): BrowserCoverageSummary {
  const actionRows = db
    .prepare("SELECT classification, COUNT(*) as count FROM browser_actions WHERE scan_run_id = ? GROUP BY classification")
    .all(scanRunId) as unknown as { classification: ActionClassification; count: number }[];

  const actionsByClassification: Partial<Record<ActionClassification, number>> = {};
  let actionsDiscovered = 0;
  for (const row of actionRows) {
    actionsByClassification[row.classification] = row.count;
    actionsDiscovered += row.count;
  }

  const dryRunRow = db
    .prepare("SELECT COUNT(*) as count FROM discovered_operations WHERE scan_run_id = ? AND source = 'BROWSER_DRY_RUN'")
    .get(scanRunId) as { count: number };

  const endpointRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN is_page = 1 THEN url END) as pages_visited,
         COUNT(DISTINCT url) as routes_discovered
       FROM discovered_endpoints
       WHERE scan_run_id = ? AND discovered_via = 'BROWSER'`,
    )
    .get(scanRunId) as { pages_visited: number; routes_discovered: number };
  const operationRow = db
    .prepare("SELECT COUNT(*) as count FROM discovered_operations WHERE scan_run_id = ? AND source IN ('BROWSER_RUNTIME', 'BROWSER_DRY_RUN')")
    .get(scanRunId) as { count: number };
  const safeTestedRow = db
    .prepare(
      "SELECT COUNT(*) as count FROM browser_actions WHERE scan_run_id = ? AND classification IN ('SAFE_READ', 'SAFE_MUTATION') AND status = 'EXECUTED'",
    )
    .get(scanRunId) as { count: number };
  const sensitiveBlockedRow = db
    .prepare(
      "SELECT COUNT(*) as count FROM browser_actions WHERE scan_run_id = ? AND classification IN ('SENSITIVE_MUTATION', 'DESTRUCTIVE') AND status IN ('BLOCKED', 'SKIPPED')",
    )
    .get(scanRunId) as { count: number };
  const inconclusiveRow = db
    .prepare(
      "SELECT COUNT(*) as count FROM candidates WHERE scan_run_id = ? AND browser_testability IN ('BROWSER_INCONCLUSIVE', 'DRY_RUN_UNAVAILABLE')",
    )
    .get(scanRunId) as { count: number };

  return {
    pagesVisited: endpointRow.pages_visited,
    routesDiscovered: endpointRow.routes_discovered,
    actionsDiscovered,
    actionsByClassification,
    operationsDiscovered: operationRow.count,
    safeActionsTested: safeTestedRow.count,
    sensitiveActionsBlocked: sensitiveBlockedRow.count,
    inconclusiveRuntimeTests: inconclusiveRow.count,
    dryRunOperationsDiscovered: dryRunRow.count,
  };
}
