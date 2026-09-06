import * as http from "node:http";
import * as net from "node:net";
import { describe, expect, it } from "vitest";
import { startControlledEgressProxy } from "./controlled-egress-proxy";
import { ScopeValidator } from "../scope";
import type { DnsLookupFn } from "../scope/validated-request";

function sendConnect(proxyPort: number, target: string): Promise<{ statusLine: string; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\r\n");
      if (idx !== -1) {
        socket.removeListener("data", onData);
        resolve({ statusLine: buffer.slice(0, idx), socket });
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

function startEchoServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.pipe(socket));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      resolve({ port: address.port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function plainProxyRequest(proxyPort: number, targetUrl: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: proxyPort, path: targetUrl, method: "GET", headers: { Host: new URL(targetUrl).host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Controlled Egress Proxy — CONNECT tunnel", () => {
  it("blocks a CONNECT target resolving to a private IP", async () => {
    const dnsLookup: DnsLookupFn = async () => ({ address: "10.1.2.3", family: 4 });
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["private.example.com"]),
      allowPrivateNetworks: false,
      dnsLookup,
    });

    const { statusLine } = await sendConnect(proxy.port, "private.example.com:443");
    expect(statusLine).toContain("403");

    await proxy.close();
  });

  it("blocks a CONNECT target resolving to loopback", async () => {
    const dnsLookup: DnsLookupFn = async () => ({ address: "127.0.0.1", family: 4 });
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["loopback.example.com"]),
      allowPrivateNetworks: false,
      dnsLookup,
    });

    const { statusLine } = await sendConnect(proxy.port, "loopback.example.com:443");
    expect(statusLine).toContain("403");

    await proxy.close();
  });

  it("connects using the exact address already validated — no second, independent resolution a DNS rebind could win", async () => {
    const echo = await startEchoServer();
    let callCount = 0;
    const dnsLookup: DnsLookupFn = async () => {
      callCount++;
      // If this were ever called a second time (a real connect-time
      // re-resolution), it would still return the echo server's address —
      // the point is that it is never called more than once at all.
      return { address: "127.0.0.1", family: 4 };
    };
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["rebind.example.com"]),
      allowPrivateNetworks: true,
      dnsLookup,
    });

    const { statusLine, socket } = await sendConnect(proxy.port, `rebind.example.com:${echo.port}`);
    expect(statusLine).toContain("200");
    expect(callCount).toBe(1);

    const echoed = await new Promise<string>((resolve) => {
      socket.once("data", (chunk) => resolve(chunk.toString("utf8")));
      socket.write("ping-through-tunnel");
    });
    expect(echoed).toBe("ping-through-tunnel");

    socket.destroy();
    await proxy.close();
    await echo.close();
  });

  it("rejects a CONNECT target whose host:port can't be parsed", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    const { statusLine } = await sendConnect(proxy.port, "not-a-valid-target");
    expect(statusLine).toContain("400");
    await proxy.close();
  });
});

describe("Controlled Egress Proxy — hostname canonicalization", () => {
  it("allows a differently-cased, trailing-dotted hostname that canonicalizes to an in-scope host", async () => {
    const dnsLookup: DnsLookupFn = async () => ({ address: "127.0.0.1", family: 4 });
    const echo = await startEchoServer();
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["example.com"]),
      allowPrivateNetworks: true,
      dnsLookup,
    });

    const { statusLine, socket } = await sendConnect(proxy.port, `EXAMPLE.COM.:${echo.port}`);
    expect(statusLine).toContain("200");

    socket.destroy();
    await proxy.close();
    await echo.close();
  });

  it("blocks a suffix-confusion hostname that merely contains the allowed domain as a substring", async () => {
    const dnsLookup: DnsLookupFn = async () => ({ address: "127.0.0.1", family: 4 });
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["example.com"]),
      allowPrivateNetworks: true,
      dnsLookup,
    });

    const { statusLine } = await sendConnect(proxy.port, "example.com.evil.net:443");
    expect(statusLine).toContain("403");

    await proxy.close();
  });
});

describe("Controlled Egress Proxy — plain HTTP proxying and redirect targets", () => {
  it("relays a redirect response transparently, then independently blocks the redirect target when followed as its own request (private IP)", async () => {
    const origin = http.createServer((_req, res) => {
      res.writeHead(302, { Location: "http://private-target.example.com/" });
      res.end();
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const originPort = (origin.address() as net.AddressInfo).port;

    const permissiveDnsLookup: DnsLookupFn = async () => ({ address: "127.0.0.1", family: 4 });
    const permissiveProxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["origin.example.com"]),
      allowPrivateNetworks: true,
      dnsLookup: permissiveDnsLookup,
    });

    const redirectResponse = await plainProxyRequest(permissiveProxy.port, `http://origin.example.com:${originPort}/`);
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.location).toBe("http://private-target.example.com/");

    // A browser would now issue a fresh request for that Location through
    // the proxy — validated independently, and strictly this time.
    const strictDnsLookup: DnsLookupFn = async () => ({ address: "10.9.9.9", family: 4 });
    const strictProxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["private-target.example.com"]),
      allowPrivateNetworks: false,
      dnsLookup: strictDnsLookup,
    });
    const followed = await plainProxyRequest(strictProxy.port, "http://private-target.example.com/");
    expect(followed.status).toBe(403);

    await permissiveProxy.close();
    await strictProxy.close();
    await new Promise<void>((resolve) => origin.close(() => resolve()));
  });

  it("blocks a redirect target that is not in the declared scope", async () => {
    const dnsLookup: DnsLookupFn = async () => ({ address: "127.0.0.1", family: 4 });
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["origin.example.com"]), // "out-of-scope.example.net" deliberately absent
      allowPrivateNetworks: true,
      dnsLookup,
    });

    const followed = await plainProxyRequest(proxy.port, "http://out-of-scope.example.net/");
    expect(followed.status).toBe(403);

    await proxy.close();
  });
});
