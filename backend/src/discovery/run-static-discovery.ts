import { crawl, type CrawlerRequester } from "../crawler/crawler";
import { extractFromHtml } from "../crawler/html-extractor";
import type { DiscoveredResource } from "./attack-surface";

export interface RunStaticDiscoveryOptions {
  maxDepth?: number;
  maxPages?: number;
}

/**
 * Runs the crawler over `startUrl` and merges every page it fetched with
 * every link/form/script it extracted from them into one flat resource
 * list — the input `buildAttackSurface` needs.
 */
export async function runStaticDiscovery(
  client: CrawlerRequester,
  startUrl: string,
  options: RunStaticDiscoveryOptions = {},
): Promise<DiscoveredResource[]> {
  const { pages } = await crawl(startUrl, {
    client,
    extractLinks: (html, baseUrl) => extractFromHtml(html, baseUrl).links,
    ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
  });

  const resources: DiscoveredResource[] = [];
  const seenLinks = new Set<string>();

  for (const page of pages) {
    resources.push({ url: page.url, method: "GET", contentType: "text/html", isPage: true });

    const extracted = extractFromHtml(page.html, page.url);
    for (const link of extracted.links) {
      if (seenLinks.has(link)) continue;
      seenLinks.add(link);
      resources.push({ url: link, method: "GET" });
    }
    for (const script of extracted.scripts) {
      if (seenLinks.has(script)) continue;
      seenLinks.add(script);
      resources.push({ url: script, method: "GET", contentType: "application/javascript" });
    }
    for (const form of extracted.forms) {
      resources.push({ url: form.action, method: form.method, isForm: true });
    }
  }

  return resources;
}
