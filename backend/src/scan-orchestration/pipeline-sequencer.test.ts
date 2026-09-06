import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, runPipeline, type PipelineStageProgress } from "./pipeline-sequencer";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runPipeline (Section 14.2)", () => {
  it("runs every supplied stage strictly in PIPELINE_STAGES order, regardless of each stage's individual duration", async () => {
    const executionOrder: string[] = [];
    // Deliberately give EARLIER stages a longer delay than LATER ones — if
    // the sequencer ever raced stages instead of awaiting each fully, a
    // later, faster stage would finish (and be recorded) before an
    // earlier, slower one.
    const result = await runPipeline({
      stageRunners: {
        DNS_RESOLVER: async () => {
          await delay(15);
          executionOrder.push("DNS_RESOLVER");
        },
        SCOPE_VALIDATION: async () => {
          await delay(10);
          executionOrder.push("SCOPE_VALIDATION");
        },
        HTTP_DISCOVERY: async () => {
          await delay(1);
          executionOrder.push("HTTP_DISCOVERY");
        },
        SECURITY_TESTS: async () => {
          executionOrder.push("SECURITY_TESTS");
        },
        REPORT: async () => {
          executionOrder.push("REPORT");
        },
      },
    });

    expect(executionOrder).toEqual(["DNS_RESOLVER", "SCOPE_VALIDATION", "HTTP_DISCOVERY", "SECURITY_TESTS", "REPORT"]);
    expect(result.progress.map((p) => p.stage)).toEqual(["DNS_RESOLVER", "SCOPE_VALIDATION", "HTTP_DISCOVERY", "SECURITY_TESTS", "REPORT"]);
  });

  it("skips a stage with no runner supplied without breaking or reordering the rest of the sequence", async () => {
    const executionOrder: string[] = [];
    await runPipeline({
      stageRunners: {
        DNS_RESOLVER: async () => executionOrder.push("DNS_RESOLVER"),
        // SCOPE_VALIDATION deliberately has no runner.
        HTTP_DISCOVERY: async () => executionOrder.push("HTTP_DISCOVERY"),
      },
    });
    expect(executionOrder).toEqual(["DNS_RESOLVER", "HTTP_DISCOVERY"]);
  });

  it("threads each earlier stage's result forward to every later stage", async () => {
    const result = await runPipeline({
      stageRunners: {
        DNS_RESOLVER: async () => ({ addresses: ["127.0.0.1"] }),
        HTTP_DISCOVERY: async (previous) => {
          const dns = previous.DNS_RESOLVER as { addresses: string[] };
          return { sawAddresses: dns.addresses };
        },
      },
    });
    expect(result.results.HTTP_DISCOVERY).toEqual({ sawAddresses: ["127.0.0.1"] });
  });

  it("exposes RUNNING then COMPLETED progress for each executed stage, in order, via onProgress", async () => {
    const events: PipelineStageProgress[] = [];
    await runPipeline({
      stageRunners: {
        DNS_RESOLVER: async () => undefined,
        SCOPE_VALIDATION: async () => undefined,
      },
      onProgress: (progress) => events.push(progress),
    });
    expect(events.map((e) => [e.stage, e.status])).toEqual([
      ["DNS_RESOLVER", "RUNNING"],
      ["DNS_RESOLVER", "COMPLETED"],
      ["SCOPE_VALIDATION", "RUNNING"],
      ["SCOPE_VALIDATION", "COMPLETED"],
    ]);
  });

  it("stops the sequence immediately on a stage failure — no later stage ever runs", async () => {
    const executionOrder: string[] = [];
    await expect(
      runPipeline({
        stageRunners: {
          DNS_RESOLVER: async () => executionOrder.push("DNS_RESOLVER"),
          SCOPE_VALIDATION: async () => {
            throw new Error("scope validation failed");
          },
          HTTP_DISCOVERY: async () => executionOrder.push("HTTP_DISCOVERY"),
        },
      }),
    ).rejects.toThrow("scope validation failed");

    expect(executionOrder).toEqual(["DNS_RESOLVER"]);
  });

  it("marks a failed stage FAILED in its progress entry, with no finishedAt left implicit", async () => {
    const events: PipelineStageProgress[] = [];
    await expect(
      runPipeline({
        stageRunners: {
          DNS_RESOLVER: async () => {
            throw new Error("boom");
          },
        },
        onProgress: (progress) => events.push(progress),
      }),
    ).rejects.toThrow("boom");

    expect(events[events.length - 1]).toMatchObject({ stage: "DNS_RESOLVER", status: "FAILED" });
    expect(events[events.length - 1]?.finishedAt).toBeDefined();
  });

  it("PIPELINE_STAGES names every stage from design.md's Fixed Pipeline Sequence, in order", () => {
    expect(PIPELINE_STAGES).toEqual([
      "DNS_RESOLVER",
      "SCOPE_VALIDATION",
      "HTTP_DISCOVERY",
      "CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY",
      "API_DISCOVERY",
      "JSON_DOM_ANALYZER",
      "OPERATION_DISCOVERY",
      "BUSINESS_OBJECT_STATE_DISCOVERY",
      "CANDIDATE_GENERATOR",
      "ELIGIBILITY_CLASSIFICATION",
      "AUTHENTICATION_MAPPING",
      "SECURITY_TESTS",
      "EVIDENCE",
      "RESTORE",
      "REPORT",
    ]);
  });
});
