import { describe, expect, it } from "vitest";
import { DEFAULT_RESPONSE_SIZE_LIMITS, limitForContentType, readBodyWithLimit } from "./response-size-limit";

describe("limitForContentType", () => {
  it("applies the HTML limit for text/html (ignoring parameters like charset)", () => {
    expect(limitForContentType("text/html; charset=utf-8", DEFAULT_RESPONSE_SIZE_LIMITS)).toBe(
      DEFAULT_RESPONSE_SIZE_LIMITS.html,
    );
  });

  it("applies the JSON limit for application/json", () => {
    expect(limitForContentType("application/json", DEFAULT_RESPONSE_SIZE_LIMITS)).toBe(DEFAULT_RESPONSE_SIZE_LIMITS.json);
  });

  it("applies the JS limit for both application/javascript and text/javascript", () => {
    expect(limitForContentType("application/javascript", DEFAULT_RESPONSE_SIZE_LIMITS)).toBe(DEFAULT_RESPONSE_SIZE_LIMITS.js);
    expect(limitForContentType("text/javascript", DEFAULT_RESPONSE_SIZE_LIMITS)).toBe(DEFAULT_RESPONSE_SIZE_LIMITS.js);
  });

  it("falls back to the default limit for an unrecognized or missing content type", () => {
    expect(limitForContentType("image/png", DEFAULT_RESPONSE_SIZE_LIMITS)).toBe(DEFAULT_RESPONSE_SIZE_LIMITS.default);
    expect(limitForContentType(undefined, DEFAULT_RESPONSE_SIZE_LIMITS)).toBe(DEFAULT_RESPONSE_SIZE_LIMITS.default);
  });
});

async function* chunksOf(sizes: number[]): AsyncGenerator<Buffer> {
  for (const size of sizes) {
    yield Buffer.alloc(size, "A");
  }
}

describe("readBodyWithLimit", () => {
  it("returns the full body untruncated when under the limit", async () => {
    const result = await readBodyWithLimit(chunksOf([10, 10]), 100);
    expect(result.truncated).toBe(false);
    expect(result.receivedBytes).toBe(20);
    expect(result.body).toHaveLength(20);
  });

  it("aborts as soon as the cumulative size crosses the limit", async () => {
    let destroyed = false;
    const stream = Object.assign(chunksOf([60, 60, 60]), { destroy: () => void (destroyed = true) });
    const result = await readBodyWithLimit(stream, 100);
    expect(result.truncated).toBe(true);
    expect(destroyed).toBe(true);
    // only the first chunk (60 bytes, still <= 100) is kept; the chunk that
    // crossed the limit is discarded rather than partially included
    expect(result.body).toHaveLength(60);
  });
});
