import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "..");
const NEW_CONTEXT_CALL = /\.newContext\s*\(/;

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

// The single sanctioned call site — see browser-manager.ts's own doc
// comment on `createContext()` for why every other module must go
// through it instead of calling `browser.newContext()` itself.
const SANCTIONED_CALLERS = ["browser/browser-manager.ts"];

describe("browser context-creation boundary", () => {
  it("newContext() is called directly only from browser-manager.ts", () => {
    const callers = collectTsFiles(SRC_DIR)
      .filter((file) => NEW_CONTEXT_CALL.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));

    expect(callers.sort()).toEqual([...SANCTIONED_CALLERS].sort());
  });
});
