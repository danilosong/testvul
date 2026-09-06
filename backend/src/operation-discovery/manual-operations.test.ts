import { describe, expect, it } from "vitest";
import { operationFromManualRequest } from "./manual-operations";

describe("operationFromManualRequest", () => {
  it("registers a manual-mode PUT request as a HIGH-confidence MANUAL operation, per the spec scenario", () => {
    const operation = operationFromManualRequest({ method: "put", url: "/api/project/123/settings" });
    expect(operation).toEqual({ method: "PUT", url: "/api/project/123/settings", source: "MANUAL", confidence: "HIGH" });
  });

  it("carries the content type and body when provided", () => {
    const operation = operationFromManualRequest({
      method: "POST",
      url: "/api/settings",
      contentType: "application/json",
      body: { quantity: 5 },
    });
    expect(operation.contentType).toBe("application/json");
    expect(operation.requestSchema).toEqual({ quantity: 5 });
  });
});
