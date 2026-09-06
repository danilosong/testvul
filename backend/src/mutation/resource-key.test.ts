import { describe, expect, it } from "vitest";
import { resourceKeyEquals, resourceKeyToString } from "./resource-key";

const BASE = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };

describe("resourceKeyEquals", () => {
  it("treats two identical keys as equal", () => {
    expect(resourceKeyEquals(BASE, { ...BASE })).toBe(true);
  });

  it("treats the same resourceId under different targetIds as different resources, per the spec scenario", () => {
    expect(resourceKeyEquals(BASE, { ...BASE, targetId: 2 })).toBe(false);
  });

  it("treats the same resourceId under different tenantIds as different resources, per the spec scenario", () => {
    expect(resourceKeyEquals({ ...BASE, tenantId: "t1" }, { ...BASE, tenantId: "t2" })).toBe(false);
  });

  it("treats an undefined tenantId as distinct from a defined one", () => {
    expect(resourceKeyEquals(BASE, { ...BASE, tenantId: "t1" })).toBe(false);
  });

  it("treats different origins, object types, or resource ids as different resources", () => {
    expect(resourceKeyEquals(BASE, { ...BASE, origin: "https://other.com" })).toBe(false);
    expect(resourceKeyEquals(BASE, { ...BASE, objectType: "campaign" })).toBe(false);
    expect(resourceKeyEquals(BASE, { ...BASE, resourceId: "456" })).toBe(false);
  });
});

describe("resourceKeyToString", () => {
  it("produces a distinct string for keys that differ only by targetId", () => {
    expect(resourceKeyToString(BASE)).not.toBe(resourceKeyToString({ ...BASE, targetId: 2 }));
  });

  it("produces a distinct string for keys that differ only by tenantId", () => {
    expect(resourceKeyToString({ ...BASE, tenantId: "t1" })).not.toBe(resourceKeyToString({ ...BASE, tenantId: "t2" }));
  });

  it("produces the same string for identical keys", () => {
    expect(resourceKeyToString(BASE)).toBe(resourceKeyToString({ ...BASE }));
  });
});
