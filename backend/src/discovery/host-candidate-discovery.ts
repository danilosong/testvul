import { canonicalizeUrl, type ScopeValidator } from "../scope";

export type HostDiscoverySource = "REDIRECT" | "LINK" | "SCRIPT" | "CNAME" | "TLS_SAN" | "BROWSER";

export interface HostCandidate {
  hostname: string;
  source: HostDiscoverySource;
  inScope: boolean;
  /** Only ever true when `inScope` is true — a candidate is never queued
   * for discovery/testing on the strength of its source alone. */
  queued: boolean;
}

export interface HostCandidateInputs {
  /** Redirect `Location` header values (full URLs). */
  redirectLocations?: string[];
  /** Absolute `<a href>` URLs. */
  absoluteAnchors?: string[];
  /** Script/API reference URLs. */
  scriptOrApiUrls?: string[];
  /** Bare hostnames from a CNAME chain. */
  cnameRecords?: string[];
  /** Bare hostnames from a TLS certificate's Subject Alternative Names. */
  tlsSans?: string[];
  /** Absolute URLs found only via Section 12's real browser-runtime navigation (e.g. an SPA-rendered link a static HTML fetch would never see) — never merged into `absoluteAnchors`, so its distinct discovery mechanism stays visible in `discovered_hosts`. */
  browserDiscoveredLinks?: string[];
}

/** Extracts a hostname via the same canonicalization used everywhere else
 * (case-folding, trailing-dot stripping, IDN/punycode) — never raw string
 * handling — whether given a full URL or a bare hostname (CNAME/SAN data). */
function extractHostname(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const asUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}/`;
  try {
    return canonicalizeUrl(asUrl).hostname;
  } catch {
    return null;
  }
}

const SOURCE_ORDER: Array<[HostDiscoverySource, keyof HostCandidateInputs]> = [
  ["REDIRECT", "redirectLocations"],
  ["LINK", "absoluteAnchors"],
  ["SCRIPT", "scriptOrApiUrls"],
  ["CNAME", "cnameRecords"],
  ["TLS_SAN", "tlsSans"],
  ["BROWSER", "browserDiscoveredLinks"],
];

/**
 * Consolidates every hostname reference this codebase is allowed to learn
 * about (redirects, absolute links, script/API URLs, CNAME records, TLS
 * SANs — explicitly never subdomain brute forcing) into one candidate per
 * hostname, canonicalized and scope-checked. A TLS SAN or any other source
 * never implies scope by itself: `inScope` is always the result of an
 * actual `ScopeValidator` check, and `queued` never diverges from it.
 */
export function consolidateHostCandidates(scopeValidator: ScopeValidator, inputs: HostCandidateInputs): HostCandidate[] {
  const seen = new Map<string, HostCandidate>();

  for (const [source, key] of SOURCE_ORDER) {
    for (const raw of inputs[key] ?? []) {
      const hostname = extractHostname(raw);
      if (!hostname || seen.has(hostname)) continue;
      const inScope = scopeValidator.isInScope(`https://${hostname}/`);
      seen.set(hostname, { hostname, source, inScope, queued: inScope });
    }
  }

  return [...seen.values()];
}
