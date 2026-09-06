import { describe, expect, it } from "vitest";
import { flagUrlCandidates } from "./url-candidate-flagger";

describe("flagUrlCandidates", () => {
  it("records an imageUrl field starting with https:// as a URL candidate, per the spec scenario", () => {
    const result = flagUrlCandidates([{ path: "imageUrl", value: "https://cdn.example.com/logo.png" }], "/api/projects/1");
    expect(result).toEqual([
      {
        scanner: "URL_VALIDATION",
        fieldPath: "imageUrl",
        endpoint: "/api/projects/1",
        value: "https://cdn.example.com/logo.png",
        confidence: "MEDIUM",
      },
    ]);
  });

  it("also recognizes an http:// value", () => {
    const result = flagUrlCandidates([{ path: "webhookUrl", value: "http://example.com/hook" }], "/api/settings");
    expect(result).toHaveLength(1);
  });

  it("does not flag a non-URL string field", () => {
    const result = flagUrlCandidates([{ path: "project.name", value: "Alpha" }], "/api/projects/1");
    expect(result).toEqual([]);
  });
});
