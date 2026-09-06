import type { Db } from "../db/connection";
import type { EligibilityState } from "./eligibility-classifier";

const INCONCLUSIVE_STATES = new Set<EligibilityState>(["INCONCLUSIVE", "INCONCLUSIVE_BUSINESS_EXPECTATION", "INCONCLUSIVE_TRUST_BOUNDARY"]);

export interface CoverageBreakdown {
  scanner: string;
  discovered: number;
  tested: number;
  passiveOnly: number;
  skippedByReason: Partial<Record<EligibilityState, number>>;
  inconclusive: number;
}

interface CountRow {
  scanner: string;
  eligibility_state: EligibilityState;
  count: number;
}

/**
 * Aggregates, per scanner, how many candidates a scan run discovered vs.
 * actually tested vs. passive-only vs. skipped (broken down by the exact
 * skip reason) vs. inconclusive — exposed to `findings-reporting` so the
 * dashboard/report can show real coverage rather than only findings.
 */
export function computeCoverage(db: Db, scanRunId: number): CoverageBreakdown[] {
  const rows = db
    .prepare(
      "SELECT scanner, eligibility_state, COUNT(*) as count FROM candidates WHERE scan_run_id = ? GROUP BY scanner, eligibility_state",
    )
    .all(scanRunId) as unknown as CountRow[];

  const byScanner = new Map<string, CoverageBreakdown>();

  for (const row of rows) {
    let breakdown = byScanner.get(row.scanner);
    if (!breakdown) {
      breakdown = { scanner: row.scanner, discovered: 0, tested: 0, passiveOnly: 0, skippedByReason: {}, inconclusive: 0 };
      byScanner.set(row.scanner, breakdown);
    }

    breakdown.discovered += row.count;

    if (row.eligibility_state === "TESTABLE") {
      breakdown.tested += row.count;
    } else if (row.eligibility_state === "PASSIVE_ONLY") {
      breakdown.passiveOnly += row.count;
    } else if (INCONCLUSIVE_STATES.has(row.eligibility_state)) {
      breakdown.inconclusive += row.count;
    } else {
      breakdown.skippedByReason[row.eligibility_state] = (breakdown.skippedByReason[row.eligibility_state] ?? 0) + row.count;
    }
  }

  return [...byScanner.values()].sort((a, b) => a.scanner.localeCompare(b.scanner));
}
