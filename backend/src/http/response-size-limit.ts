export interface ResponseSizeLimits {
  html: number;
  json: number;
  js: number;
  default: number;
}

export const DEFAULT_RESPONSE_SIZE_LIMITS: ResponseSizeLimits = {
  html: 5 * 1024 * 1024,
  json: 10 * 1024 * 1024,
  js: 10 * 1024 * 1024,
  default: 5 * 1024 * 1024,
};

export function limitForContentType(contentType: string | undefined, limits: ResponseSizeLimits): number {
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "text/html") return limits.html;
  if (mime === "application/json") return limits.json;
  if (mime === "application/javascript" || mime === "text/javascript") return limits.js;
  return limits.default;
}

export interface ReadBodyResult {
  body: string;
  receivedBytes: number;
  truncated: boolean;
}

/**
 * Reads an async byte stream up to `limitBytes` and aborts the underlying
 * stream the instant the limit is crossed — the rest of the response is
 * never downloaded, not merely discarded after the fact.
 */
export async function readBodyWithLimit(
  stream: AsyncIterable<Buffer> & { destroy?: (err?: Error) => void },
  limitBytes: number,
): Promise<ReadBodyResult> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let truncated = false;

  for await (const chunk of stream) {
    receivedBytes += chunk.length;
    if (receivedBytes > limitBytes) {
      truncated = true;
      stream.destroy?.();
      break;
    }
    chunks.push(chunk);
  }

  return { body: Buffer.concat(chunks).toString("utf8"), receivedBytes, truncated };
}
