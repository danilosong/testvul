const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export class UnsupportedSchemeError extends Error {
  constructor(public readonly scheme: string) {
    super(`Unsupported scheme: ${scheme}`);
    this.name = "UnsupportedSchemeError";
  }
}

/**
 * Parses `input` via the WHATWG URL parser and returns a canonicalized
 * `URL`. The parser already lowercases the host, resolves userinfo
 * (`user@host`) to the real host, and converts IDN/Unicode hostnames to
 * their punycode form — this only adds what it does not already do:
 * stripping a trailing dot from the hostname, and rejecting any scheme
 * other than `http`/`https` before the caller can act on the result.
 */
export function canonicalizeUrl(input: string | URL): URL {
  const url = new URL(input.toString());
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new UnsupportedSchemeError(url.protocol);
  }
  if (url.hostname.endsWith(".")) {
    url.hostname = url.hostname.replace(/\.+$/, "");
  }
  return url;
}
