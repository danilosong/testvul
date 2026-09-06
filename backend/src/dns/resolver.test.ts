import { describe, expect, it } from "vitest";
import { resolveDns, type DnsResolverFns } from "./resolver";

function mockFns(overrides: Partial<DnsResolverFns>): DnsResolverFns {
  return {
    resolveCname: async () => {
      throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    },
    resolve4: async () => {
      throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    },
    resolve6: async () => {
      throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    },
    ...overrides,
  };
}

describe("resolveDns", () => {
  it("resolves a CNAME chain to its final hostname and both resulting A records", async () => {
    const fns = mockFns({
      resolveCname: async (hostname) => {
        if (hostname === "api.example.com") return ["loadbalancer.example.net"];
        throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      },
      resolve4: async (hostname) => {
        if (hostname === "loadbalancer.example.net") return ["192.0.2.10", "192.0.2.11"];
        throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      },
    });

    const result = await resolveDns("api.example.com", fns);

    expect(result.cnameChain).toEqual(["loadbalancer.example.net"]);
    expect(result.finalHostname).toBe("loadbalancer.example.net");
    expect(result.addresses).toEqual([
      { address: "192.0.2.10", family: 4 },
      { address: "192.0.2.11", family: 4 },
    ]);
  });

  it("resolves multiple A records directly with no CNAME involved", async () => {
    const fns = mockFns({
      resolve4: async () => ["203.0.113.1", "203.0.113.2", "203.0.113.3"],
    });

    const result = await resolveDns("example.com", fns);

    expect(result.cnameChain).toEqual([]);
    expect(result.finalHostname).toBe("example.com");
    expect(result.addresses).toHaveLength(3);
  });

  it("follows a multi-hop CNAME chain", async () => {
    const fns = mockFns({
      resolveCname: async (hostname) => {
        if (hostname === "www.example.com") return ["cdn.example.com"];
        if (hostname === "cdn.example.com") return ["edge.provider.net"];
        throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      },
      resolve4: async (hostname) => (hostname === "edge.provider.net" ? ["198.51.100.5"] : []),
    });

    const result = await resolveDns("www.example.com", fns);

    expect(result.cnameChain).toEqual(["cdn.example.com", "edge.provider.net"]);
    expect(result.finalHostname).toBe("edge.provider.net");
    expect(result.addresses).toEqual([{ address: "198.51.100.5", family: 4 }]);
  });

  it("collects AAAA records alongside A records", async () => {
    const fns = mockFns({
      resolve4: async () => ["203.0.113.9"],
      resolve6: async () => ["2001:db8::1"],
    });

    const result = await resolveDns("example.com", fns);

    expect(result.addresses).toEqual([
      { address: "203.0.113.9", family: 4 },
      { address: "2001:db8::1", family: 6 },
    ]);
  });

  it("does not loop forever on a circular CNAME chain", async () => {
    const fns = mockFns({
      resolveCname: async (hostname) => {
        if (hostname === "a.example.com") return ["b.example.com"];
        if (hostname === "b.example.com") return ["a.example.com"]; // cycle
        throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      },
    });

    const result = await resolveDns("a.example.com", fns);
    expect(result.cnameChain).toEqual(["b.example.com"]);
  });
});
