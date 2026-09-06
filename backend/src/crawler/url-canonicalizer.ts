/**
 * Canonicalizes a discovered URL for crawl-queue dedup purposes: lowercases
 * the host, strips the fragment (never sent to the server anyway), drops a
 * trailing slash from a non-root path, and sorts query parameters so two
 * URLs that differ only in parameter order are recognized as the same
 * resource.
 */
export function canonicalizeCrawlUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = "";

  const sortedParams = new URLSearchParams([...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)));
  parsed.search = sortedParams.toString();

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}
