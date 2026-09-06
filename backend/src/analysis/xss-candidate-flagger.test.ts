import { describe, expect, it } from "vitest";
import { flagXssCandidates } from "./xss-candidate-flagger";

describe("flagXssCandidates", () => {
  it("generates a candidate whenever a field is classified HTML, per the spec scenario", () => {
    const result = flagXssCandidates(
      [{ path: "certificate.certificateText", value: "<p>Some rich text</p>" }],
      "/api/certificates/1",
    );
    expect(result).toEqual([
      { scanner: "XSS", fieldPath: "certificate.certificateText", endpoint: "/api/certificates/1", confidence: "HIGH" },
    ]);
  });

  it("does not flag a non-HTML field", () => {
    const result = flagXssCandidates([{ path: "project.name", value: "Alpha" }], "/api/projects/1");
    expect(result).toEqual([]);
  });

  it("flags every HTML field among a mix of classifications", () => {
    const result = flagXssCandidates(
      [
        { path: "bio", value: "<b>hi</b>" },
        { path: "age", value: 30 },
        { path: "notes", value: "<img src=x onerror=alert(1)>" },
      ],
      "/api/users/1",
    );
    expect(result.map((c) => c.fieldPath).sort()).toEqual(["bio", "notes"]);
  });
});
