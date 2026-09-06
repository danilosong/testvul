import type { Page } from "playwright";

export type DomInspectionResult = "MARKER_ABSENT" | "MARKER_TEXT_ONLY" | "MARKER_RENDERED_AS_HTML";

export interface DomVerificationParams {
  /** An already-navigated, already-hydrated page. */
  page: Page;
  containerSelector: string;
  uuid: string;
}

/**
 * DOM-Based Stored XSS Verification (Section 12.24): inspects the
 * rendered DOM — after hydration — for a previously-inserted canary
 * marker via static structural inspection only. Querying for a real DOM
 * *element* carrying the marker's `data-security-test` attribute (via
 * Playwright's element-query API) proves the browser's HTML parser
 * actually turned the stored string into markup — i.e. the sink is a raw
 * HTML sink like `innerHTML` — as opposed to the marker merely surviving
 * as literal, inert text content. Nothing the marker could contain is
 * ever executed or evaluated; this only ever reads DOM structure/text.
 */
export async function inspectDomForCanary(params: DomVerificationParams): Promise<DomInspectionResult> {
  const container = await params.page.$(params.containerSelector);
  if (!container) return "MARKER_ABSENT";

  const markerElement = await container.$(`[data-security-test="${params.uuid}"]`);
  if (markerElement) return "MARKER_RENDERED_AS_HTML";

  const textContent = (await container.textContent()) ?? "";
  if (textContent.includes(`SECURITY_TEST_${params.uuid}`)) return "MARKER_TEXT_ONLY";

  return "MARKER_ABSENT";
}
