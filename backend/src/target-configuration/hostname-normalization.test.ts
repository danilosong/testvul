import { describe, expect, it } from "vitest";
import type { HttpRequester } from "../discovery/protocol-prober";
import { InvalidHostnameError, normalizeAndProbeHostname, normalizeHostname } from "./hostname-normalization";

describe("normalizeHostname (Section 16.2)", () => {
  it("accepts scheme-less input, normalizing it to a bare hostname", () => {
    expect(normalizeHostname("api.example.com")).toBe("api.example.com");
  });

  it("accepts a full URL and extracts just the hostname", () => {
    expect(normalizeHostname("https://api.example.com/some/path")).toBe("api.example.com");
    expect(normalizeHostname("http://API.EXAMPLE.COM")).toBe("api.example.com");
  });

  it("strips a trailing dot", () => {
    expect(normalizeHostname("api.example.com.")).toBe("api.example.com");
  });

  it("rejects input that can't be normalized into any hostname at all", () => {
    expect(() => normalizeHostname("")).toThrow(InvalidHostnameError);
    expect(() => normalizeHostname("javascript:alert(1)")).toThrow(InvalidHostnameError);
  });
});

describe("normalizeAndProbeHostname (Section 16.2) — HTTPS is attempted first", () => {
  it("normalizes api.example.com correctly and probes HTTPS before HTTP", async () => {
    const callOrder: string[] = [];
    const client: HttpRequester = {
      request: async (url) => {
        callOrder.push(new URL(url).protocol);
        return { status: 200, headers: {} };
      },
    };

    const result = await normalizeAndProbeHostname(client, "api.example.com");

    expect(result.hostname).toBe("api.example.com");
    expect(callOrder[0]).toBe("https:");
    expect(callOrder).toContain("http:");
    expect(result.protocolProbe.primaryScheme).toBe("https");
  });

  it("falls back to HTTP as the primary scheme when HTTPS is unavailable", async () => {
    const client: HttpRequester = {
      request: async (url) => {
        if (new URL(url).protocol === "https:") throw new Error("connection refused");
        return { status: 200, headers: {} };
      },
    };

    const result = await normalizeAndProbeHostname(client, "plain.example.com");
    expect(result.protocolProbe.primaryScheme).toBe("http");
  });
});
