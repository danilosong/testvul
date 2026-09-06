import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCurlCommand } from "./curl-parser";
import { operationFromManualRequest } from "./manual-operations";

describe("parseCurlCommand", () => {
  it("parses method, URL, and headers from a typical curl command", () => {
    const result = parseCurlCommand(
      'curl -X PATCH https://example.com/api/settings -H "Content-Type: application/json" -H "Authorization: Bearer abc123"',
    );
    expect(result.method).toBe("PATCH");
    expect(result.url).toBe("https://example.com/api/settings");
    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(result.headers["Authorization"]).toBe("Bearer abc123");
  });

  it("defaults to GET when no -X flag is given", () => {
    const result = parseCurlCommand("curl https://example.com/api/settings");
    expect(result.method).toBe("GET");
  });

  it("defaults to POST when -d is present but no explicit method is given, matching curl's own behavior", () => {
    const result = parseCurlCommand('curl https://example.com/api/settings -d \'{"quantity":5}\'');
    expect(result.method).toBe("POST");
    expect(result.body).toBe('{"quantity":5}');
  });

  it("parses a cookie flag into a Cookie header", () => {
    const result = parseCurlCommand("curl https://example.com/ -b 'session=abc123'");
    expect(result.headers["Cookie"]).toBe("session=abc123");
  });

  it("treats shell metacharacters in a data payload as inert text, never executing them", () => {
    const dangerous = "$(rm -rf /); `touch /tmp/pwned`; && echo owned";
    const result = parseCurlCommand(`curl -X POST https://example.com/api -d '${dangerous}'`);
    expect(result.body).toBe(dangerous);
    expect(result.method).toBe("POST");
  });

  it("treats a shell metacharacter in a header value as inert text", () => {
    const result = parseCurlCommand('curl https://example.com/ -H "X-Custom: $(whoami)"');
    expect(result.headers["X-Custom"]).toBe("$(whoami)");
  });

  it("this module never references any process-execution API", () => {
    // Deliberately specific (not a bare "exec"/"spawn" word match, which
    // would false-positive on the unrelated `RegExp.prototype.exec`) —
    // this checks for an actual shell/process-execution call site.
    const source = readFileSync(join(__dirname, "curl-parser.ts"), "utf8");
    expect(source).not.toMatch(/child_process|execSync|execFile|\bspawn\(|\beval\(/);
  });

  it("feeds directly into operationFromManualRequest to register a MANUAL DiscoveredOperation", () => {
    const parsed = parseCurlCommand('curl -X PUT https://example.com/api/project/123/settings -d \'{"x":1}\'');
    const operation = operationFromManualRequest({
      method: parsed.method,
      url: parsed.url,
      contentType: parsed.headers["Content-Type"],
      body: parsed.body,
    });
    expect(operation.source).toBe("MANUAL");
    expect(operation.confidence).toBe("HIGH");
    expect(operation.method).toBe("PUT");
  });
});
