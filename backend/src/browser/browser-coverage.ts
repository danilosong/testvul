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
  actionsDiscovered: number;
  actionsByClassification: Partial<Record<ActionClassification, number>>;
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

  return { actionsDiscovered, actionsByClassification, dryRunOperationsDiscovered: dryRunRow.count };
}
