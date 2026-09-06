import type { BrowserContext, Page } from "playwright";

export interface NavigationResult {
  page: Page;
  url: string;
  status: number | null;
}

/**
 * Navigates a page to a URL and waits for the network to settle
 * (`networkidle`) — not just the initial document response — so
 * client-side/SPA rendering (route generation, API calls a page fires
 * after hydration) has had a chance to happen before anything downstream
 * inspects the page.
 */
export async function waitForHydratedNavigation(page: Page, url: string): Promise<NavigationResult> {
  const response = await page.goto(url, { waitUntil: "networkidle" });
  return { page, url, status: response?.status() ?? null };
}

/** Convenience wrapper that also creates the page — for a caller that doesn't need to attach listeners (e.g. a network observer) before navigation starts. The caller owns closing the returned page. */
export async function navigateAndWaitForHydration(context: BrowserContext, url: string): Promise<NavigationResult> {
  const page = await context.newPage();
  return waitForHydratedNavigation(page, url);
}
