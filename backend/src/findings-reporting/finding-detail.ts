import type { Db } from "../db/connection";
import { listBrowserEvidenceForFinding, type BrowserEvidence } from "../browser/browser-evidence-repository";
import { getFindingConfirmationLabel } from "../business-logic/business-findings";
import type { Finding } from "./finding";

/**
 * A human-readable, confirmation-guarded summary of what a finding
 * actually shows — for a business-logic finding this is exactly
 * `describeBusinessFinding` (Section 13.20)'s own OBSERVED/INFERRED-
 * never-CONFIRMED guardrail; a technical finding gets the analogous
 * treatment using its `evidentiaryOutcome` instead, since it never
 * carries a `proofLevel` at all.
 */
export function describeFindingObservation(finding: Pick<Finding, "title" | "proofLevel" | "evidentiaryOutcome">): string {
  if (finding.proofLevel !== undefined) {
    const label = getFindingConfirmationLabel(finding.proofLevel);
    return label === "CONFIRMED" ? `[CONFIRMED] ${finding.title}` : `[${finding.proofLevel}] ${finding.title}`;
  }
  return `[${finding.evidentiaryOutcome}] ${finding.title}`;
}

export interface FindingDetail extends Finding {
  targetName: string;
  targetHostname: string;
  /** The resolved Authentication Profile's own name — absent when the finding carries no `authProfileId` at all. */
  authProfileName?: string;
  observation: string;
  /** Empty for a purely API-driven finding — populated only for a browser-assisted one (Section 15.5), each entry naming exactly which browser page/API call/result combination proved it. */
  browserEvidence: BrowserEvidence[];
}

interface FindingTargetRow {
  target_name: string;
  target_hostname: string;
}

export function getFindingDetail(db: Db, finding: Finding): FindingDetail {
  const targetRow = db
    .prepare(
      `SELECT t.name as target_name, t.hostname as target_hostname
       FROM findings f
       JOIN scan_runs sr ON sr.id = f.scan_run_id
       JOIN targets t ON t.id = sr.target_id
       WHERE f.id = ?`,
    )
    .get(finding.id) as FindingTargetRow | undefined;
  if (!targetRow) throw new Error(`No finding found with id ${finding.id}`);

  const detail: FindingDetail = {
    ...finding,
    targetName: targetRow.target_name,
    targetHostname: targetRow.target_hostname,
    observation: describeFindingObservation(finding),
    browserEvidence: listBrowserEvidenceForFinding(db, finding.id),
  };

  if (finding.authProfileId !== undefined) {
    const authProfileRow = db.prepare("SELECT name FROM auth_profiles WHERE id = ?").get(finding.authProfileId) as { name: string } | undefined;
    if (authProfileRow) detail.authProfileName = authProfileRow.name;
  }

  return detail;
}
