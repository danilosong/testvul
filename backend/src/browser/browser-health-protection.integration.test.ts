import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HealthMonitor } from "../http/health-monitor";
import { withBrowserHealthProtection } from "./browser-health-protection";
import { runBrowserScanForMode } from "./browser-scan-mode";
import type { DiscoveredAction } from "./action-discovery";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
});

afterAll(async () => {
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("Browser Health Protections against the fixture app's degradation endpoints (Section 12.30)", () => {
  it("browser mutations pause while a host is degraded, but safe observation continues", async () => {
    const host = "127.0.0.1";
    const healthMonitor = new HealthMonitor();

    // Drive the host into a degraded state using the fixture's real 500 endpoint.
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const res = await fetch(`${origin()}/errors/500`);
      await res.text();
      healthMonitor.recordResponse(host, res.status, Date.now() - start);
    }
    expect(healthMonitor.isDegraded(host)).toBe(true);

    const readAction: DiscoveredAction = { id: 1, pageUrl: "", selector: "#view", label: "View Report", classification: "SAFE_READ" };
    const mutationAction: DiscoveredAction = {
      id: 2,
      pageUrl: "",
      selector: ".save-settings-btn",
      label: "Save Settings",
      classification: "SAFE_MUTATION",
    };

    const executeSafeRead = vi.fn().mockResolvedValue(undefined);
    const dryRunCapture = vi.fn().mockResolvedValue(undefined);
    const authorizedMutation = vi.fn().mockResolvedValue(undefined);

    const protectedHandlers = withBrowserHealthProtection(healthMonitor, () => host, {
      executeSafeRead,
      dryRunCapture,
      authorizedMutation,
    });

    await runBrowserScanForMode("SAFE_AUTOMATIC", [readAction, mutationAction], protectedHandlers);

    expect(executeSafeRead).toHaveBeenCalledTimes(1); // observation continues
    expect(authorizedMutation).not.toHaveBeenCalled(); // mutation paused
  }, 20_000);

  it("browser mutations proceed normally once the host is healthy", async () => {
    const host = "127.0.0.1";
    const healthMonitor = new HealthMonitor();
    // A few successful requests — host stays healthy.
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const res = await fetch(`${origin()}/`);
      await res.text();
      healthMonitor.recordResponse(host, res.status, Date.now() - start);
    }
    expect(healthMonitor.isDegraded(host)).toBe(false);

    const mutationAction: DiscoveredAction = {
      id: 1,
      pageUrl: "",
      selector: ".save-settings-btn",
      label: "Save Settings",
      classification: "SAFE_MUTATION",
    };
    const authorizedMutation = vi.fn().mockResolvedValue(undefined);
    const protectedHandlers = withBrowserHealthProtection(healthMonitor, () => host, {
      executeSafeRead: vi.fn().mockResolvedValue(undefined),
      dryRunCapture: vi.fn().mockResolvedValue(undefined),
      authorizedMutation,
    });

    await runBrowserScanForMode("SAFE_AUTOMATIC", [mutationAction], protectedHandlers);

    expect(authorizedMutation).toHaveBeenCalledTimes(1);
  }, 20_000);
});
