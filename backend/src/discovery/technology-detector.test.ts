import { describe, expect, it } from "vitest";
import { detectTechnologies } from "./technology-detector";

describe("detectTechnologies", () => {
  it("detects nginx from the Server header and Next.js from HTML build artifacts, per the spec scenario", () => {
    const results = detectTechnologies({
      headers: { server: "nginx" },
      html: '<script src="/_next/static/chunks/main.js"></script>',
    });
    const names = results.map((r) => r.name);
    expect(names).toContain("nginx");
    expect(names).toContain("Next.js");
  });

  it("never produces anything shaped like a finding (no severity field, ever)", () => {
    const results = detectTechnologies({ headers: { server: "nginx" }, html: "" });
    for (const result of results) {
      expect(result).not.toHaveProperty("severity");
      expect(result).not.toHaveProperty("recommendation");
    }
  });

  it("detects Apache from the Server header", () => {
    const results = detectTechnologies({ headers: { server: "Apache/2.4.41 (Ubuntu)" }, html: "" });
    expect(results.map((r) => r.name)).toContain("Apache");
  });

  it("detects Cloudflare from either the Server header or the cf-ray header", () => {
    expect(detectTechnologies({ headers: { server: "cloudflare" }, html: "" }).map((r) => r.name)).toContain("Cloudflare");
    expect(detectTechnologies({ headers: { "cf-ray": "abc123" }, html: "" }).map((r) => r.name)).toContain("Cloudflare");
  });

  it("detects Express and NestJS from X-Powered-By", () => {
    expect(detectTechnologies({ headers: { "x-powered-by": "Express" }, html: "" }).map((r) => r.name)).toContain("Express");
    expect(detectTechnologies({ headers: { "x-powered-by": "NestJS" }, html: "" }).map((r) => r.name)).toContain("NestJS");
  });

  it("detects Vercel and AWS from their characteristic headers", () => {
    expect(detectTechnologies({ headers: { "x-vercel-id": "abc" }, html: "" }).map((r) => r.name)).toContain("Vercel");
    expect(detectTechnologies({ headers: { "x-amz-cf-id": "abc" }, html: "" }).map((r) => r.name)).toContain("AWS");
  });

  it("detects React, Vue, and Angular from HTML/script-URL signals", () => {
    expect(detectTechnologies({ headers: {}, html: '<div data-reactroot=""></div>' }).map((r) => r.name)).toContain("React");
    expect(detectTechnologies({ headers: {}, html: '<div data-v-1a2b3c></div>' }).map((r) => r.name)).toContain("Vue");
    expect(detectTechnologies({ headers: {}, html: '<html ng-version="15.0.0">' }).map((r) => r.name)).toContain("Angular");
  });

  it("detects a framework referenced only via a script URL, not inline HTML", () => {
    const results = detectTechnologies({ headers: {}, html: "<html></html>", scriptUrls: ["/static/js/react-vendor.js"] });
    expect(results.map((r) => r.name)).toContain("React");
  });

  it("returns an empty list when nothing matches any known signature", () => {
    expect(detectTechnologies({ headers: {}, html: "<html><body>plain</body></html>" })).toEqual([]);
  });
});
