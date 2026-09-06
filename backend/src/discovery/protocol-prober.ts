/** The minimal shape `probeProtocols` needs — satisfied by
 * `SecurityHttpClient` structurally, but declared separately so tests can
 * supply a lightweight fake instead of a full client instance. */
export interface HttpRequester {
  request(
    url: string,
    init?: { followRedirects?: boolean },
  ): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }>;
}

export interface ProtocolProbeResult {
  httpsAvailable: boolean;
  httpAvailable: boolean;
  /** True only if the HTTP endpoint answered with a redirect whose target is HTTPS. */
  httpRedirectsToHttps: boolean;
  httpRedirectStatus: number | null;
  /** Which scheme the rest of discovery (crawling, etc.) should use — HTTPS
   * whenever it's available, HTTP only as a fallback. */
  primaryScheme: "https" | "http";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Probes both schemes with a single non-following request each — HTTPS is
 * what the rest of discovery uses whenever it's reachable, but HTTP is
 * still checked once so the report can say whether it redirects to HTTPS,
 * per the HTTP/HTTPS Availability Reporting requirement.
 */
export async function probeProtocols(client: HttpRequester, hostname: string, path = "/"): Promise<ProtocolProbeResult> {
  let httpsAvailable: boolean;
  try {
    await client.request(`https://${hostname}${path}`, { followRedirects: false });
    httpsAvailable = true;
  } catch {
    httpsAvailable = false;
  }

  let httpAvailable = false;
  let httpRedirectsToHttps = false;
  let httpRedirectStatus: number | null = null;
  try {
    const response = await client.request(`http://${hostname}${path}`, { followRedirects: false });
    httpAvailable = true;
    if (response.status >= 300 && response.status < 400) {
      const location = firstHeaderValue(response.headers.location);
      if (location && new URL(location, `http://${hostname}${path}`).protocol === "https:") {
        httpRedirectsToHttps = true;
        httpRedirectStatus = response.status;
      }
    }
  } catch {
    httpAvailable = false;
  }

  return {
    httpsAvailable,
    httpAvailable,
    httpRedirectsToHttps,
    httpRedirectStatus,
    primaryScheme: httpsAvailable ? "https" : "http",
  };
}
