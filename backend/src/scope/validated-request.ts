import * as http from "node:http";
import * as https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { UnsupportedSchemeError } from "./canonicalize";
import { isBlockedIp } from "./ip-validator";
import { ScopeViolationError, type ScopeValidator } from "./scope-validator";

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key"]);
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Applied whenever a redirect crosses to a different origin than the
 * previous hop — shared by every transport, so the policy can never drift
 * between the raw-http path here and SecurityHttpClient's undici path. */
export function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(key.toLowerCase())) result[key] = value;
  }
  return result;
}

export type DnsLookupFn = (hostname: string) => Promise<{ address: string; family: number }>;

export type BlockReason = "UNSUPPORTED_SCHEME" | "OUT_OF_SCOPE" | "PRIVATE_IP";

export type HopValidation =
  | { ok: true; canonical: URL; resolved: { address: string; family: number } }
  | { ok: false; blocked: "UNSUPPORTED_SCHEME"; url: string }
  | { ok: false; blocked: "OUT_OF_SCOPE"; url: string }
  | { ok: false; blocked: "PRIVATE_IP"; url: string; address: string };

/**
 * The validation half of "the single issue-one-validated-request path"
 * (canonicalize → scheme-check → scope-check → resolve → IP-validate) —
 * shared by every transport (this module's raw http/https path and
 * SecurityHttpClient's undici path) so a hop can never skip a step
 * regardless of which transport ultimately connects.
 */
export async function validateHop(
  url: string,
  scopeValidator: ScopeValidator,
  allowPrivateNetworks: boolean,
  dnsLookup: DnsLookupFn,
): Promise<HopValidation> {
  let canonical: URL;
  try {
    canonical = scopeValidator.assertAllowed(url);
  } catch (err) {
    if (err instanceof UnsupportedSchemeError) return { ok: false, blocked: "UNSUPPORTED_SCHEME", url };
    const outUrl = err instanceof ScopeViolationError ? err.url : url;
    return { ok: false, blocked: "OUT_OF_SCOPE", url: outUrl };
  }

  const resolved = await dnsLookup(canonical.hostname);
  if (isBlockedIp(resolved.address, { allowPrivateNetworks })) {
    return { ok: false, blocked: "PRIVATE_IP", url: canonical.toString(), address: resolved.address };
  }

  return { ok: true, canonical, resolved };
}

export interface IssueValidatedRequestOptions {
  scopeValidator: ScopeValidator;
  allowPrivateNetworks?: boolean;
  headers?: Record<string, string>;
  maxRedirects?: number;
  /** Injectable for tests (and reused by Section 3.5's mock-DNS tests); defaults to the real resolver. */
  dnsLookup?: DnsLookupFn;
}

export type HopRecord = { url: string; status: number } | { url: string; blocked: BlockReason };

export interface ValidatedRequestResult {
  finalUrl: string;
  status: number | null;
  headers?: http.IncomingHttpHeaders;
  body?: string;
  hops: HopRecord[];
  blocked?: BlockReason;
}

function performRequest(
  url: URL,
  pinnedAddress: { address: string; family: number },
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        headers,
        // Connects to the exact address already validated above — never a
        // fresh OS resolution — so a rebind between validation and connect
        // cannot change which address the socket actually opens to.
        lookup: (_hostname: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) =>
          callback(null, pinnedAddress.address, pinnedAddress.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * The single request path every outbound call and every redirect hop runs
 * through, in the same order every time: canonicalize → scheme-check →
 * scope-check → resolve → IP-validate → pin → apply credential policy →
 * connect. A redirect response feeds its Location back into this exact
 * loop rather than being followed by separate logic, so a hop can never
 * skip a step the first request went through.
 */
export async function issueValidatedRequest(
  targetUrl: string,
  options: IssueValidatedRequestOptions,
): Promise<ValidatedRequestResult> {
  const maxRedirects = options.maxRedirects ?? 10;
  const resolve = options.dnsLookup ?? dnsLookup;
  const hops: HopRecord[] = [];

  let currentUrl = targetUrl;
  let previousOrigin: string | null = null;
  let headers: Record<string, string> = { ...(options.headers ?? {}) };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // The mandatory fail-closed pre-flight check — every hop must pass
    // through it, and nothing here ever calls the transport without it.
    const validation = await validateHop(currentUrl, options.scopeValidator, !!options.allowPrivateNetworks, resolve);
    if (!validation.ok) {
      hops.push({ url: validation.url, blocked: validation.blocked });
      return { finalUrl: validation.url, status: null, hops, blocked: validation.blocked };
    }
    const { canonical, resolved } = validation;

    if (previousOrigin !== null && previousOrigin !== canonical.origin) {
      headers = stripSensitiveHeaders(headers);
    }
    previousOrigin = canonical.origin;

    const response = await performRequest(canonical, resolved, headers);
    hops.push({ url: canonical.toString(), status: response.status });

    const location = response.headers.location;
    if (REDIRECT_STATUSES.has(response.status) && location) {
      currentUrl = new URL(location, canonical).toString();
      continue;
    }

    return { finalUrl: canonical.toString(), status: response.status, headers: response.headers, body: response.body, hops };
  }

  return { finalUrl: currentUrl, status: null, hops };
}
