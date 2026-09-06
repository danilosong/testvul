import { request as undiciRequest, Agent, buildConnector, type Dispatcher } from "undici";
import { lookup as defaultDnsLookup } from "node:dns/promises";
import {
  ScopeValidator,
  ScopeViolationError,
  UnsupportedSchemeError,
  validateHop,
  stripSensitiveHeaders,
  REDIRECT_STATUSES,
} from "../scope";
import type { DnsLookupFn } from "../scope";
import { HostRateLimiter, type RateLimiter } from "./rate-limiter";
import {
  DEFAULT_RESPONSE_SIZE_LIMITS,
  limitForContentType,
  readBodyWithLimit,
  type ResponseSizeLimits,
} from "./response-size-limit";
import { HealthMonitor } from "./health-monitor";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_REDIRECTS = 10;

export class WriteTestsPausedError extends Error {
  constructor(public readonly host: string) {
    super(`Write-based tests are paused for ${host}: sustained server degradation detected`);
    this.name = "WriteTestsPausedError";
  }
}

export class TooManyRedirectsError extends Error {
  constructor(public readonly url: string) {
    super(`Exceeded maximum of ${MAX_REDIRECTS} redirects starting from ${url}`);
    this.name = "TooManyRedirectsError";
  }
}

export interface SecurityHttpEvent {
  type: "RESPONSE_SIZE_LIMIT_EXCEEDED";
  url: string;
  contentType: string | undefined;
  limitBytes: number;
  receivedBytes: number;
}

export class PrivateIpBlockedError extends Error {
  constructor(public readonly address: string) {
    super(`Blocked private/loopback/link-local IP address: ${address}`);
    this.name = "PrivateIpBlockedError";
  }
}

export interface SecurityHttpClientOptions {
  scopeValidator: ScopeValidator;
  allowPrivateNetworks?: boolean;
  rateLimiter?: RateLimiter;
  /** Injectable for tests (and this section's mock-DNS/rebinding tests); defaults to the real resolver. */
  dnsLookup?: DnsLookupFn;
  responseSizeLimits?: Partial<ResponseSizeLimits>;
  /** Called when a response is aborted for exceeding its size limit — the
   * caller is responsible for persisting this to the audit trail. */
  onEvent?: (event: SecurityHttpEvent) => void;
  healthMonitor?: HealthMonitor;
}

export interface SecurityHttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Hosts explicitly declared safe to keep receiving this request's
   * sensitive headers across an origin-changing redirect (the calling
   * Authentication Profile's `auth_profile_allowed_hosts` sharing list).
   * Without it, a cross-origin redirect always strips credentials. */
  credentialSharingAllowedHosts?: string[];
  /** Default true. Set false to get the raw first-hop response (including
   * a 3xx status and its Location header) instead of transparently
   * following it — needed by discovery code that must observe a redirect
   * rather than end up on its target. */
  followRedirects?: boolean;
}

export interface SecurityHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  truncated: boolean;
  /** URLs visited before this response, oldest first — empty if no redirect was followed. */
  redirectChain: string[];
  /** The URL this response actually came from (differs from the requested
   * URL whenever `redirectChain` is non-empty). */
  finalUrl: string;
}

/** A single hop's raw result, before `request()` attaches the accumulated
 * redirect-chain/finalUrl context only it knows across hops. */
type RawHopResponse = Omit<SecurityHttpResponse, "redirectChain" | "finalUrl">;

type HopOutcome = { kind: "redirect"; location: string; response: RawHopResponse } | { kind: "response"; response: RawHopResponse };

/**
 * The only module in this codebase allowed to import `undici` (enforced by
 * http/undici-single-importer.test.ts). Every outbound HTTP request —
 * discovery, crawling, scanners, everything — is required to go through
 * this class, which composes: scope validation → IP validation → rate
 * limiting → transport, in that fixed order, before any byte is sent, and
 * repeats that full chain — including fresh DNS resolution and address
 * pinning — on every redirect hop.
 */
export class SecurityHttpClient {
  private readonly scopeValidator: ScopeValidator;
  private readonly allowPrivateNetworks: boolean;
  private readonly rateLimiter: RateLimiter;
  private readonly dnsLookup: DnsLookupFn;
  private readonly responseSizeLimits: ResponseSizeLimits;
  private readonly onEvent: (event: SecurityHttpEvent) => void;
  private readonly healthMonitor: HealthMonitor;

  constructor(options: SecurityHttpClientOptions) {
    this.scopeValidator = options.scopeValidator;
    this.allowPrivateNetworks = !!options.allowPrivateNetworks;
    this.rateLimiter = options.rateLimiter ?? new HostRateLimiter();
    this.dnsLookup = options.dnsLookup ?? defaultDnsLookup;
    this.responseSizeLimits = { ...DEFAULT_RESPONSE_SIZE_LIMITS, ...options.responseSizeLimits };
    this.onEvent = options.onEvent ?? (() => {});
    this.healthMonitor = options.healthMonitor ?? new HealthMonitor();
  }

