export interface DiscoveredJsEndpoint {
  method: string;
  path: string;
}

const FETCH_CALL = /fetch\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([^}]*)\})?/g;
const AXIOS_CALL = /axios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;

function methodFromFetchOptions(optionsBlock: string | undefined): string {
  const match = optionsBlock?.match(/method\s*:\s*["'`](\w+)["'`]/i);
  return match ? match[1]!.toUpperCase() : "GET";
}

/**
 * Finds `fetch(...)`/`axios.<method>(...)` call sites in JavaScript source
 * text via regex only — the source is never parsed as a program or
 * executed. A concatenated path (`"/api/x/" + id`) yields only its static
 * literal prefix, which is the correct, honest result of text-only
 * analysis, not a bug to work around.
 */
export function discoverJsEndpoints(jsSource: string): DiscoveredJsEndpoint[] {
  const results: DiscoveredJsEndpoint[] = [];

  for (const match of jsSource.matchAll(FETCH_CALL)) {
    results.push({ path: match[1]!, method: methodFromFetchOptions(match[2]) });
  }
  for (const match of jsSource.matchAll(AXIOS_CALL)) {
    results.push({ method: match[1]!.toUpperCase(), path: match[2]! });
  }

  return results;
}
