import type { Db } from "../db/connection";
import { registerDiscoveredOperation } from "../operation-discovery/discovered-operations-repository";
import { sanitizeEvidence } from "../evidence/sanitize-evidence";
import { isInScope } from "./origin-scope-guard";
import type { ScopeValidator } from "../scope";
import type { ObservedRequest } from "./network-observer";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OBSERVABLE_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);

/**
 * Registers every observed mutating XHR/fetch/form-submission request as a
 * `BROWSER_RUNTIME`-sourced `DiscoveredOperation` at HIGH confidence
 * (Section 7.1's shared registration path — never a parallel insertion),
 * with its headers passed through the central Evidence Sanitization layer
 * (Section 9.10) first, so a credential the page attached (Authorization,
 * Cookie, an API key) is masked in what actually gets persisted, never the
 * raw value. Non-mutating (GET/HEAD) and non-navigational/XHR/fetch
 * observations (images, stylesheets, scripts, etc.) are not operations at
 * all and are skipped. An observation for a URL the Scope Engine would not
 * itself authorize (Section 12.11 — no implicit scope expansion just
 * because the browser's own navigation reached it) is skipped too, even
 * though the Controlled Egress Proxy already refused to actually connect
 * to it — the request-initiation event this reads from fires regardless
 * of whether the proxy ultimately allowed the connection.
 */
export function registerObservedMutations(
  db: Db,
  scanRunId: number,
  observations: readonly ObservedRequest[],
  scopeValidator: ScopeValidator,
): void {
  for (const observation of observations) {
    if (!MUTATING_METHODS.has(observation.method.toUpperCase())) continue;
    if (!OBSERVABLE_RESOURCE_TYPES.has(observation.resourceType)) continue;
    if (!isInScope(observation.url, scopeValidator)) continue;

    const sanitizedHeaders = sanitizeEvidence(observation.headers);
    registerDiscoveredOperation(db, scanRunId, {
      method: observation.method,
      url: observation.url,
      source: "BROWSER_RUNTIME",
      confidence: "HIGH",
      requestSchema: { headers: sanitizedHeaders },
    });
  }
}
