import { describe, expect, it } from "vitest";
import { discoverRoot, type HttpDiscoverer } from "./http-discovery";
import type { SecurityHttpResponse } from "../http/security-http-client";

function fakeDiscoverer(response: SecurityHttpResponse): HttpDiscoverer {
  return { request: async () => response };
}

const BASE: SecurityHttpResponse = {
  status: 200,
  headers: {},
  body: "<html></html>",
  truncated: false,
  redirectChain: [],
  finalUrl: "http://example.com/",
};

describe("discoverRoot", () => {
  it("captures status, content-type, server, redirect chain, final URL, and HTML body", async () => {
    const client = fakeDiscoverer({
      ...BASE,
      headers: { "content-type": "text/html", server: "nginx" },
    });
    const result = await discoverRoot(client, "http://example.com/");
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/html");
    expect(result.server).toBe("nginx");
    expect(result.redirectChain).toEqual([]);
    expect(result.finalUrl).toBe("http://example.com/");
    expect(result.htmlBody).toBe("<html></html>");
  });

  it("normalizes a single Set-Cookie header into a one-element array", async () => {
    const client = fakeDiscoverer({ ...BASE, headers: { "set-cookie": "session=abc; HttpOnly" } });
    const result = await discoverRoot(client, "http://example.com/");
    expect(result.cookies).toEqual(["session=abc; HttpOnly"]);
  });

  it("preserves multiple Set-Cookie headers as a multi-element array", async () => {
    const client = fakeDiscoverer({
      ...BASE,
      headers: { "set-cookie": ["session=abc; HttpOnly", "theme=dark; Path=/"] },
    });
    const result = await discoverRoot(client, "http://example.com/");
    expect(result.cookies).toEqual(["session=abc; HttpOnly", "theme=dark; Path=/"]);
  });

  it("returns an empty cookie list when no Set-Cookie header is present", async () => {
    const client = fakeDiscoverer({ ...BASE, headers: {} });
    const result = await discoverRoot(client, "http://example.com/");
    expect(result.cookies).toEqual([]);
  });

  it("surfaces the redirect chain and finalUrl exactly as the transport reported them", async () => {
    const client = fakeDiscoverer({
      ...BASE,
      redirectChain: ["http://example.com/old"],
      finalUrl: "http://example.com/new",
    });
    const result = await discoverRoot(client, "http://example.com/old");
    expect(result.redirectChain).toEqual(["http://example.com/old"]);
    expect(result.finalUrl).toBe("http://example.com/new");
  });
});
