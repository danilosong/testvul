import { canonicalizeUrl } from "./canonicalize";

/** Canonicalizes a bare hostname (as configured in scope, never a full URL)
 * the same way a real request target is canonicalized, so a scope entry
 * with a trailing dot or a Unicode/IDN form matches consistently. */
function canonicalizeHostname(hostname: string): string {
  return canonicalizeUrl(`https://${hostname}/`).hostname;
}

export class ScopeViolationError extends Error {
  constructor(public readonly url: string) {
    super(`URL not in authorized scope: ${url}`);
    this.name = "ScopeViolationError";
  }
}

/**
 * Exact-domain and wildcard (`*.example.com`) allow-list scope check.
 *
 * A wildcard entry matches only genuine subdomains of its base domain (it
 * requires a literal `.` boundary before the suffix), so it can never be
 * satisfied by a confusable host such as `evil-example.com` or
 * `example.com.evil.com` — nor does it match the bare apex domain itself,
 * which must be listed as its own exact entry if that's intended.
 */
export class ScopeValidator {
  private readonly exactHosts: Set<string>;
  private readonly wildcardSuffixes: string[];

  constructor(scopeEntries: readonly string[]) {
    this.exactHosts = new Set();
    this.wildcardSuffixes = [];
    for (const entry of scopeEntries) {
      const trimmed = entry.trim().toLowerCase();
      if (trimmed.startsWith("*.")) {
        this.wildcardSuffixes.push(canonicalizeHostname(trimmed.slice(2)));
      } else {
        this.exactHosts.add(canonicalizeHostname(trimmed));
      }
    }
  }

  isInScope(target: string | URL): boolean {
    let hostname: string;
    try {
      hostname = canonicalizeUrl(target).hostname;
    } catch {
      // Unparseable, or a non-http(s) scheme (file:/ftp:/gopher:/data:/javascript:
      // etc.) — never in scope, regardless of what the host portion says.
      return false;
    }
    if (this.exactHosts.has(hostname)) return true;
    return this.wildcardSuffixes.some((suffix) => hostname.endsWith(`.${suffix}`));
  }

  /**
   * Fail-closed mandatory pre-flight check: returns the canonicalized URL
   * if — and only if — it is explicitly in scope, and throws otherwise.
   * A URL that was never passed through this check (or through
   * `isInScope`) must never reach any outbound connection.
   */
  assertAllowed(target: string | URL): URL {
    // Scheme rejection (UnsupportedSchemeError) is left to propagate as-is
    // so callers can tell "not http(s)" apart from "not in scope."
    const canonical = canonicalizeUrl(target);
    if (!this.isInScope(canonical)) {
      throw new ScopeViolationError(canonical.toString());
    }
    return canonical;
  }
}
