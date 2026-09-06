import { describe, expect, it } from "vitest";
import { assertWriteEligible, checkWriteEligibility, NoWriteTemplateError } from "./no-guess-enforcement";
import type { DiscoveredOperation } from "./discovered-operation";

describe("checkWriteEligibility / assertWriteEligible", () => {
  it("marks a GET-only field with no OpenAPI/form/JS/manual source as SKIPPED_NO_WRITE_TEMPLATE, per the spec scenario", () => {
    // GET /api/settings returns certificateText, but nothing documents a
    // way to write it — no operation at all exists for PATCH/PUT/POST there.
    const operations: DiscoveredOperation[] = [{ method: "GET", url: "/api/settings", source: "OPENAPI", confidence: "HIGH" }];
    expect(checkWriteEligibility(operations, "PATCH", "/api/settings", "MEDIUM")).toBe("SKIPPED_NO_WRITE_TEMPLATE");
  });

  it("marks a field ELIGIBLE when a matching operation exists at sufficient confidence", () => {
    const operations: DiscoveredOperation[] = [{ method: "PATCH", url: "/api/settings", source: "OPENAPI", confidence: "HIGH" }];
    expect(checkWriteEligibility(operations, "PATCH", "/api/settings", "MEDIUM")).toBe("ELIGIBLE");
  });

  it("marks SKIPPED_NO_WRITE_TEMPLATE when the only operation's confidence is below the scanner's requirement", () => {
    const operations: DiscoveredOperation[] = [{ method: "PATCH", url: "/api/settings", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "LOW" }];
    expect(checkWriteEligibility(operations, "PATCH", "/api/settings", "HIGH")).toBe("SKIPPED_NO_WRITE_TEMPLATE");
  });

  it("assertWriteEligible throws NoWriteTemplateError instead of allowing the caller to proceed", () => {
    expect(() => assertWriteEligible([], "PATCH", "/api/settings", "MEDIUM")).toThrow(NoWriteTemplateError);
  });

  it("end-to-end: a mutating scanner that checks the guard first never sends its mutation when no operation exists", async () => {
    let mutationAttempted = false;
    async function fakeMutatingScannerTest(operations: DiscoveredOperation[]): Promise<void> {
      assertWriteEligible(operations, "PATCH", "/api/settings", "MEDIUM"); // throws before the next line ever runs
      mutationAttempted = true; // would send the actual PATCH request
    }

    await expect(fakeMutatingScannerTest([])).rejects.toThrow(NoWriteTemplateError);
    expect(mutationAttempted).toBe(false);
  });

  it("end-to-end: the same scanner proceeds once an eligible operation exists", async () => {
    let mutationAttempted = false;
    async function fakeMutatingScannerTest(operations: DiscoveredOperation[]): Promise<void> {
      assertWriteEligible(operations, "PATCH", "/api/settings", "MEDIUM");
      mutationAttempted = true;
    }

    const operations: DiscoveredOperation[] = [{ method: "PATCH", url: "/api/settings", source: "HTML_FORM", confidence: "HIGH" }];
    await fakeMutatingScannerTest(operations);
    expect(mutationAttempted).toBe(true);
  });
});
