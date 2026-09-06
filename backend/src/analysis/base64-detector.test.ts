import { describe, expect, it } from "vitest";
import { detectBase64Payload, LARGE_PAYLOAD_THRESHOLD_BYTES } from "./base64-detector";

function makeDataUri(mimeType: string, decodedBytes: number): string {
  // base64 length for N decoded bytes (no padding when N is a multiple of 3).
  const base64Length = Math.ceil(decodedBytes / 3) * 4;
  return `data:${mimeType};base64,${"A".repeat(base64Length)}`;
}

describe("detectBase64Payload", () => {
  it("returns null for a non-data-URI string", () => {
    expect(detectBase64Payload("just a normal string")).toBeNull();
  });

  it("returns null for a non-string value", () => {
    expect(detectBase64Payload(42)).toBeNull();
    expect(detectBase64Payload(null)).toBeNull();
  });

  it("detects a small data URI without flagging it as a large payload", () => {
    const uri = makeDataUri("image/png", 100);
    const result = detectBase64Payload(uri);
    expect(result?.isDataUri).toBe(true);
    expect(result?.mimeType).toBe("image/png");
    expect(result?.isLargePayload).toBe(false);
  });

  it("flags a large embedded base64 payload (~7.4MB decoded), per the spec scenario", () => {
    const targetBytes = Math.round(7.4 * 1024 * 1024);
    const uri = makeDataUri("application/octet-stream", targetBytes);

    const result = detectBase64Payload(uri);

    expect(result).not.toBeNull();
    expect(result!.estimatedDecodedBytes).toBeGreaterThan(LARGE_PAYLOAD_THRESHOLD_BYTES);
    expect(result!.estimatedDecodedBytes).toBeCloseTo(targetBytes, -2); // within ~100 bytes
    expect(result!.isLargePayload).toBe(true);
  });

  it("estimates the decoded size correctly accounting for base64 padding", () => {
    // 4 decoded bytes -> ceil(4/3)*4 = 8 base64 chars, but 4 bytes isn't a
    // multiple of 3 so real base64 of 4 bytes has 2 padding chars ("==").
    const base64OfFourBytes = Buffer.from([1, 2, 3, 4]).toString("base64");
    const uri = `data:application/octet-stream;base64,${base64OfFourBytes}`;
    const result = detectBase64Payload(uri);
    expect(result?.estimatedDecodedBytes).toBe(4);
  });
});
