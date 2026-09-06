import { describe, expect, it } from "vitest";
import { HealthMonitor } from "./health-monitor";

describe("HealthMonitor", () => {
  it("is not degraded before any response is recorded", () => {
    const monitor = new HealthMonitor();
    expect(monitor.isDegraded("host-a")).toBe(false);
  });

  it("is not degraded while healthy (200) responses are recorded", () => {
    const monitor = new HealthMonitor();
    for (let i = 0; i < 10; i++) monitor.recordResponse("host-a", 200, 10);
    expect(monitor.isDegraded("host-a")).toBe(false);
  });

  it("becomes degraded once enough bad responses land within the window", () => {
    const monitor = new HealthMonitor({ windowSize: 5, degradedThreshold: 3 });
    monitor.recordResponse("host-a", 429, 10);
    monitor.recordResponse("host-a", 200, 10);
    expect(monitor.isDegraded("host-a")).toBe(false);
    monitor.recordResponse("host-a", 500, 10);
    monitor.recordResponse("host-a", 503, 10);
    expect(monitor.isDegraded("host-a")).toBe(true);
  });

  it("treats a timeout the same as a bad status for degradation purposes", () => {
    const monitor = new HealthMonitor({ windowSize: 5, degradedThreshold: 2 });
    monitor.recordTimeout("host-a");
    monitor.recordTimeout("host-a");
    expect(monitor.isDegraded("host-a")).toBe(true);
  });

  it("recovers once enough recent responses fall out of the degraded window", () => {
    const monitor = new HealthMonitor({ windowSize: 3, degradedThreshold: 2 });
    monitor.recordResponse("host-a", 500, 10);
    monitor.recordResponse("host-a", 502, 10);
    expect(monitor.isDegraded("host-a")).toBe(true);
    monitor.recordResponse("host-a", 200, 10);
    monitor.recordResponse("host-a", 200, 10);
    // window now holds [502, 200, 200] — only 1 bad outcome left
    expect(monitor.isDegraded("host-a")).toBe(false);
  });

  it("tracks degradation independently per host", () => {
    const monitor = new HealthMonitor({ windowSize: 5, degradedThreshold: 2 });
    monitor.recordResponse("host-a", 500, 10);
    monitor.recordResponse("host-a", 500, 10);
    monitor.recordResponse("host-b", 200, 10);
    expect(monitor.isDegraded("host-a")).toBe(true);
    expect(monitor.isDegraded("host-b")).toBe(false);
  });

  it("reports latency, timeout, and status counters in its snapshot", () => {
    const monitor = new HealthMonitor();
    monitor.recordResponse("host-a", 200, 100);
    monitor.recordResponse("host-a", 200, 200);
    monitor.recordResponse("host-a", 429, 50);
    monitor.recordTimeout("host-a");

    const snapshot = monitor.snapshot("host-a");
    expect(snapshot.averageLatencyMs).toBeCloseTo((100 + 200 + 50) / 3);
    expect(snapshot.statusCounters[200]).toBe(2);
    expect(snapshot.statusCounters[429]).toBe(1);
    expect(snapshot.timeouts).toBe(1);
  });
});
