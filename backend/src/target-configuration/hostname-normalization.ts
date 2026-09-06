import { extractHostname } from "../discovery/host-candidate-discovery";
import { probeProtocols, type HttpRequester, type ProtocolProbeResult } from "../discovery/protocol-prober";

export class InvalidHostnameError extends Error {
  constructor(public readonly input: string) {
    super(`"${input}" could not be normalized into a valid hostname`);
    this.name = "InvalidHostnameError";
  }
}

/**
 * DNS hostname normalization at audit-creation time (Section 16.2):
 * accepts scheme-less input ("api.example.com"), a full URL, or a bare
 * hostname with a trailing dot/mixed case — reuses the exact same
 * extraction Section 2's host-candidate discovery already relies on,
 * never a second, divergent implementation.
 */
export function normalizeHostname(input: string): string {
  const hostname = extractHostname(input);
  if (!hostname) throw new InvalidHostnameError(input);
  return hostname;
}

export interface NormalizeAndProbeResult {
  hostname: string;
  protocolProbe: ProtocolProbeResult;
}

/** Normalizes the Target DNS input, then tries HTTPS first and HTTP as a fallback — reusing Section 4's own `probeProtocols` rather than a separate, duplicated probing implementation. */
export async function normalizeAndProbeHostname(client: HttpRequester, input: string): Promise<NormalizeAndProbeResult> {
  const hostname = normalizeHostname(input);
  const protocolProbe = await probeProtocols(client, hostname);
  return { hostname, protocolProbe };
}
