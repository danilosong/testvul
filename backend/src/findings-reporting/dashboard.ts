import type { Db } from "../db/connection";
import { buildAttackSurface, type AttackSurfaceCounts } from "../discovery/attack-surface";
import { listDiscoveredResources } from "../discovery/discovered-endpoints-repository";
import { getDiscoveredOperations } from "../operation-discovery/discovered-operations-repository";
import { listBusinessObjects } from "../business-logic/business-object-discovery";
import { listBusinessStates } from "../business-logic/state-model";
import { computeCoverage, type CoverageBreakdown } from "../eligibility/coverage-engine";
import { computeBrowserCoverage, type BrowserCoverageSummary } from "../browser/browser-coverage";
import { computeBusinessLogicCoverage, type BusinessLogicCoverageReport, type ProfileContributedCandidate } from "../business-logic/business-logic-coverage";
import { getScanRunEnvironment, type TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import { getMutationScopeSnapshot, getBusinessExpectationsSnapshot } from "../scan-orchestration/scan-run-config-snapshot";
import { listWebhookOperations } from "../business-logic/webhook-operations-repository";
import type { WebhookOperation } from "../business-logic/webhook-operation";
import type { BusinessExpectation } from "../business-logic/business-expectation";
import type { MutationScopeEntryInput } from "../mutation/mutation-scope";
import type { FindingSeverity } from "./finding";
import { listFindings } from "./finding-repository";

export interface ScanRunSummary {
  id: number;
  targetId: number;
  state: string;
  hadRestoreIncident: boolean;
  hadPartialTruncation: boolean;
  truncationLimitReached: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DiscoveryCounts extends AttackSurfaceCounts {
  operations: number;
  businessObjects: number;
  businessStates: number;
}

/** A candidate that never even reached the Security Test Queue (Section 15.2) — shown distinctly from ordinary tested/blocked/vulnerable results, never folded into them. */
export interface SafetySkippedBreakdown {
  eligibilityState: string;
  count: number;
}

export interface DashboardData {
  target: { id: number; name: string; hostname: string };
  scanRun: ScanRunSummary;
  discoveryCounts: DiscoveryCounts;
  findingsBySeverity: Partial<Record<FindingSeverity, number>>;
  technicalCoverage: CoverageBreakdown[];
  browserCoverage: BrowserCoverageSummary;
  businessLogicCoverage: BusinessLogicCoverageReport;
  environmentClassification: TargetEnvironmentClassification;
  mutationScopeInEffect: MutationScopeEntryInput[];
  configuredBusinessExpectations: BusinessExpectation[];
  externalTrustBoundaries: WebhookOperation[];
  safetySkipped: SafetySkippedBreakdown[];
}

interface ScanRunRow {
  id: number;
  target_id: number;
  state: string;
  had_restore_incident: number;
  had_partial_truncation: number;
  truncation_limit_reached: string | null;
  started_at: string;
  finished_at: string | null;
}

interface TargetRow {
  id: number;
  name: string;
  hostname: string;
}

function getScanRunRow(db: Db, scanRunId: number): ScanRunRow {
  const row = db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(scanRunId) as unknown as ScanRunRow | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return row;
}

/**
 * Every safety-skip/inconclusive reason Section 10.1/10.2/10.5 can
 * produce, pulled out of the technical coverage breakdown's own
 * per-reason counts (Section 10.4) so the Dashboard can show them as
 * their own distinct section rather than mixed into ordinary results.
 */
function summarizeSafetySkipped(technicalCoverage: readonly CoverageBreakdown[]): SafetySkippedBreakdown[] {
  const totals = new Map<string, number>();
  for (const breakdown of technicalCoverage) {
    for (const [eligibilityState, count] of Object.entries(breakdown.skippedByReason)) {
      totals.set(eligibilityState, (totals.get(eligibilityState) ?? 0) + (count ?? 0));
    }
    if (breakdown.inconclusive > 0) totals.set("INCONCLUSIVE", (totals.get("INCONCLUSIVE") ?? 0) + breakdown.inconclusive);
  }
  return [...totals.entries()].map(([eligibilityState, count]) => ({ eligibilityState, count })).sort((a, b) => a.eligibilityState.localeCompare(b.eligibilityState));
}

function findingsBySeverity(db: Db, scanRunId: number): Partial<Record<FindingSeverity, number>> {
  const findings = listFindings(db, scanRunId);
  const bySeverity: Partial<Record<FindingSeverity, number>> = {};
  for (const finding of findings) bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  return bySeverity;
}

export function getDashboardData(db: Db, scanRunId: number, profileContributedCandidates: readonly ProfileContributedCandidate[] = []): DashboardData {
  const scanRunRow = getScanRunRow(db, scanRunId);
  const targetRow = db.prepare("SELECT id, name, hostname FROM targets WHERE id = ?").get(scanRunRow.target_id) as unknown as TargetRow;

  const resources = listDiscoveredResources(db, scanRunId);
  const operations = getDiscoveredOperations(db, scanRunId);
  const businessObjects = listBusinessObjects(db, scanRunId);
  const businessStates = listBusinessStates(db, scanRunId);
  const attackSurface = buildAttackSurface(resources);

  const technicalCoverage = computeCoverage(db, scanRunId);
  const profileObjectTypes = new Map<string, string[]>();
  for (const candidate of profileContributedCandidates) {
    const list = profileObjectTypes.get(candidate.source) ?? [];
    if (!list.includes(candidate.objectType)) list.push(candidate.objectType);
    profileObjectTypes.set(candidate.source, list);
  }

  return {
    target: { id: targetRow.id, name: targetRow.name, hostname: targetRow.hostname },
    scanRun: {
      id: scanRunRow.id,
      targetId: scanRunRow.target_id,
      state: scanRunRow.state,
      hadRestoreIncident: scanRunRow.had_restore_incident === 1,
      hadPartialTruncation: scanRunRow.had_partial_truncation === 1,
      truncationLimitReached: scanRunRow.truncation_limit_reached,
      startedAt: scanRunRow.started_at,
      finishedAt: scanRunRow.finished_at,
    },
    discoveryCounts: { ...attackSurface.counts, operations: operations.length, businessObjects: businessObjects.length, businessStates: businessStates.length },
    findingsBySeverity: findingsBySeverity(db, scanRunId),
    technicalCoverage,
    browserCoverage: computeBrowserCoverage(db, scanRunId),
    businessLogicCoverage: computeBusinessLogicCoverage({ db, scanRunId, targetId: scanRunRow.target_id, profileObjectTypes }),
    environmentClassification: getScanRunEnvironment(db, scanRunId),
    mutationScopeInEffect: getMutationScopeSnapshot(db, scanRunId),
    configuredBusinessExpectations: getBusinessExpectationsSnapshot(db, scanRunId),
    externalTrustBoundaries: listWebhookOperations(db, scanRunId),
    safetySkipped: summarizeSafetySkipped(technicalCoverage),
  };
}
