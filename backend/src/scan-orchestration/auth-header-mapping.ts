import type { AuthMethod } from "../auth/auth-profile";

/**
 * Authentication Mapping (Section 14.2's pipeline stage): turns a
 * resolved `AuthProfile`'s method and decrypted credential into the
 * concrete headers `withAuthHeaders`/`ScanContext.authHeaders` need — the
 * one piece of glue between `auth-profiles` and every scanner's HTTP
 * calls that didn't exist yet (every prior scanner test built its own
 * `{Authorization: "Bearer ..."}` object by hand).
 */
export function buildAuthHeaders(method: AuthMethod, credential: string): Record<string, string> {
  switch (method) {
    case "BEARER":
      return { Authorization: `Bearer ${credential}` };
    case "API_KEY":
      return { "X-Api-Key": credential };
    case "COOKIE":
      // The operator-supplied credential is the full "name=value" cookie
      // pair — never assumed to be named "session" or any other fixed name.
      return { Cookie: credential };
    case "CUSTOM_HEADERS": {
      try {
        const parsed: unknown = JSON.parse(credential);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([name, value]) => [name, String(value)]));
        }
      } catch {
        // Malformed custom-header JSON — never guess a header shape from it.
      }
      return {};
    }
  }
}
