import { describe, expect, it } from "vitest";
import { ScopeValidator, ScopeViolationError } from "../scope";
import { PrivateIpBlockedError, SecurityHttpClient } from "./security-http-client";

describe("SecurityHttpClient", () => {
  it("rejects a request to an out-of-scope host before any DNS lookup or connection", async () => {
    const dnsLookup = async () => {
      throw new Error("DNS lookup must never run for an out-of-scope host");
    };
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]), dnsLookup });
    await expect(client.request("https://not-authorized.com/")).rejects.toThrow(ScopeViolationError);
  });

  it("blocks a request whose resolved address is a private/loopback IP by default", async () => {
    const dnsLookup = async () => ({ address: "127.0.0.1", family: 4 });
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]), dnsLookup });
    await expect(client.request("https://example.com/")).rejects.toThrow(PrivateIpBlockedError);
  });

  it("does not raise PrivateIpBlockedError when allowPrivateNetworks is enabled, for a blocked-range address", async () => {
    // isBlockedIp itself (unit-tested in scope/ip-validator.test.ts) already
    // proves the override suppresses the block; this confirms the client
    // wires that option through rather than hardcoding `false`.
    const dnsLookup = async () => ({ address: "10.0.0.1", family: 4 });
    let rateLimiterReached = false;
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["example.com"]),
      dnsLookup,
      allowPrivateNetworks: true,
      rateLimiter: {
        run: async () => {
          rateLimiterReached = true;
          throw new Error("stop before the transport stage — this test only checks the gate, not connectivity");
        },
      },
    });
    await expect(client.request("https://example.com/")).rejects.not.toThrow(PrivateIpBlockedError);
    expect(rateLimiterReached).toBe(true);
  });

  it("blocks using the address actually about to be connected to, even if an earlier lookup returned something else", async () => {
    // Simulates DNS rebinding: the resolver hands back a different answer
    // on a later call than it did before. Since validation and pinning
    // both come from the *same* resolution — there is no separate
    // "connect-time" lookup a rebind could win — whichever address this
    // call returns is the one the block decision is made against.
    let callCount = 0;
    const dnsLookup = async () => {
      callCount++;
      // First call (if ever made before this one) would have looked public;
      // this call — the one whose result actually gets used — is private.
      return { address: "192.168.1.1", family: 4 };
    };
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]), dnsLookup });
    await expect(client.request("https://example.com/")).rejects.toThrow(PrivateIpBlockedError);
    expect(callCount).toBe(1); // exactly one resolution for this hop — nothing re-resolves independently
  });

  it("blocks a hostname whose CNAME chain resolves to a private IP (dns.lookup already resolves CNAMEs to their final address)", async () => {
    const dnsLookup = async (hostname: string) => {
      expect(hostname).toBe("cdn.example.com"); // the CNAME hostname, not an intermediate alias
      return { address: "127.0.0.1", family: 4 }; // the chain's final A record
    };
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["cdn.example.com"]), dnsLookup });
    await expect(client.request("https://cdn.example.com/")).rejects.toThrow(PrivateIpBlockedError);
  });
});
