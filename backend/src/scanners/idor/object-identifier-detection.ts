export type IdentifierLocation = "PATH" | "QUERY" | "BODY";

export interface DetectedIdentifier {
  location: IdentifierLocation;
  /** The identifier's field/param name (BODY/QUERY) or inferred resource-type name (PATH). */
  name: string;
  value: string;
}

// PRD's own object-identifier list (userId, projectId, campaignId,
// tenantId, companyId, organizationId, orderId), plus the two other
// ownership/tenant-boundary names the rest of this codebase already keys
// on (ownerId, accountId).
const IDENTIFIER_KEYWORDS = [
  "userid",
  "ownerid",
  "tenantid",
  "organizationid",
  "companyid",
  "accountid",
  "projectid",
  "campaignid",
  "orderid",
];

// The corresponding singular resource-type stems, for inferring a name
// from a REST-style path segment pair (`/projects/123` → "projectId").
const RESOURCE_STEMS = ["user", "owner", "tenant", "organization", "company", "account", "project", "campaign", "order"];

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

function isIdentifierKeyword(name: string): boolean {
  const normalized = normalize(name);
  return IDENTIFIER_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/** Detects object identifiers positioned in the URL path (e.g. `/api/projects/123` → projectId=123), by pairing a known resource-type segment with the value segment immediately following it. */
export function detectPathIdentifiers(pathname: string): DetectedIdentifier[] {
  const segments = pathname.split("/").filter(Boolean);
  const results: DetectedIdentifier[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const stem = segments[i]!.toLowerCase().replace(/s$/, "");
    if (RESOURCE_STEMS.includes(stem)) {
      results.push({ location: "PATH", name: `${stem}Id`, value: segments[i + 1]! });
    }
  }
  return results;
}

/** Detects object identifiers passed as query-string parameters. */
export function detectQueryIdentifiers(url: string): DetectedIdentifier[] {
  const parsed = new URL(url);
  const results: DetectedIdentifier[] = [];
  for (const [name, value] of parsed.searchParams) {
    if (isIdentifierKeyword(name)) results.push({ location: "QUERY", name, value });
  }
  return results;
}

/** Recursively detects object identifiers in a JSON request/response body, reporting each one's dotted field path. */
export function detectBodyIdentifiers(body: unknown, pathPrefix = ""): DetectedIdentifier[] {
  const results: DetectedIdentifier[] = [];

  if (Array.isArray(body)) {
    body.forEach((item, index) => results.push(...detectBodyIdentifiers(item, `${pathPrefix}[${index}]`)));
    return results;
  }

  if (body !== null && typeof body === "object") {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (isIdentifierKeyword(key) && (typeof value === "string" || typeof value === "number")) {
        results.push({ location: "BODY", name: path, value: String(value) });
      }
      results.push(...detectBodyIdentifiers(value, path));
    }
  }

  return results;
}

/** Detects object identifiers across all three locations at once: URL path, query string, and JSON body. */
export function detectObjectIdentifiers(url: string, body?: unknown): DetectedIdentifier[] {
  const parsed = new URL(url);
  return [
    ...detectPathIdentifiers(parsed.pathname),
    ...detectQueryIdentifiers(url),
    ...(body !== undefined ? detectBodyIdentifiers(body) : []),
  ];
}
