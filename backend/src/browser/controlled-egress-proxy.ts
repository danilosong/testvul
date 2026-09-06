import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import type { LookupFunction } from "node:net";
import type { Duplex } from "node:stream";
import { lookup as defaultDnsLookup } from "node:dns/promises";
import { validateHop, type DnsLookupFn } from "../scope/validated-request";
import type { ScopeValidator } from "../scope";

export interface ControlledEgressProxyOptions {
  scopeValidator: ScopeValidator;
  allowPrivateNetworks?: boolean;
  /** Injectable for tests; defaults to the real resolver. */
  dnsLookup?: DnsLookupFn;
  /** Defaults to `127.0.0.1` (loopback-only). A container deployment (e.g. `deploy/browser-egress-strict/`) binds `0.0.0.0` so a sibling browser-worker container can reach it. */
  host?: string;
}

export interface ControlledEgressProxy {
  port: number;
  close(): Promise<void>;
}

/** A `dns.lookup`-compatible function (as `http.request`'s `lookup` option
 * expects) that always resolves to one fixed, already-validated address —
 * handling both call shapes Node's networking code may use: the classic
 * `(err, address, family)` callback, and the `{ all: true }` variant
 * Happy-Eyeballs dual-stack connection logic (default since Node 20)
 * requests, which wants `(err, [{ address, family }])` instead. */
function pinnedLookup(address: string, family: number): LookupFunction {
  return ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void): void => {
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (wantsAll) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  }) as LookupFunction;
}

function parseConnectTarget(target: string): { hostname: string; port: number } | null {
  const bracketed = /^\[([^\]]+)]:(\d+)$/.exec(target); // IPv6 literal, e.g. [::1]:443
  if (bracketed) return { hostname: bracketed[1]!, port: Number(bracketed[2]) };
  const plain = /^([^:]+):(\d+)$/.exec(target);
  if (!plain) return null;
  return { hostname: plain[1]!, port: Number(plain[2]) };
}

/**
 * The Controlled Egress Proxy (design.md Decision 34): a local
 * HTTP-CONNECT-capable forward proxy this codebase runs and controls. The
 * Browser Security Testing Engine configures every browser context to
 * route all HTTP/HTTPS traffic through it (Playwright's `proxy` launch
 * option — a browser-level setting Chromium itself honors for every
 * connection, unlike request-interception hooks which fire too late to
 * gate the connection itself). For every connection it is asked to relay
 * — a CONNECT tunnel (HTTPS) or a plain absolute-URI HTTP request — it
 * independently runs the exact same canonicalize → scheme → scope → DNS
 * resolution → IP validation pipeline (`validateHop`, shared with
 * `safe-http-client`) and only then opens the destination connection,
 * pinned to the address that pipeline just validated — never a second,
 * independent resolution at connect time.
 */
export async function startControlledEgressProxy(options: ControlledEgressProxyOptions): Promise<ControlledEgressProxy> {
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const allowPrivateNetworks = !!options.allowPrivateNetworks;
  const scopeValidator = options.scopeValidator;

  const server = http.createServer((req, res) => {
    handlePlainHttpProxyRequest(req, res, scopeValidator, allowPrivateNetworks, dnsLookup).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });

  server.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket, head, scopeValidator, allowPrivateNetworks, dnsLookup).catch(() => {
      clientSocket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, options.host ?? "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function handleConnect(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  scopeValidator: ScopeValidator,
  allowPrivateNetworks: boolean,
  dnsLookup: DnsLookupFn,
): Promise<void> {
  const target = req.url ? parseConnectTarget(req.url) : null;
  if (!target) {
    clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  // CONNECT tunnels have no scheme of their own — represented as an
  // https:// URL purely so the shared canonicalize/scope/scheme/DNS/IP
  // pipeline (which expects a URL) can run against it unchanged.
  const pseudoUrl = `https://${target.hostname}:${target.port}/`;
  const validation = await validateHop(pseudoUrl, scopeValidator, allowPrivateNetworks, dnsLookup);
  if (!validation.ok) {
    clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }

  // Connects to the exact address `validateHop` just validated — never a
  // fresh resolution of the hostname — which is what closes the
  // DNS-rebinding/TOCTOU window: there is no second lookup a rebind could win.
  const destSocket = net.connect({ host: validation.resolved.address, port: target.port }, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) destSocket.write(head);
    destSocket.pipe(clientSocket);
    clientSocket.pipe(destSocket);
  });
  destSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => destSocket.destroy());
}

async function handlePlainHttpProxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  scopeValidator: ScopeValidator,
  allowPrivateNetworks: boolean,
  dnsLookup: DnsLookupFn,
): Promise<void> {
  const targetUrl = req.url ?? "";
  if (!/^https?:\/\//i.test(targetUrl)) {
    res.writeHead(400);
    res.end();
    return;
  }

  const validation = await validateHop(targetUrl, scopeValidator, allowPrivateNetworks, dnsLookup);
  if (!validation.ok) {
    res.writeHead(403);
    res.end();
    return;
  }

  const { canonical, resolved } = validation;
  const transport = canonical.protocol === "https:" ? https : http;

  const proxyReq = transport.request(
    {
      protocol: canonical.protocol,
      hostname: canonical.hostname,
      port: canonical.port || (canonical.protocol === "https:" ? 443 : 80),
      path: canonical.pathname + canonical.search,
      method: req.method,
      headers: req.headers,
      // Pinned to the already-validated address — see the identical comment
      // in handleConnect. Handles both the classic single-address `dns.lookup`
      // callback shape and the `{ all: true }` shape Node's Happy-Eyeballs
      // dual-stack connection logic (the default since Node 20) requests.
      lookup: pinnedLookup(resolved.address, resolved.family),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(proxyReq);
}
