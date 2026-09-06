import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { truncateIfOversized } from "./truncate-body";

describe("truncateIfOversized", () => {
  it("returns the body unchanged when it's within the limit", () => {
    const result = truncateIfOversized("short body", 1000);
    expect(result).toEqual({ value: "short body", truncated: false });
  });

  it("returns the body unchanged when it's exactly at the limit", () => {
    const body = "x".repeat(10);
    const result = truncateIfOversized(body, 10);
    expect(result.truncated).toBe(false);
  });

  it("truncates a body exceeding the limit and reports the original size and content hash", () => {
    const body = "x".repeat(100);
    const result = truncateIfOversized(body, 10);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe("x".repeat(10));
    expect(result.value.length).toBe(10);
    expect(result.originalSize).toBe(100);
    expect(result.contentHash).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
  });

  it("measures the limit in UTF-8 bytes, not characters", () => {
    // Each "é" is 2 bytes in UTF-8.
    const body = "é".repeat(20); // 40 bytes
    const result = truncateIfOversized(body, 10);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.value, "utf8")).toBeLessThanOrEqual(10);
  });
});
