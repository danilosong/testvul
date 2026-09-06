import type { ParsedCurlRequest } from "../operation-discovery/curl-parser";
import type { AuthProfileInput } from "./auth-profile";

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/**
 * Builds an Authentication Profile from an already-parsed cURL/raw-HTTP
 * request — this function only ever reads the structured `ParsedCurlRequest`
 * object; it never re-touches the original text or an interpreter of any
 * kind. Whichever credential shape the request actually carries determines
 * the resulting profile's method.
 */
export function authProfileFromCurl(parsed: ParsedCurlRequest, name: string): AuthProfileInput {
  const authorization = findHeader(parsed.headers, "authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return { name, method: "BEARER", credential: authorization.slice("bearer ".length).trim() };
  }

  if (parsed.cookies) {
    return { name, method: "COOKIE", credential: parsed.cookies };
  }

  const apiKey = findHeader(parsed.headers, "x-api-key");
  if (apiKey) {
    return { name, method: "API_KEY", credential: apiKey };
  }

  if (Object.keys(parsed.headers).length > 0) {
    return { name, method: "CUSTOM_HEADERS", credential: JSON.stringify(parsed.headers) };
  }

  return { name, method: "BEARER" };
}
