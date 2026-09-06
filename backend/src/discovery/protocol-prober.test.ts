import { describe, expect, it } from "vitest";
import { probeProtocols, type HttpRequester } from "./protocol-prober";

function fakeRequester(handler: (url: string) => { status: number; headers?: Record<string, string> } | Error): HttpRequester {
  return {
    request: async (url: string) => {
      const result = handler(url);
      if (result instanceof Error) throw result;
      return { status: result.status, headers: result.headers ?? {} };
    },
  };
}

describe("probeProtocols", () => {
  it("uses HTTPS as primary when it is available, without needing HTTP to succeed", async () => {
    const client = fakeRequester((url) => (url.startsWith("https:") ? { status: 200 } : new Error("refused")));
    const result = await probeProtocols(client, "example.com");
    expect(result.httpsAvailable).toBe(true);
    expect(result.httpAvailable).toBe(false);
    expect(result.primaryScheme).toBe("https");
  });

  it("falls back to HTTP as primary when HTTPS is unavailable", async () => {
    const client = fakeRequester((url) => (url.startsWith("https:") ? new Error("refused") : { status: 200 }));
    const result = await probeProtocols(client, "example.com");
    expect(result.httpsAvailable).toBe(false);
    expect(result.httpAvailable).toBe(true);
    expect(result.primaryScheme).toBe("http");
  });

  it("reports HTTPS available and HTTP as a redirect to HTTPS", async () => {
    const client = fakeRequester((url) =>
      url.startsWith("https:")
        ? { status: 200 }
        : { status: 301, headers: { location: "https://example.com/" } },
    );
    const result = await probeProtocols(client, "example.com");
    expect(result.httpsAvailable).toBe(true);
    expect(result.httpAvailable).toBe(true);
    expect(result.httpRedirectsToHttps).toBe(true);
    expect(result.httpRedirectStatus).toBe(301);
  });

  it("does not mark httpRedirectsToHttps for a redirect that stays on HTTP", async () => {
    const client = fakeRequester((url) =>
      url.startsWith("https:")
        ? new Error("refused")
        : { status: 302, headers: { location: "http://example.com/other" } },
    );
    const result = await probeProtocols(client, "example.com");
    expect(result.httpRedirectsToHttps).toBe(false);
    expect(result.httpRedirectStatus).toBeNull();
  });

  it("reports both schemes unavailable without throwing", async () => {
    const client = fakeRequester(() => new Error("connection refused"));
    const result = await probeProtocols(client, "example.com");
    expect(result.httpsAvailable).toBe(false);
    expect(result.httpAvailable).toBe(false);
    expect(result.primaryScheme).toBe("http");
  });
});
