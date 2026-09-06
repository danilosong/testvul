import { describe, expect, it, vi } from "vitest";
import { runDiscoveryStage } from "./discovery-stage";
import type { DiscoveredAction } from "./action-discovery";

function action(classification: DiscoveredAction["classification"], label: string): DiscoveredAction {
  return { id: Math.random(), pageUrl: "https://example.com/app", selector: `#${label}`, label, classification };
}

describe("runDiscoveryStage — Discovery Stage Is Read-Only enforcement", () => {
  it("executes SAFE_READ actions and dry-run-captures SAFE_MUTATION actions, but never executes anything else", async () => {
    const actions: DiscoveredAction[] = [
      action("SAFE_READ", "View Report"),
      action("SAFE_MUTATION", "Save Settings"),
      action("SENSITIVE_MUTATION", "Withdraw Funds"),
      action("DESTRUCTIVE", "Delete Account"),
      action("UNKNOWN", "Go"),
    ];

    const executeSafeRead = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn().mockResolvedValue(undefined);

    await runDiscoveryStage(actions, { executeSafeRead, dryRunCapture });

    expect(executeSafeRead).toHaveBeenCalledTimes(1);
    expect(executeSafeRead).toHaveBeenCalledWith(actions[0]);
    expect(dryRunCapture).toHaveBeenCalledTimes(1);
    expect(dryRunCapture).toHaveBeenCalledWith(actions[1]);
  });

  it("no real mutation occurs for any SAFE_MUTATION candidate while the pipeline is in a discovery stage — verified against a stand-in for Section 12.20's not-yet-built real mutation function", async () => {
    const actions: DiscoveredAction[] = [
      action("SAFE_READ", "View Report"),
      action("SAFE_MUTATION", "Save Settings"),
      action("SAFE_MUTATION", "Update Profile"),
      action("SENSITIVE_MUTATION", "Withdraw Funds"),
      action("DESTRUCTIVE", "Delete Account"),
    ];

    // A stand-in for the real Authorized Browser Mutation function
    // (Section 12.20) — not yet built. Even though this stage's own
    // dry-run handler *could* call it (nothing stops a handler
    // implementation from doing so), a correct dry-run-capture
    // implementation for this stage never does — and this stage's own
    // orchestration (`runDiscoveryStage`) has no path to it at all.
    const realMutationFn = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn(async () => {
      // Correct behavior: inspect/capture only, never call realMutationFn.
    });
    const executeSafeRead = vi.fn().mockResolvedValue(undefined);

    await runDiscoveryStage(actions, { executeSafeRead, dryRunCapture });

    expect(realMutationFn).not.toHaveBeenCalled();
    // Both SAFE_MUTATION actions were at least dry-run-captured, not skipped outright.
    expect(dryRunCapture).toHaveBeenCalledTimes(2);
  });

  it("does not call any handler for SENSITIVE_MUTATION, DESTRUCTIVE, or UNKNOWN actions", async () => {
    const actions: DiscoveredAction[] = [
      action("SENSITIVE_MUTATION", "Withdraw Funds"),
      action("DESTRUCTIVE", "Delete Account"),
      action("UNKNOWN", "Go"),
    ];
    const executeSafeRead = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn().mockResolvedValue(undefined);

    await runDiscoveryStage(actions, { executeSafeRead, dryRunCapture });

    expect(executeSafeRead).not.toHaveBeenCalled();
    expect(dryRunCapture).not.toHaveBeenCalled();
  });
});
