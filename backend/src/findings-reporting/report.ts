import type { Db } from "../db/connection";
import { getDashboardData, type DashboardData } from "./dashboard";
import { getScanRunConfigSnapshot, type ScanRunConfigSnapshot } from "../scan-orchestration/scan-run-config-snapshot";
import { listDiscoveredHosts, type DiscoveredHostRecord } from "../discovery/discovered-hosts-repository";
import { listEvidenceForScanRun } from "../evidence/evidence-repository";
import type { EvidenceRecord } from "../evidence/evidence-record";
import { listFindings } from "./finding-repository";
import { getFindingDetail, type FindingDetail } from "./finding-detail";
import type { BrowserEvidence } from "../browser/browser-evidence-repository";
import type { ProfileContributedCandidate } from "../business-logic/business-logic-coverage";
import type { DetectedTechnology } from "../discovery/technology-detector";

/**
 * A scan run is only ever "fully complete" when its true state (Section
 * 14.6) is exactly COMPLETED — COMPLETED_WITH_RECOVERY is a genuinely
 * different, always-distinctly-labeled outcome (a resolved incident, not
 * a clean run), and every other state (PARTIAL/FAILED/CANCELLED/
 * RESTORE_REQUIRED/RUNNING/PASSIVE_PENDING) is obviously incomplete.
 */
export function isScanFullyComplete(state: string): boolean {
  return state === "COMPLETED";
}

export interface AuthProfileSummary {
  id: number;
  name: string;
  method: string;
}

export interface ReportData {
  generatedAt: string;
  executiveSummary: string;
  fullyComplete: boolean;
  scanRunConfigSnapshot: ScanRunConfigSnapshot;
  dashboard: DashboardData;
  discoveredHosts: DiscoveredHostRecord[];
  technology: DetectedTechnology[];
  authProfiles: AuthProfileSummary[];
  findings: FindingDetail[];
  evidence: EvidenceRecord[];
  screenshots: BrowserEvidence[];
  recommendations: string[];
}

function buildExecutiveSummary(dashboard: DashboardData, fullyComplete: boolean): string {
  const totalFindings = Object.values(dashboard.findingsBySeverity).reduce((sum, count) => sum + (count ?? 0), 0);
  const statusPhrase = fullyComplete
    ? "completed"
    : dashboard.scanRun.state === "COMPLETED_WITH_RECOVERY"
      ? "completed with a recovered restore incident — review its incident history before treating this as a clean run"
      : `did not complete cleanly (${dashboard.scanRun.state})`;
  return `Scan run #${dashboard.scanRun.id} against ${dashboard.target.hostname} ${statusPhrase}, with ${totalFindings} finding(s) recorded.`;
}

function listAuthProfilesForScanRun(db: Db, scanRunId: number): AuthProfileSummary[] {
  const rows = db
    .prepare(
      `SELECT ap.id, ap.name, ap.method FROM auth_profiles ap
       JOIN scan_run_auth_profiles srap ON srap.auth_profile_id = ap.id
       WHERE srap.scan_run_id = ? ORDER BY ap.id`,
    )
    .all(scanRunId) as unknown as AuthProfileSummary[];
  return rows;
}

export interface BuildReportDataOptions {
  /** No persisted table backs technology detection yet — the caller passes through whatever `detectTechnologies` (Section 4.6) observed live during discovery, if any. */
  technology?: DetectedTechnology[];
  profileContributedCandidates?: readonly ProfileContributedCandidate[];
}

export function buildReportData(db: Db, scanRunId: number, options: BuildReportDataOptions = {}): ReportData {
  const dashboard = getDashboardData(db, scanRunId, options.profileContributedCandidates ?? []);
  const fullyComplete = isScanFullyComplete(dashboard.scanRun.state);
  const findings = listFindings(db, scanRunId).map((finding) => getFindingDetail(db, finding));
  const evidence = listEvidenceForScanRun(db, scanRunId);
  const screenshots = findings.flatMap((finding) => finding.browserEvidence).filter((e) => e.kind === "SCREENSHOT");
  const recommendations = [...new Set(findings.map((f) => f.recommendation).filter((r): r is string => r !== undefined))];

  return {
    generatedAt: new Date().toISOString(),
    executiveSummary: buildExecutiveSummary(dashboard, fullyComplete),
    fullyComplete,
    scanRunConfigSnapshot: getScanRunConfigSnapshot(db, scanRunId),
    dashboard,
    discoveredHosts: listDiscoveredHosts(db, scanRunId),
    technology: options.technology ?? [],
    authProfiles: listAuthProfilesForScanRun(db, scanRunId),
    findings,
    evidence,
    screenshots,
    recommendations,
  };
}

export function renderReportAsJson(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders the same `ReportData` as HTML. The status banner is the one
 * element every other section sits below — a non-COMPLETED state (PARTIAL/
 * FAILED/CANCELLED/RESTORE_REQUIRED/RUNNING) always gets a visibly
 * different banner than a clean run, and COMPLETED_WITH_RECOVERY gets its
 * own distinct banner too, never the plain "Completed" one.
 */
export function renderReportAsHtml(data: ReportData): string {
  const state = data.dashboard.scanRun.state;
  const bannerLabel = state === "COMPLETED" ? "Completed" : state === "COMPLETED_WITH_RECOVERY" ? "Completed With Recovery" : `Not Complete: ${state}`;
  const bannerClass = state === "COMPLETED" ? "status-completed" : state === "COMPLETED_WITH_RECOVERY" ? "status-completed-with-recovery" : "status-incomplete";

  const findingsHtml = data.findings
    .map(
      (finding) =>
        `<li><strong>${escapeHtml(finding.severity)}</strong> — ${escapeHtml(finding.observation)} (${escapeHtml(finding.evidentiaryOutcome)})</li>`,
    )
    .join("\n");

  const recommendationsHtml = data.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("\n");

  return `<h1>Security Configuration Auditor Report</h1>
<p class="${bannerClass}">Scan Run Status: ${escapeHtml(bannerLabel)}</p>
<p>${escapeHtml(data.executiveSummary)}</p>
<h2>Findings</h2>
<ul>${findingsHtml}</ul>
<h2>Recommendations</h2>
<ul>${recommendationsHtml}</ul>
<p>Generated at ${escapeHtml(data.generatedAt)}</p>`;
}
