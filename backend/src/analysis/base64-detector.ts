export interface Base64PayloadInfo {
  isDataUri: true;
  mimeType: string | undefined;
  estimatedDecodedBytes: number;
  /** True once the decoded estimate crosses the large-payload threshold —
   * a memory/bandwidth/storage amplification risk, not a vulnerability by
   * itself. */
  isLargePayload: boolean;
}

/** 1 MB decoded — inline payloads at or above this size are flagged. */
export const LARGE_PAYLOAD_THRESHOLD_BYTES = 1024 * 1024;

const DATA_URI_PATTERN = /^data:([a-z0-9!#$&\-^_]+\/[a-z0-9!#$&\-^_.+]+)?(?:;[a-z-]+=[a-z0-9-]+)*;base64,([a-zA-Z0-9+/]+={0,2})$/i;

function estimateDecodedBase64Size(base64: string): number {
  const paddingMatch = base64.match(/=*$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Detects an inline `data:` URI (base64-encoded) in a field value and
 * estimates its decoded size — a passive computation over the string
 * already returned by the target, never a live decode-and-inspect of
 * untrusted binary content.
 */
export function detectBase64Payload(value: unknown): Base64PayloadInfo | null {
  if (typeof value !== "string") return null;
  const match = value.match(DATA_URI_PATTERN);
  if (!match) return null;

  const estimatedDecodedBytes = estimateDecodedBase64Size(match[2]!);
  return {
    isDataUri: true,
    mimeType: match[1],
    estimatedDecodedBytes,
    isLargePayload: estimatedDecodedBytes >= LARGE_PAYLOAD_THRESHOLD_BYTES,
  };
}
