import { describe, expect, it } from "vitest";
import { generateXssCanary, classifyStoredXss } from "./xss-canary";

describe("generateXssCanary", () => {
  it("produces a non-executing <strong> marker with a matching attribute and text content", () => {
    const canary = generateXssCanary();
    expect(canary.payload).toBe(`<strong data-security-test="${canary.uuid}">SECURITY_TEST_${canary.uuid}</strong>`);
    expect(canary.payload).not.toMatch(/<script|on\w+\s*=|javascript:/i);
  });

  it("produces a fresh UUID each time", () => {
    const a = generateXssCanary();
    const b = generateXssCanary();
    expect(a.uuid).not.toBe(b.uuid);
  });
});

describe("classifyStoredXss", () => {
  it("classifies RAW_HTML when the canary is stored byte-for-byte unchanged", () => {
    const { uuid, payload } = generateXssCanary();
    expect(classifyStoredXss(payload, uuid)).toBe("RAW_HTML");
  });

  it("classifies ESCAPED when the canary's markup is HTML-entity-encoded", () => {
    const { uuid, payload } = generateXssCanary();
    const escaped = payload.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    expect(classifyStoredXss(escaped, uuid)).toBe("ESCAPED");
  });

  it("classifies HTML_ALLOWED when the tag survives but the attribute was stripped by an allowlist", () => {
    const { uuid } = generateXssCanary();
    expect(classifyStoredXss(`<strong>SECURITY_TEST_${uuid}</strong>`, uuid)).toBe("HTML_ALLOWED");
  });

  it("classifies REMOVED when the canary text doesn't survive at all", () => {
    const { uuid } = generateXssCanary();
    expect(classifyStoredXss("", uuid)).toBe("REMOVED");
  });
});
