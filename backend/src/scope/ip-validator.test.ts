import { describe, expect, it } from "vitest";
import { isBlockedIp } from "./ip-validator";

const BLOCKED = { allowPrivateNetworks: false };
const ALLOWED = { allowPrivateNetworks: true };

describe("isBlockedIp", () => {
  describe("IPv4 default-blocked ranges", () => {
    it.each([
      ["127.0.0.1", "127.0.0.0/8 loopback"],
      ["127.255.255.255", "127.0.0.0/8 loopback (upper bound)"],
      ["10.0.0.1", "10.0.0.0/8 private"],
      ["10.255.255.255", "10.0.0.0/8 private (upper bound)"],
      ["172.16.0.1", "172.16.0.0/12 private"],
      ["172.31.255.255", "172.16.0.0/12 private (upper bound)"],
      ["192.168.0.1", "192.168.0.0/16 private"],
      ["192.168.255.255", "192.168.0.0/16 private (upper bound)"],
      ["169.254.0.1", "169.254.0.0/16 link-local"],
    ])("blocks %s (%s)", (ip) => {
      expect(isBlockedIp(ip, BLOCKED)).toBe(true);
    });

    it("does not block a public IPv4 address", () => {
      expect(isBlockedIp("93.184.216.34", BLOCKED)).toBe(false);
    });

    it("does not block a range-adjacent address just outside a blocked CIDR", () => {
      expect(isBlockedIp("172.32.0.1", BLOCKED)).toBe(false); // just past 172.16.0.0/12
      expect(isBlockedIp("11.0.0.1", BLOCKED)).toBe(false); // just past 10.0.0.0/8
    });
  });

  describe("IPv6 default-blocked ranges", () => {
    it("blocks ::1 (loopback)", () => {
      expect(isBlockedIp("::1", BLOCKED)).toBe(true);
    });

    it("blocks an fc00::/7 unique-local address", () => {
      expect(isBlockedIp("fd00::1", BLOCKED)).toBe(true);
    });

    it("blocks an fe80::/10 link-local address", () => {
      expect(isBlockedIp("fe80::1", BLOCKED)).toBe(true);
    });

    it("does not block a public IPv6 address", () => {
      expect(isBlockedIp("2606:2800:220:1:248:1893:25c8:1946", BLOCKED)).toBe(false);
    });

    it("blocks an IPv4-mapped IPv6 address whose embedded IPv4 is private", () => {
      expect(isBlockedIp("::ffff:127.0.0.1", BLOCKED)).toBe(true);
      expect(isBlockedIp("::ffff:192.168.1.1", BLOCKED)).toBe(true);
    });

    it("does not block an IPv4-mapped IPv6 address whose embedded IPv4 is public", () => {
      expect(isBlockedIp("::ffff:93.184.216.34", BLOCKED)).toBe(false);
    });
  });

  describe("allowPrivateNetworks override", () => {
    it("permits every otherwise-blocked address when explicitly enabled for the audit", () => {
      expect(isBlockedIp("127.0.0.1", ALLOWED)).toBe(false);
      expect(isBlockedIp("10.0.0.1", ALLOWED)).toBe(false);
      expect(isBlockedIp("192.168.0.1", ALLOWED)).toBe(false);
      expect(isBlockedIp("::1", ALLOWED)).toBe(false);
      expect(isBlockedIp("fe80::1", ALLOWED)).toBe(false);
    });

    it("still permits a public address regardless of the override", () => {
      expect(isBlockedIp("93.184.216.34", ALLOWED)).toBe(false);
    });
  });
});
