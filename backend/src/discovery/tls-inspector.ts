import * as tls from "node:tls";
import { isIP } from "node:net";
import { validateHop, ScopeViolationError, UnsupportedSchemeError, type ScopeValidator, type DnsLookupFn } from "../scope";

export interface TlsCertificateInfo {
  hostname: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  subjectAltNames: string[];
}

const CONNECT_TIMEOUT_MS = 5000;

function parseSubjectAltNames(sanString: string | undefined): string[] {
  if (!sanString) return [];
  return sanString.split(",").map((entry) => entry.trim().replace(/^DNS:|^IP Address:/, ""));
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Opens a bare TLS handshake — no HTTP request, no data beyond what TLS
 * itself exchanges — to read the certificate the server presents. This is
 * purely passive certificate metadata collection for the report, so
 * `rejectUnauthorized` is deliberately off here: an expired, self-signed,
 * or otherwise untrusted certificate is exactly the kind of thing this
 * inspector needs to be able to read and report on, not refuse to look at.
 * This is unrelated to (and does not weaken) SecurityHttpClient's own TLS
 * validation (Section 3.7), which governs actual HTTP request traffic.
 *
 * Still goes through the mandatory scope/IP validation and address pinning
 * gate (`validateHop`) like every other outbound connection this codebase
 * makes.
 */
export async function inspectTlsCertificate(
  scopeValidator: ScopeValidator,
  allowPrivateNetworks: boolean,
  dnsLookup: DnsLookupFn,
  hostname: string,
  port = 443,
): Promise<TlsCertificateInfo> {
  const targetUrl = `https://${hostname}:${port}/`;
  const validation = await validateHop(targetUrl, scopeValidator, allowPrivateNetworks, dnsLookup);
  if (!validation.ok) {
    if (validation.blocked === "UNSUPPORTED_SCHEME") throw new UnsupportedSchemeError(new URL(validation.url).protocol);
    if (validation.blocked === "OUT_OF_SCOPE") throw new ScopeViolationError(validation.url);
    throw new Error(`Blocked private/loopback/link-local IP address: ${validation.address}`);
  }
  const { canonical, resolved } = validation;

  return new Promise((resolve, reject) => {
    const connectOptions: tls.ConnectionOptions = {
      host: resolved.address,
      port: Number(canonical.port) || port,
      rejectUnauthorized: false,
      timeout: CONNECT_TIMEOUT_MS,
    };
    // SNI's servername cannot itself be a literal IP address — only set it
    // when the target was actually given as a hostname.
    if (isIP(canonical.hostname) === 0) connectOptions.servername = canonical.hostname;

    const socket = tls.connect(connectOptions);

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || Object.keys(cert).length === 0) {
        reject(new Error(`No certificate presented by ${canonical.hostname}:${canonical.port || port}`));
        return;
      }
      resolve({
        hostname: firstValue(cert.subject?.CN),
        issuer: firstValue(cert.issuer?.CN),
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        subjectAltNames: parseSubjectAltNames(cert.subjectaltname),
      });
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${canonical.hostname}:${canonical.port || port} timed out`));
    });
  });
}
