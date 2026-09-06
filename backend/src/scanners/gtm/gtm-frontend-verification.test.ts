import { describe, expect, it } from "vitest";
import { detectGtmFrontendReference } from "./gtm-frontend-verification";

describe("detectGtmFrontendReference", () => {
  it("extracts the correct id from a static script reference", () => {
    const html = `<html><head><script src="https://www.googletagmanager.com/gtm.js?id=GTM-REAL0001"></script></head></html>`;
    const result = detectGtmFrontendReference(html, false);
    expect(result).toEqual({ status: "STATIC_REFERENCE_FOUND", gtmId: "GTM-REAL0001" });
  });

  it("with no static reference and browser verification disabled, confirms FRONTEND_RUNTIME_NOT_VERIFIED rather than concluding not consumed", () => {
    const html = `<html><body>No analytics tag here.</body></html>`;
    const result = detectGtmFrontendReference(html, false);
    expect(result).toEqual({ status: "FRONTEND_RUNTIME_NOT_VERIFIED" });
  });

  it("with no static reference and browser verification available, defers as INCONCLUSIVE rather than FRONTEND_RUNTIME_NOT_VERIFIED", () => {
    const html = `<html><body>No analytics tag here.</body></html>`;
    const result = detectGtmFrontendReference(html, true);
    expect(result).toEqual({ status: "INCONCLUSIVE" });
  });

  it("decodes a URL-encoded id", () => {
    const html = `<script src="https://www.googletagmanager.com/gtm.js?id=GTM%2DENC0001"></script>`;
    const result = detectGtmFrontendReference(html, false);
    expect(result).toEqual({ status: "STATIC_REFERENCE_FOUND", gtmId: "GTM-ENC0001" });
  });
});
