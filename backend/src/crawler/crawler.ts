import { ScopeViolationError } from "../scope";
import { canonicalizeCrawlUrl } from "./url-canonicalizer";

export interface CrawlerRequester {
  request(url: string, init?: { method?: string }): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>;
}

export interface CrawledPage {
  url: string;
  depth: number;
  status: number;
  html: string;
}

export interface CrawlerOptions {
  /** The only way this module reaches the network — always a `SecurityHttpClient` in real use. */
  client: CrawlerRequester;
  /** Pluggable so this module doesn't need its own HTML parser (Section 5.3 supplies the real one). */
  extractLinks: (html: string, baseUrl: string) => string[];
  /** Default 3. */
  maxDepth?: number;
  /** Default 500. */
  maxPages?: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** True if `maxPages` was reached with more links still queued. */
  truncated: boolean;
  /** A link the crawler discovered but never fetched because it fell outside the configured scope (Section 2's Scope Engine) — recorded, never tested, and never a reason to abort the rest of the crawl (Section 14.4). */
  outOfScopeSkipped: string[];
}

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PAGES = 500;

/**
 * Breadth-first crawl restricted to GET during the discovery phase — this
 * module has no method parameter a caller could set to anything else, so
 * it structurally cannot issue a mutating request.
 */
export async function crawl(startUrl: string, options: CrawlerOptions): Promise<CrawlResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: canonicalizeCrawlUrl(startUrl), depth: 0 }];
  const pages: CrawledPage[] = [];
  const outOfScopeSkipped: string[] = [];
  let truncated = false;

  while (queue.length > 0) {
    if (pages.length >= maxPages) {
      truncated = queue.some((item) => !visited.has(item.url));
      break;
    }

    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);

    let response;
    try {
      response = await options.client.request(item.url, { method: "GET" });
    } catch (err) {
      // Only a host *discovered during crawling* (depth > 0, i.e. reached
      // via a link) is ever silently skipped-and-recorded (Section 14.4).
      // The start URL itself being out of scope is the caller's own
      // configuration error and must still propagate as one.
      if (err instanceof ScopeViolationError && item.depth > 0) {
        outOfScopeSkipped.push(item.url);
        continue;
      }
      throw err;
    }
    pages.push({ url: item.url, depth: item.depth, status: response.status, html: response.body });

    if (item.depth < maxDepth) {
      for (const rawLink of options.extractLinks(response.body, item.url)) {
        const link = canonicalizeCrawlUrl(rawLink);
        if (!visited.has(link)) queue.push({ url: link, depth: item.depth + 1 });
      }
    }
  }

  return { pages, truncated, outOfScopeSkipped };
}
