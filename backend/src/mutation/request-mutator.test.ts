import { describe, expect, it } from "vitest";
import { mutateField, matchesExpectedState } from "./request-mutator";

function buildFortyTwoFieldResource() {
  const resource: Record<string, unknown> = { certificate: { certificateText: "original html" } };
  for (let i = 0; i < 40; i++) resource[`field${i}`] = i % 2 === 0 ? `value${i}` : i;
  resource.enabled = true;
  return resource;
}

describe("mutateField", () => {
  it("changes only the target field and leaves the other 41 fields deeply equal (not byte-equal), per the spec scenario", () => {
    const original = buildFortyTwoFieldResource();
    const { mutatedBody } = mutateField(original, "certificate.certificateText", "<script>test</script>");

    expect((mutatedBody as typeof original).certificate).toEqual({ certificateText: "<script>test</script>" });

    const { certificate: _omit1, ...originalRest } = original;
    const { certificate: _omit2, ...mutatedRest } = mutatedBody as typeof original;
    expect(mutatedRest).toEqual(originalRest); // deep equality, not reference/byte equality
  });

  it("does not alter an unrelated array's length, order, or values, per the spec scenario", () => {
    const original = { name: "Alpha", tags: ["a", "b", "c"], certificate: { certificateText: "x" } };
    const { mutatedBody } = mutateField(original, "certificate.certificateText", "<b>y</b>");
    expect((mutatedBody as typeof original).tags).toEqual(["a", "b", "c"]);
  });

  it("does not alter a sibling field's type, per the spec scenario", () => {
    const original = { flag: true, count: 42, certificate: { certificateText: "x" } };
    const { mutatedBody } = mutateField(original, "certificate.certificateText", "<b>y</b>");
    const result = mutatedBody as typeof original;
    expect(typeof result.flag).toBe("boolean");
    expect(result.flag).toBe(true);
    expect(typeof result.count).toBe("number");
    expect(result.count).toBe(42);
  });

  it("does not mutate the original object passed in", () => {
    const original = { certificate: { certificateText: "original" } };
    mutateField(original, "certificate.certificateText", "changed");
    expect(original.certificate.certificateText).toBe("original");
  });

  it("supports mutating a field inside an array of objects", () => {
    const original = { items: [{ id: 1, html: "a" }, { id: 2, html: "b" }] };
    const { mutatedBody } = mutateField(original, "items.1.html", "<b>c</b>");
    const result = mutatedBody as typeof original;
    expect(result.items[0]).toEqual({ id: 1, html: "a" });
    expect(result.items[1]).toEqual({ id: 2, html: "<b>c</b>" });
  });
});

describe("matchesExpectedState", () => {
  it("matches when the resource still holds the test value and nothing else changed", () => {
    const original = { name: "Alpha", certificate: { certificateText: "x" } };
    const { mutatedBody, expectedPostMutationState } = mutateField(original, "certificate.certificateText", "<b>y</b>");
    expect(matchesExpectedState(mutatedBody, expectedPostMutationState)).toBe(true);
  });

  it("does not match when the target field was reverted or changed again", () => {
    const original = { name: "Alpha", certificate: { certificateText: "x" } };
    const { expectedPostMutationState } = mutateField(original, "certificate.certificateText", "<b>y</b>");
    expect(matchesExpectedState(original, expectedPostMutationState)).toBe(false);
  });

  it("does not match when an unrelated field changed externally (the restore-fallback conflict signal)", () => {
    const original = { name: "Alpha", certificate: { certificateText: "x" } };
    const { mutatedBody, expectedPostMutationState } = mutateField(original, "certificate.certificateText", "<b>y</b>");
    const externallyModified = { ...(mutatedBody as typeof original), name: "Changed by someone else" };
    expect(matchesExpectedState(externallyModified, expectedPostMutationState)).toBe(false);
  });
});
