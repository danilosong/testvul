import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "..");
const UNDICI_IMPORT = /from\s+["']undici["']|require\(\s*["']undici["']\s*\)/;

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

// The production entry point, plus the one build-excluded (see
// tsconfig.json) test-support subclass that builds its own TLS-trusting
// dispatcher for the local fixture certificate (Section 3.7).
const SANCTIONED_IMPORTERS = ["http/security-http-client.ts", "http/test-support/fixture-trusted-http-client.ts"];

describe("undici import boundary", () => {
  it("is imported directly only by the sanctioned production and test-support modules", () => {
    const importers = collectTsFiles(SRC_DIR)
      .filter((file) => UNDICI_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));

    expect(importers.sort()).toEqual([...SANCTIONED_IMPORTERS].sort());
  });
});