  async request(targetUrl: string, init: SecurityHttpRequestInit = {}): Promise<SecurityHttpResponse> {
    const method = (init.method ?? "GET").toUpperCase();
    const followRedirects = init.followRedirects ?? true;
    const allowedHosts = new Set((init.credentialSharingAllowedHosts ?? []).map((host) => host.toLowerCase()));
    let currentUrl = targetUrl;
    let previousOrigin: string | null = null;
    let headers: Record<string, string> = { ...(init.headers ?? {}) };
    const redirectChain: string[] = [];

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // 1. Scope validation + 2. IP validation — the mandatory fail-closed
      // gate, re-run in full on every hop, never skipped for a redirect.
      const validation = await validateHop(currentUrl, this.scopeValidator, this.allowPrivateNetworks, this.dnsLookup);
      if (!validation.ok) {
        if (validation.blocked === "UNSUPPORTED_SCHEME") {
          throw new UnsupportedSchemeError(new URL(validation.url).protocol);
        }
        if (validation.blocked === "OUT_OF_SCOPE") {
          throw new ScopeViolationError(validation.url);
        }
        throw new PrivateIpBlockedError(validation.address);
      }
      const { canonical, resolved } = validation;

      if (previousOrigin !== null && previousOrigin !== canonical.origin && !allowedHosts.has(canonical.hostname)) {
        headers = stripSensitiveHeaders(headers);
      }
      previousOrigin = canonical.origin;

      // 3. Rate limiting + 4. Transport, connecting to the address pinned
      // by this exact hop's validation above.
      const outcome = await this.rateLimiter.run(canonical.hostname, () =>
        this.performPinnedRequest(canonical, resolved, method, headers, init.body),
      );

      if (outcome.kind === "redirect" && followRedirects) {
        redirectChain.push(canonical.toString());
        currentUrl = outcome.location;
        continue;
      }
      return { ...outcome.response, redirectChain, finalUrl: canonical.toString() };
    }

    throw new TooManyRedirectsError(targetUrl);
  }

  private async performPinnedRequest(
    canonical: URL,
    resolved: { address: string; family: number },
    method: string,
    headers: Record<string, string>,
    requestBody: string | undefined,
  ): Promise<HopOutcome> {
    // A degraded host pauses write-based tests, but reads always continue —
    // a read is how the orchestrator notices the host has recovered.
    if (WRITE_METHODS.has(method) && this.healthMonitor.isDegraded(canonical.hostname)) {
      throw new WriteTestsPausedError(canonical.hostname);
    }

    const dispatcher = this.createDispatcher(resolved);
    try {
      const requestOptions: { method: Dispatcher.HttpMethod; headers?: Record<string, string>; body?: string; dispatcher: Dispatcher } = {
        method: method as Dispatcher.HttpMethod,
        dispatcher,
      };
      if (Object.keys(headers).length > 0) requestOptions.headers = headers;
      if (requestBody !== undefined) requestOptions.body = requestBody;

      const startedAt = Date.now();
      let response: Awaited<ReturnType<typeof undiciRequest>>;
      try {
        response = await undiciRequest(canonical, requestOptions);
      } catch (err) {
        this.healthMonitor.recordTimeout(canonical.hostname);
        throw err;
      }
      this.healthMonitor.recordResponse(canonical.hostname, response.statusCode, Date.now() - startedAt);

      const responseHeaders = response.headers as Record<string, string | string[] | undefined>;
      const contentType = Array.isArray(responseHeaders["content-type"])
        ? responseHeaders["content-type"][0]
        : responseHeaders["content-type"];
      const limitBytes = limitForContentType(contentType, this.responseSizeLimits);

      const { body, receivedBytes, truncated } = await readBodyWithLimit(response.body, limitBytes);
      if (truncated) {
        this.onEvent({ type: "RESPONSE_SIZE_LIMIT_EXCEEDED", url: canonical.toString(), contentType, limitBytes, receivedBytes });
      }

      const finalResponse: RawHopResponse = { status: response.statusCode, headers: responseHeaders, body, truncated };

      const location = responseHeaders.location;
      const locationStr = Array.isArray(location) ? location[0] : location;
      if (REDIRECT_STATUSES.has(response.statusCode) && locationStr) {
        return { kind: "redirect", location: new URL(locationStr, canonical).toString(), response: finalResponse };
      }

      return { kind: "response", response: finalResponse };
    } finally {
      await dispatcher.close();
    }
  }

  /**
   * Builds a dispatcher whose connector connects to exactly `pinnedAddress`
   * — never a fresh OS/DNS resolution — so the socket that actually opens
   * is provably the same address `validateHop` just validated. This is
   * what closes the DNS-rebinding/TOCTOU gap: without it, undici's default
   * connector would resolve the hostname again itself at connect time.
   *
   * Deliberately does not accept any TLS-trust override (no
   * `rejectUnauthorized`, no `ca`) — certificate validation is never
   * globally disabled in this, the production code path. A test that needs
   * to trust the local self-signed fixture certificate does so by
   * subclassing and overriding this method at build time (see
   * `test-support/fixture-trusted-http-client.ts`), never via a runtime
   * flag this class would have to expose.
   */
  protected createDispatcher(pinnedAddress: { address: string; family: number }): Dispatcher {
    const connector = buildConnector({
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
        else callback(null, pinnedAddress.address, pinnedAddress.family);
      },
    });
    return new Agent({ connect: connector });
  }
}
