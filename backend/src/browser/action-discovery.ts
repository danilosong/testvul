import type { Db } from "../db/connection";
import type { DiscoveredButton } from "./browser-runtime-discovery";
import { isDestructiveAction } from "./destructive-action-denylist";

export type ActionClassification = "SAFE_READ" | "SAFE_MUTATION" | "SENSITIVE_MUTATION" | "DESTRUCTIVE" | "UNKNOWN";

export interface DiscoveredAction {
  id: number;
  pageUrl: string;
  selector: string;
  label: string;
  classification: ActionClassification;
}

const SENSITIVE_PATTERN = /\b(password|balance)\b/i;
const SAFE_MUTATION_PATTERN = /\b(save|update|submit|change|edit|add|create)\b/i;
const SAFE_READ_PATTERN = /\b(view|show|list|search|filter|refresh|export|download)\b/i;

/**
 * Action Discovery classification (Section 12.14): a purely static,
 * label-driven signal — no operation/method is known yet at this stage
 * (that's Section 12.19's Dry-Run Capture) — so classification is
 * deliberately conservative and text-pattern-based, never assuming a
 * button is safe just because its underlying request hasn't been
 * observed yet. The absolute Destructive Action Denylist (Section 12.16)
 * is checked first and unconditionally forces DESTRUCTIVE — no softer
 * pattern below it can ever downgrade a denylisted label.
 */
export function classifyActionLabel(labelOrSelector: string): ActionClassification {
  if (isDestructiveAction(labelOrSelector)) return "DESTRUCTIVE";
  if (SENSITIVE_PATTERN.test(labelOrSelector)) return "SENSITIVE_MUTATION";
  if (SAFE_MUTATION_PATTERN.test(labelOrSelector)) return "SAFE_MUTATION";
  if (SAFE_READ_PATTERN.test(labelOrSelector)) return "SAFE_READ";
  return "UNKNOWN";
}

function persistDiscoveredAction(
  db: Db,
  scanRunId: number,
  pageUrl: string,
  button: DiscoveredButton,
  classification: ActionClassification,
): number {
  const result = db
    .prepare("INSERT INTO browser_actions (scan_run_id, page_url, label, classification) VALUES (?, ?, ?, ?)")
    .run(scanRunId, pageUrl, button.label || button.selector, classification);
  return Number(result.lastInsertRowid);
}

/**
 * Classifies and persists every discovered button to `browser_actions` —
 * the single insertion path Section 12.15's Discovery-Stage-Is-Read-Only
 * enforcement and later Security-Test-Stage execution both read from.
 * Classification is based on the button's visible label (falling back to
 * its selector when no label text is present at all).
 */
export function discoverAndClassifyActions(
  db: Db,
  scanRunId: number,
  pageUrl: string,
  buttons: readonly DiscoveredButton[],
): DiscoveredAction[] {
  return buttons.map((button) => {
    const classification = classifyActionLabel(button.label || button.selector);
    const id = persistDiscoveredAction(db, scanRunId, pageUrl, button, classification);
    return { id, pageUrl, selector: button.selector, label: button.label, classification };
  });
}
