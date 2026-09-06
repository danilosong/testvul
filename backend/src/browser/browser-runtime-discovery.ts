import type { BrowserContext } from "playwright";
import { waitForHydratedNavigation } from "./navigation-engine";
import { observeRequests, type ObservedRequest } from "./network-observer";
import type { DiscoveredResource } from "../discovery/attack-surface";

export interface DiscoveredButton {
  selector: string;
  label: string;
}

export interface BrowserRuntimeDiscoveryResult {
  url: string;
  status: number | null;
  /** Anchor hrefs present in the DOM once the page (and any client-side rendering) has settled — including links a plain static fetch of the initial HTML would never show, e.g. an SPA generating them after fetching its own data. */
  links: string[];
  /** Buttons discovered in the settled DOM — raw material for Section 12.14's Action Discovery, not yet classified here. */
  buttons: DiscoveredButton[];
  /** Anchors carrying a `download` attribute — raw material for Section 12.17's Download Actions discovery. */
  downloadLinks: DiscoveredButton[];
  /** `input[type=file]` elements — raw material for Section 12.18's Upload Surfaces discovery. */
  uploadSurfaces: DiscoveredButton[];
  inputNames: string[];
  /** Every fetch/XHR request observed during navigation and hydration — the runtime-only API calls a static analysis of the initial HTML alone would miss entirely. */
  apiCalls: ObservedRequest[];
}

/**
 * Real browser navigation and runtime discovery (Section 12.7): navigates
 * to a URL, waits for the page (SPA client-side rendering included) to
 * settle, and extracts links/buttons/inputs plus every runtime API call
 * observed along the way — never relying solely on the first `GET /`'s
 * static HTML, which a React/Vue/Angular/Next.js (or any client-hydrated)
 * app can leave nearly empty until its own JS runs.
 */
export async function discoverRuntimeSurface(context: BrowserContext, url: string): Promise<BrowserRuntimeDiscoveryResult> {
  const page = await context.newPage();
  // Attached *before* navigating — a request observer attached only after
  // `page.goto()` resolves would miss every request the navigation itself
  // (and any hydration work already finished by then) already made.
  const observer = observeRequests(page);
  const { status } = await waitForHydratedNavigation(page, url);

  // A settled first load may still trigger further async rendering (e.g.
  // this fixture's own fetch-then-render loadProjects()); give it a brief
  // window before reading the DOM.
  await page.waitForTimeout(300);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links: string[] = await page.$$eval("a[href]", (anchors: any[]) => anchors.map((a) => a.href));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buttons: DiscoveredButton[] = await page.$$eval("button", (elements: any[]) =>
    elements.map((b) => ({
      selector: b.id ? `#${b.id}` : b.className ? `.${String(b.className).trim().split(/\s+/)[0]}` : "button",
      label: (b.textContent ?? "").trim(),
    })),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const downloadLinks: DiscoveredButton[] = await page.$$eval("a[download]", (anchors: any[]) =>
    anchors.map((a) => ({
      selector: a.id ? `#${a.id}` : `a[href="${a.getAttribute("href")}"]`,
      label: (a.textContent ?? "").trim(),
    })),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadSurfaces: DiscoveredButton[] = await page.$$eval('input[type="file"]', (inputs: any[]) =>
    inputs.map((i) => ({
      selector: i.id ? `#${i.id}` : i.name ? `input[name="${i.name}"]` : 'input[type="file"]',
      label: i.name || i.id || "file upload",
    })),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputNames: string[] = await page.$$eval("input,select,textarea", (fields: any[]) =>
    fields.map((f) => f.name).filter(Boolean),
  );

  observer.stop();
  await page.close();

  return { url, status, links, buttons, downloadLinks, uploadSurfaces, inputNames, apiCalls: observer.requests };
}

/**
 * Converts a browser-runtime discovery result into the same
 * `DiscoveredResource` shape static discovery (Section 5.9's
 * `attack-surface`) already produces — never a parallel/separate
 * resource type — so runtime-only findings (an SPA's post-hydration API
 * calls and generated links) merge into the identical Unified Attack
 * Surface `buildAttackSurface()` builds from, by simply concatenating
 * both resource arrays before calling it.
 */
export function toDiscoveredResources(result: BrowserRuntimeDiscoveryResult): DiscoveredResource[] {
  const resources: DiscoveredResource[] = [{ url: result.url, method: "GET", isPage: true }];
  for (const href of result.links) {
    resources.push({ url: href, method: "GET" });
  }
  for (const call of result.apiCalls) {
    resources.push({ url: call.url, method: call.method });
  }
  return resources;
}
