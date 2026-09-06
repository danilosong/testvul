import { describe, expect, it, vi } from "vitest";
import { runBrowserScanForMode } from "./browser-scan-mode";
import type { DiscoveredAction } from "./action-discovery";

function action(classification: DiscoveredAction["classification"], label: string): DiscoveredAction {
  return { id: Math.random(), pageUrl: "https://example.com/app", selector: `#${label}`, label, classification };
}

const ACTIONS: DiscoveredAction[] = [
  action("SAFE_READ", "View Report"),
  action("SAFE_MUTATION", "Save Settings"),
  action("SENSITIVE_MUTATION", "Withdraw Funds"),
  action("DESTRUCTIVE", "Delete Account"),
  action("UNKNOWN", "Go"),
];

describe("runBrowserScanForMode", () => {
  it("PASSIVE mode executes zero mutating actions — a SAFE_MUTATION action is only ever dry-run-captured", async () => {
    const executeSafeRead = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn().mockResolvedValue(undefined);
    const authorizedMutation = vi.fn().mockResolvedValue(undefined);

    await runBrowserScanForMode("PASSIVE", ACTIONS, { executeSafeRead, dryRunCapture, authorizedMutation });

    expect(authorizedMutation).not.toHaveBeenCalled();
    expect(dryRunCapture).toHaveBeenCalledTimes(1);
    expect(executeSafeRead).toHaveBeenCalledTimes(1);
  });

  it("SAFE_AUTOMATIC mode attempts an authorized mutation for a SAFE_MUTATION action", async () => {
    const executeSafeRead = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn().mockResolvedValue(undefined);
    const authorizedMutation = vi.fn().mockResolvedValue(undefined);

    await runBrowserScanForMode("SAFE_AUTOMATIC", ACTIONS, { executeSafeRead, dryRunCapture, authorizedMutation });

    expect(authorizedMutation).toHaveBeenCalledTimes(1);
    expect(dryRunCapture).not.toHaveBeenCalled();
  });

  it("DESTRUCTIVE is never reachable in any mode", async () => {
    for (const mode of ["PASSIVE", "SAFE_AUTOMATIC", "ADVANCED"] as const) {
      const executeSafeRead = vi.fn().mockResolvedValue(undefined);
      const dryRunCapture = vi.fn().mockResolvedValue(undefined);
      const authorizedMutation = vi.fn().mockResolvedValue(undefined);

      await runBrowserScanForMode(mode, [action("DESTRUCTIVE", "Delete Account")], { executeSafeRead, dryRunCapture, authorizedMutation });

      expect(executeSafeRead).not.toHaveBeenCalled();
      expect(dryRunCapture).not.toHaveBeenCalled();
      expect(authorizedMutation).not.toHaveBeenCalled();
    }
  });

  it("SENSITIVE_MUTATION and UNKNOWN are never reachable in any mode", async () => {
    const executeSafeRead = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn().mockResolvedValue(undefined);
    const authorizedMutation = vi.fn().mockResolvedValue(undefined);

    await runBrowserScanForMode("ADVANCED", [action("SENSITIVE_MUTATION", "Withdraw Funds"), action("UNKNOWN", "Go")], {
      executeSafeRead,
      dryRunCapture,
      authorizedMutation,
    });

    expect(executeSafeRead).not.toHaveBeenCalled();
    expect(dryRunCapture).not.toHaveBeenCalled();
    expect(authorizedMutation).not.toHaveBeenCalled();
  });
});
