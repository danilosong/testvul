import { describe, expect, it } from "vitest";
import { extractFromHtml } from "./html-extractor";

describe("extractFromHtml", () => {
  it("extracts links, forms, and scripts, per the spec scenario", () => {
    const html = `
      <html><body>
        <a href="/terms">Terms</a>
        <a href="/login">Login</a>
        <script src="/assets/app.js"></script>
      </body></html>
    `;
    const result = extractFromHtml(html, "http://example.com/");
    expect(result.links).toEqual(["http://example.com/terms", "http://example.com/login"]);
    expect(result.scripts).toEqual(["http://example.com/assets/app.js"]);
  });

  it("extracts a form's action, method, input names, and enctype", () => {
    const html = `<form action="/api/projects/1" method="post"><input name="notes" /></form>`;
    const result = extractFromHtml(html, "http://example.com/");
    expect(result.forms).toEqual([
      {
        action: "http://example.com/api/projects/1",
        method: "POST",
        hasExplicitMethod: true,
        inputNames: ["notes"],
        enctype: "application/x-www-form-urlencoded",
      },
    ]);
  });

  it("defaults a form with no method attribute to GET and marks it as not explicit", () => {
    const html = `<form action="/search"></form>`;
    const result = extractFromHtml(html, "http://example.com/");
    expect(result.forms[0]?.method).toBe("GET");
    expect(result.forms[0]?.hasExplicitMethod).toBe(false);
  });

  it("captures a form's explicit enctype and multiple input names", () => {
    const html = `<form action="/upload" method="post" enctype="multipart/form-data"><input name="file" /><input name="caption" /></form>`;
    const result = extractFromHtml(html, "http://example.com/");
    expect(result.forms[0]?.enctype).toBe("multipart/form-data");
    expect(result.forms[0]?.inputNames).toEqual(["file", "caption"]);
  });

  it("resolves relative URLs against the base URL", () => {
    const html = `<a href="page2">Next</a>`;
    const result = extractFromHtml(html, "http://example.com/section/index.html");
    expect(result.links).toEqual(["http://example.com/section/page2"]);
  });

  it("flags links/scripts that look like API or JSON endpoints", () => {
    const html = `<a href="/api/openapi.json">Docs</a><a href="/about">About</a>`;
    const result = extractFromHtml(html, "http://example.com/");
    expect(result.jsonEndpoints).toEqual(["http://example.com/api/openapi.json"]);
  });

  it("skips an unparseable href instead of throwing", () => {
    const html = `<a href="javascript:void(0)">click</a><a href="/ok">ok</a>`;
    const result = extractFromHtml(html, "http://example.com/");
    expect(result.links).toEqual(["http://example.com/ok"]);
  });

  it("never executes any script content — this is parsing only", () => {
    const html = `<script>window.__PWNED__ = true;</script>`;
    expect(() => extractFromHtml(html, "http://example.com/")).not.toThrow();
    expect((globalThis as Record<string, unknown>)["__PWNED__"]).toBeUndefined();
  });
});
