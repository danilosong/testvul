import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TLS trust boundary (static checks)", () => {
  it("the production SecurityHttpClient source never references a TLS-bypass option", () => {
    const source = readFileSync(join(__dirname, "security-http-client.ts"), "utf8");
    // Require a colon (actual object-property usage), not just the bare
    // word — this file's own doc comments discuss why it's absent.
    expect(source).not.toMatch(/rejectUnauthorized\s*:/);
    expect(source).not.toMatch(/\bca\s*:/); // no CA-trust override in the production dispatcher
  });

  it("the build config excludes test-support (the only place a TLS-trust override may exist) from production output", () => {
    const tsconfig = JSON.parse(readFileSync(join(__dirname, "..", "..", "tsconfig.json"), "utf8"));
    expect(tsconfig.exclude.some((pattern: string) => pattern.includes("test-support"))).toBe(true);
  });
});
