import type { SecurityHttpResponse } from "../http/security-http-client";

export interface HttpDiscoverer {
  request(url: string): Promise<SecurityHttpResponse>;
}

export interface HttpDiscoveryResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  cookies: string[];
  contentType: string | undefined;
  server: string | undefined;
  redirectChain: string[];
  finalUrl: string;
  htmlBody: string;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `GET` the target and collect everything the report needs from the root
 * response: status, headers, cookies, content-type, server info, the
 * redirect chain actually followed, and the HTML body for further
 * analysis by later discovery stages. */
export async function discoverRoot(client: HttpDiscoverer, url: string): Promise<HttpDiscoveryResult> {
  const response = await client.request(url);
  const setCookie = response.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  return {
    status: response.status,
    headers: response.headers,
    cookies,
    contentType: firstHeaderValue(response.headers["content-type"]),
    server: firstHeaderValue(response.headers["server"]),
    redirectChain: response.redirectChain,
    finalUrl: response.finalUrl,
    htmlBody: response.body,
  };
}
