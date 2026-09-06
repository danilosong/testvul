import { createHash } from "node:crypto";

export interface TruncationResult {
  value: string;
  truncated: boolean;
  originalSize?: number;
  contentHash?: string;
}

/**
 * A body within `maxBytes` (measured in UTF-8 bytes, not characters) is
 * returned unchanged. A larger body is returned as a `maxBytes`-length
 * prefix, alongside the original size and a SHA-256 hash of the full
 * original content — enough to prove what was persisted corresponds to a
 * specific real response without storing all of it.
 */
export function truncateIfOversized(body: string, maxBytes: number): TruncationResult {
  const byteLength = Buffer.byteLength(body, "utf8");
  if (byteLength <= maxBytes) {
    return { value: body, truncated: false };
  }

  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  const prefix = Buffer.from(body, "utf8").subarray(0, maxBytes).toString("utf8");
  return { value: prefix, truncated: true, originalSize: byteLength, contentHash };
}
