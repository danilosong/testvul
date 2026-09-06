import { describe, expect, it, vi } from "vitest";
import { runActiveXssConfirmation, OutOfDomainConfirmationError } from "./active-xss-confirmation";
import { classifyStoredXss } from "./xss-canary";
import { classifySanitizerProbe, generateSanitizerProbe } from "./sanitizer-probe";

describe("runActiveXssConfirmation", () => {
  it("does not run without explicit opt-in — the default is disabled", async () => {
    const runner = { confirmExecution: vi.fn() };
    const outcome = await runActiveXssConfirmation(
      { enabled: false, authorizedDomain: "example.com" },
      "https://example.com/page",
      runner,
    );
    expect(outcome).toBe("NOT_RUN");
    expect(runner.confirmExecution).not.toHaveBeenCalled();
  });

  it("does not run when a runner is unavailable, even if opted in", async () => {
    const outcome = await runActiveXssConfirmation({ enabled: true, authorizedDomain: "example.com" }, "https://example.com/page");
    expect(outcome).toBe("NOT_RUN");
  });

  it("refuses to run against a URL outside the authorized domain, even when opted in", async () => {
    const runner = { confirmExecution: vi.fn() };
    await expect(
      runActiveXssConfirmation({ enabled: true, authorizedDomain: "example.com" }, "https://evil.example.net/page", runner),
    ).rejects.toThrow(OutOfDomainConfirmationError);
    expect(runner.confirmExecution).not.toHaveBeenCalled();
  });

  it("allows a subdomain of the authorized domain", async () => {
    const runner = { confirmExecution: vi.fn().mockResolvedValue(false) };
    const outcome = await runActiveXssConfirmation(
      { enabled: true, authorizedDomain: "example.com" },
      "https://staging.example.com/page",
      runner,
    );
    expect(outcome).toBe("EXECUTION_NOT_OBSERVED");
  });

  it("produces EXECUTION_CONFIRMED only when the runner actually ran and actually observed execution", async () => {
    const runner = { confirmExecution: vi.fn().mockResolvedValue(true) };
    const outcome = await runActiveXssConfirmation(
      { enabled: true, authorizedDomain: "example.com" },
      "https://example.com/page",
      runner,
    );
    expect(outcome).toBe("EXECUTION_CONFIRMED");
    expect(runner.confirmExecution).toHaveBeenCalledWith("https://example.com/page");
  });

  it("produces EXECUTION_NOT_OBSERVED, not EXECUTION_CONFIRMED, when the runner ran but didn't observe execution", async () => {
    const runner = { confirmExecution: vi.fn().mockResolvedValue(false) };
    const outcome = await runActiveXssConfirmation(
      { enabled: true, authorizedDomain: "example.com" },
      "https://example.com/page",
      runner,
    );
    expect(outcome).toBe("EXECUTION_NOT_OBSERVED");
  });
});

describe("no finding is ever labeled EXECUTION_CONFIRMED by default", () => {
  it("neither the base canary classifier nor the Sanitizer Probe classifier can ever return EXECUTION_CONFIRMED", () => {
    const probe = generateSanitizerProbe();
    const baseResult = classifyStoredXss(probe.payload, "some-uuid");
    const probeResult = classifySanitizerProbe(probe.payload, probe.uuid);

    expect(baseResult).not.toBe("EXECUTION_CONFIRMED");
    expect(probeResult).not.toBe("EXECUTION_CONFIRMED");
  });
});
