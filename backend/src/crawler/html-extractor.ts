import * as cheerio from "cheerio";

export interface ExtractedForm {
  action: string;
  method: string;
  /** False when `method` was defaulted (no `method` attribute present) rather than explicitly declared. */
  hasExplicitMethod: boolean;
  inputNames: string[];
  enctype: string;
}

export interface HtmlExtractionResult {
  links: string[];
  forms: ExtractedForm[];
  scripts: string[];
  /** Links/scripts whose path looks like an API or JSON endpoint reference
   * (contains `/api/` or ends in `.json`) — a coarse hint for later, more
   * thorough API discovery (Section 5.4), not a claim of certainty. */
  jsonEndpoints: string[];
}

function looksLikeJsonEndpoint(url: string): boolean {
  return /\/api\//i.test(url) || /\.json(?:$|[?#])/i.test(url);
}

/** Resolves `raw` against `baseUrl` and returns it only if the result is a
 * fetchable http(s) URL — never `javascript:`, `data:`, `mailto:`, etc. */
function resolveHttpUrl(raw: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(raw, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Extracts links, forms, scripts, and JSON/API endpoint hints from a page's
 * HTML using Cheerio — parsing only, no script execution.
 */
export function extractFromHtml(html: string, baseUrl: string): HtmlExtractionResult {
  const $ = cheerio.load(html);

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const resolved = href && resolveHttpUrl(href, baseUrl);
    if (resolved) links.push(resolved);
  });

  const forms: ExtractedForm[] = [];
  $("form").each((_, el) => {
    const action = $(el).attr("action") ?? "";
    const methodAttr = $(el).attr("method");
    const resolved = resolveHttpUrl(action || ".", baseUrl);
    if (!resolved) return;
    const inputNames = $(el)
      .find("input[name], select[name], textarea[name]")
      .map((_i, input) => $(input).attr("name") ?? "")
      .get()
      .filter(Boolean);
    forms.push({
      action: resolved,
      method: (methodAttr ?? "GET").toUpperCase(),
      hasExplicitMethod: methodAttr !== undefined,
      inputNames,
      enctype: $(el).attr("enctype") ?? "application/x-www-form-urlencoded",
    });
  });

  const scripts: string[] = [];
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    const resolved = src && resolveHttpUrl(src, baseUrl);
    if (resolved) scripts.push(resolved);
  });

  const jsonEndpoints = [...links, ...scripts].filter(looksLikeJsonEndpoint);

  return { links, forms, scripts, jsonEndpoints };
}
