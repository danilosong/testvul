import { describe, expect, it } from "vitest";
import { HostRateLimiter, NoopRateLimiter } from "./rate-limiter";

describe("NoopRateLimiter", () => {
  it("runs the task immediately with no pacing or concurrency limit", async () => {
    const limiter = new NoopRateLimiter();
    const result = await limiter.run("host-a", async () => 42);
    expect(result).toBe(42);
  });
});

describe("HostRateLimiter", () => {
  it("paces request starts to the configured requests-per-second for a host", async () => {
    const limiter = new HostRateLimiter({ requestsPerSecond: 5, concurrency: 5 }); // ~200ms apart
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, () => limiter.run("host-a", async () => void starts.push(Date.now()))),
    );
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(190);
    }
  });

  it("uses a default of 2 requests per second when unconfigured", async () => {
    const limiter = new HostRateLimiter();
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 2 }, () => limiter.run("host-a", async () => void starts.push(Date.now()))),
    );
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(450); // ~500ms at 2 req/s
  });

  it("limits the number of simultaneously in-flight requests per host", async () => {
    const limiter = new HostRateLimiter({ requestsPerSecond: 1000, concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.run("host-a", async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active--;
        }),
      ),
    );
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("uses a default concurrency of 2 when unconfigured", async () => {
    const limiter = new HostRateLimiter({ requestsPerSecond: 1000 });
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.run("host-a", async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active--;
        }),
      ),
    );
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("tracks pacing and concurrency independently per host", async () => {
    const limiter = new HostRateLimiter({ requestsPerSecond: 2, concurrency: 1 });
    const startA: number[] = [];
    const startB: number[] = [];
    await Promise.all([
      limiter.run("host-a", async () => void startA.push(Date.now())),
      limiter.run("host-b", async () => void startB.push(Date.now())),
    ]);
    expect(Math.abs(startB[0]! - startA[0]!)).toBeLessThan(50); // not serialized across hosts
  });

  it("releases a concurrency slot even when the task throws", async () => {
    const limiter = new HostRateLimiter({ requestsPerSecond: 1000, concurrency: 1 });
    await expect(limiter.run("host-a", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // If the slot wasn't released, this would hang forever.
    await expect(limiter.run("host-a", async () => "ok")).resolves.toBe("ok");
  });
});
