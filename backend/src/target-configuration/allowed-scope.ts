export interface AllowedScopeOptions {
  /** "Include authorized subdomains" — expands the default to the wildcard equivalent, alongside the exact Target DNS itself (a wildcard alone never covers the apex host — Section 2's ScopeValidator never matches `*.example.com` against `example.com`). */
  includeSubdomains?: boolean;
  /** "Advanced Scope" — an explicit, operator-supplied multi-host/wildcard list that overrides both the simplified default and the subdomain checkbox entirely. */
  advancedScope?: string[];
}

/**
 * The simplified DNS-only Allowed Scope default (Section 16.3): Allowed
 * Scope defaults to exactly the Target DNS value — never a wildcard, and
 * never any other host — unless the operator explicitly asks for more.
 */
export function computeAllowedScope(targetDns: string, options: AllowedScopeOptions = {}): string[] {
  if (options.advancedScope !== undefined) return options.advancedScope;
  if (options.includeSubdomains) return [targetDns, `*.${targetDns}`];
  return [targetDns];
}
