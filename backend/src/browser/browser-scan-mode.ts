import type { DiscoveredAction } from "./action-discovery";

export type BrowserScanMode = "PASSIVE" | "SAFE_AUTOMATIC" | "ADVANCED";

export interface BrowserScanModeHandlers {
  executeSafeRead: (action: DiscoveredAction) => Promise<void>;
  dryRunCapture: (action: DiscoveredAction) => Promise<void>;
  /** Only ever reached for SAFE_AUTOMATIC/ADVANCED — its own gate (Section 12.20's sequence) still decides authorization/eligibility per action. */
  authorizedMutation: (action: DiscoveredAction) => Promise<void>;
}

/**
 * Browser Scan Modes (Section 12.28): Passive navigates/observes only —
 * a SAFE_MUTATION action is only ever inspected/Dry-Run-captured, never
 * really executed, regardless of anything else; Safe Automatic and
 * Advanced may proceed to an Authorized Browser Mutation (still gated by
 * Section 12.20's own sequence — mode alone never bypasses it). A
 * DESTRUCTIVE action is never reachable in any mode — filtered out before
 * mode is even considered, mirroring Section 12.16's absolute denylist.
 */
export async function runBrowserScanForMode(
  mode: BrowserScanMode,
  actions: readonly DiscoveredAction[],
  handlers: BrowserScanModeHandlers,
): Promise<void> {
  for (const action of actions) {
    if (action.classification === "DESTRUCTIVE") continue;

    if (action.classification === "SAFE_READ") {
      await handlers.executeSafeRead(action);
    } else if (action.classification === "SAFE_MUTATION") {
      if (mode === "PASSIVE") {
        await handlers.dryRunCapture(action);
      } else {
        await handlers.authorizedMutation(action);
      }
    }
    // SENSITIVE_MUTATION / UNKNOWN: never reached in any mode.
  }
}
