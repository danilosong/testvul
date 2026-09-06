import type { Page, Request } from "playwright";

export interface ObservedRequest {
  method: string;
  url: string;
  resourceType: string;
  headers: Record<string, string>;
}

/**
 * Records every request a page makes for the lifetime of the returned
 * stop function, including its headers — an *observation* duty only
 * (feeding `operation-discovery` and runtime verification), never a
 * connection-enforcement point (design.md Decision 34 — that is the
 * Controlled Egress Proxy's job).
 */
export function observeRequests(page: Page): { requests: ObservedRequest[]; stop: () => void } {
  const requests: ObservedRequest[] = [];
  // `headers()` (synchronous) rather than `allHeaders()` (async) — an
  // entry is recorded the instant Playwright fires the event, with no
  // ordering/timing race against whatever a caller does immediately
  // afterward.
  const onRequest = (req: Request): void => {
    requests.push({ method: req.method(), url: req.url(), resourceType: req.resourceType(), headers: req.headers() });
  };
  page.on("request", onRequest);
  return { requests, stop: () => page.off("request", onRequest) };
}
