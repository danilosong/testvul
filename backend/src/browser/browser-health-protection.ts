import type { HealthMonitor } from "../http/health-monitor";
import type { DiscoveredAction } from "./action-discovery";
import type { BrowserScanModeHandlers } from "./browser-scan-mode";

/**
 * Browser Health Protections (Section 12.30, mirroring Section 3.4):
 * reuses the identical `HealthMonitor` class the plain HTTP client uses —
 * not a parallel reimplementation — to pause mutating browser actions
 * (Dry-Run Capture and the Authorized Browser Mutation alike, since both
 * touch the network) while a host is degraded (repeated 429/5xx/growing
 * timeouts), while safe observation (SAFE_READ) always continues
 * regardless of host health.
 */
export function withBrowserHealthProtection(
  healthMonitor: HealthMonitor,
  hostFor: (action: DiscoveredAction) => string,
  handlers: BrowserScanModeHandlers,
): BrowserScanModeHandlers {
  return {
    executeSafeRead: handlers.executeSafeRead,
    dryRunCapture: async (action) => {
      if (healthMonitor.isDegraded(hostFor(action))) return;
      await handlers.dryRunCapture(action);
    },
    authorizedMutation: async (action) => {
      if (healthMonitor.isDegraded(hostFor(action))) return;
      await handlers.authorizedMutation(action);
    },
  };
}
