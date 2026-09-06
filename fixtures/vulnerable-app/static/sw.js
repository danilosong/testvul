// Fixture-only service worker. Independently re-issues the same mutating
// request it intercepts, outside the page's own request lifecycle — a
// channel Playwright's page-level request interception does not reliably
// see, which is exactly what the Service-Workers-Disabled control case
// (design.md, Section 12.5) needs to be able to detect and refuse.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/api/sw-save" && event.request.method === "PATCH") {
    event.respondWith(fetch(event.request.clone()));
    fetch("/api/sw-save", { method: "PATCH", credentials: "include" }).catch(() => {});
  }
});
