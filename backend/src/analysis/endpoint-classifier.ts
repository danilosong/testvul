export type EndpointClassification =
  | "AUTH"
  | "CONFIGURATION"
  | "USER"
  | "PROJECT"
  | "CAMPAIGN"
  | "PAYMENT"
  | "PUBLIC"
  | "ADMIN"
  | "UNKNOWN";

export interface EndpointClassificationResult {
  classification: EndpointClassification;
  /** 1 = highest. Configuration-keyword paths always get 1, per the spec's
   * prioritization requirement, even when their classification category is
   * something else (e.g. PROJECT). */
  priority: 1 | 2 | 3;
}

/** The exact keyword list the spec names for configuration prioritization —
 * "project" and "campaign" are here even though they're also their own
 * classification categories below. */
const CONFIG_PRIORITY_KEYWORDS = ["settings", "config", "configuration", "preferences", "theme", "analytics", "project", "campaign"];

// Checked in this order — a path matching an earlier category is not
// reconsidered for a later one (e.g. "/project/123/settings" matches
// CONFIGURATION before it would match PROJECT).
const CATEGORY_KEYWORDS: Array<{ classification: EndpointClassification; keywords: string[] }> = [
  { classification: "CONFIGURATION", keywords: ["settings", "config", "configuration", "preferences", "theme", "analytics"] },
  { classification: "ADMIN", keywords: ["admin"] },
  { classification: "PAYMENT", keywords: ["payment", "billing", "invoice", "checkout", "subscription"] },
  { classification: "AUTH", keywords: ["login", "logout", "auth", "signin", "signup", "token", "session", "oauth"] },
  { classification: "PROJECT", keywords: ["project"] },
  { classification: "CAMPAIGN", keywords: ["campaign"] },
  { classification: "USER", keywords: ["user", "profile", "account", "/me"] },
  { classification: "PUBLIC", keywords: ["public", "about", "terms", "privacy", "contact", "home"] },
];

function pathContainsAny(path: string, keywords: string[]): boolean {
  const lower = path.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

/**
 * Classifies a discovered endpoint path into one of the fixed categories
 * and assigns it a priority — configuration-related paths (per the spec's
 * named keyword list) always get top priority regardless of their
 * classification category.
 */
export function classifyEndpoint(path: string): EndpointClassificationResult {
  const isRoot = path === "/" || path === "";
  const classification: EndpointClassification =
    (isRoot && "PUBLIC") || CATEGORY_KEYWORDS.find(({ keywords }) => pathContainsAny(path, keywords))?.classification || "UNKNOWN";

  const priority: 1 | 2 | 3 = pathContainsAny(path, CONFIG_PRIORITY_KEYWORDS)
    ? 1
    : classification === "UNKNOWN" || classification === "PUBLIC"
      ? 3
      : 2;

  return { classification, priority };
}
