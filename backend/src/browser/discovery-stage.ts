import type { DiscoveredAction } from "./action-discovery";

export interface DiscoveryStageHandlers {
  executeSafeRead: (action: DiscoveredAction) => Promise<void>;
  dryRunCapture: (action: DiscoveredAction) => Promise<void>;
}

/**
 * Discovery Stage Is Read-Only enforcement (design.md, matching
 * `scan-orchestration`'s Fixed Pipeline Sequence): during Static Discovery
 * and Browser Runtime Discovery, SAFE_READ actions are actually executed;
 * SAFE_MUTATION actions are only ever inspected/Dry-Run-captured
 * (Section 12.19), never executed for real; SENSITIVE_MUTATION/
 * DESTRUCTIVE/UNKNOWN actions are neither executed nor dry-run-captured —
 * skipped entirely. This function's own signature has no parameter or
 * closure reference capable of performing a real mutation at all — a
 * real mutation is only ever reachable from the Security Test Stage's own
 * sequenced mutation function (Section 12.20's Safe Browser Mutation
 * sequence), a structurally separate call path this stage never touches,
 * not a mode/flag on this one.
 */
export async function runDiscoveryStage(actions: readonly DiscoveredAction[], handlers: DiscoveryStageHandlers): Promise<void> {
  for (const action of actions) {
    if (action.classification === "SAFE_READ") {
      await handlers.executeSafeRead(action);
    } else if (action.classification === "SAFE_MUTATION") {
      await handlers.dryRunCapture(action);
    }
    // SENSITIVE_MUTATION / DESTRUCTIVE / UNKNOWN: skipped entirely — never
    // executed and never even dry-run-captured during discovery.
  }
}
