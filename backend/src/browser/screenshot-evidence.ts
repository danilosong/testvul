import type { Page } from "playwright";

// These `page.evaluate()` callback bodies run inside the browser's own DOM
// context, never in this Node process — `document` isn't a real global
// here, so it's declared loosely (`any`) purely so this file can be
// type-checked without adding the "dom" lib to the whole backend project.
declare const document: any;

export interface ScreenshotEvidenceOptions {
  /** Never true by default — screenshot capture is opt-in (design.md Decision 44). */
  enabled: boolean;
  /** Operator-configured secret-shaped selectors, in addition to the built-in defaults (password inputs, known PII/token/API-key display areas). */
  redactSelectors?: string[];
  /** Test-support hook: invoked once the redaction overlay is installed, before the screenshot is taken. */
  onOverlayInstalled?: (page: Page) => Promise<void>;
}

export interface ScreenshotEvidenceResult {
  captured: boolean;
  imageBase64?: string;
  warning?: string;
}

const DEFAULT_REDACT_SELECTORS = ['input[type="password"]', "[data-pii]", "[data-token]", "[data-api-key]"];
const OVERLAY_ATTRIBUTE = "data-sca-redaction-overlay";

/**
 * Screenshot capture, disabled by default (design.md Decision 44). When
 * explicitly enabled, a temporary, non-destructive DOM overlay covers
 * every matched sensitive element — a positioned `<div>` layered on top,
 * never touching the element's own `.value`/attributes/state — installed
 * immediately before the screenshot and removed immediately afterward.
 * The returned evidence always carries the "may contain sensitive visual
 * information" warning a UI is meant to display alongside it.
 */
export async function captureScreenshotEvidence(page: Page, options: ScreenshotEvidenceOptions): Promise<ScreenshotEvidenceResult> {
  if (!options.enabled) {
    return { captured: false };
  }

  const selectors = [...DEFAULT_REDACT_SELECTORS, ...(options.redactSelectors ?? [])];
  const selectorList = selectors.join(",");

  await page.evaluate(
    ({ selectorList, overlayAttr }) => {
      document.querySelectorAll(selectorList).forEach((el: any) => {
        const overlay = document.createElement("div");
        overlay.setAttribute(overlayAttr, "true");
        const rect = el.getBoundingClientRect();
        overlay.style.position = "fixed";
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.background = "black";
        overlay.style.zIndex = "2147483647";
        document.body.appendChild(overlay);
      });
    },
    { selectorList, overlayAttr: OVERLAY_ATTRIBUTE },
  );

  if (options.onOverlayInstalled) await options.onOverlayInstalled(page);

  const buffer = await page.screenshot();

  await page.evaluate((overlayAttr) => {
    document.querySelectorAll(`[${overlayAttr}]`).forEach((el: any) => el.remove());
  }, OVERLAY_ATTRIBUTE);

  return {
    captured: true,
    imageBase64: buffer.toString("base64"),
    warning: "Screenshot may contain sensitive visual information",
  };
}

/**
 * Prefers sanitized structural DOM evidence over a screenshot whenever
 * it's already sufficient to support a finding — never capturing a
 * screenshot in that case, even when screenshot capture is enabled.
 */
export async function captureEvidenceForVerification(
  page: Page,
  options: ScreenshotEvidenceOptions & { structuralEvidenceSufficient: boolean },
): Promise<ScreenshotEvidenceResult> {
  if (options.structuralEvidenceSufficient) {
    return { captured: false };
  }
  return captureScreenshotEvidence(page, options);
}
