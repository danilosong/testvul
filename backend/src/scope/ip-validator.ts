import { isIPv4, isIPv6 } from "node:net";

export interface IpValidationOptions {
  allowPrivateNetworks: boolean;
}

const IPV4_BLOCKED_CIDRS = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // private
  "172.16.0.0/12", // private
  "192.168.0.0/16", // private
  "169.254.0.0/16", // link-local
];

const IPV6_BLOCKED_RANGES: Array<{ address: string; prefixLen: number }> = [
  { address: "::1", prefixLen: 128 }, // loopback
  { address: "fc00::", prefixLen: 7 }, // unique local
  { address: "fe80::", prefixLen: 10 }, // link-local
];

function ipv4ToUint32(ip: string): number {
  return (
    ip
      .split(".")
      .map(Number)
      .reduce((acc, part) => (acc << 8) + part, 0) >>> 0
  );
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToUint32(ip) & mask) === (ipv4ToUint32(base as string) & mask);
}

/** Expands any valid IPv6 textual form (including `::` shorthand and an
 * embedded trailing IPv4 address) into its 128-bit integer value. */
function ipv6ToBigInt(ip: string): bigint {
  let addr = ip.split("%")[0] as string; // drop a zone id, if present

  const ipv4Suffix = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Suffix) {
    const [a, b, c, d] = ipv4Suffix[1]!.split(".").map(Number);
    const hex1 = (((a as number) << 8) + (b as number)).toString(16);
    const hex2 = (((c as number) << 8) + (d as number)).toString(16);
    addr = addr.slice(0, addr.length - ipv4Suffix[1]!.length) + hex1 + ":" + hex2;
  }

  let head: string[];
  let tail: string[];
  if (addr.includes("::")) {
    const [left, right] = addr.split("::");
    head = left ? left.split(":") : [];
    tail = right ? right.split(":") : [];
  } else {
    head = addr.split(":");
    tail = [];
  }
  const missing = 8 - head.length - tail.length;
  const groups = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...tail];

  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || "0", 16)), 0n);
}

function isIpv6InCidr(addr: bigint, cidrAddress: string, prefixLen: number): boolean {
  const base = ipv6ToBigInt(cidrAddress);
  const shift = BigInt(128 - prefixLen);
  return addr >> shift === base >> shift;
}

/** True if `addr` is an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`). */
function extractIpv4MappedAddress(addr: bigint): string | null {
  const top96 = addr >> 32n;
  if (top96 !== 0xffffn) return null;
  const low32 = addr & 0xffffffffn;
  return [24n, 16n, 8n, 0n].map((shift) => Number((low32 >> shift) & 0xffn)).join(".");
}

/**
 * True if `ip` (a literal, already-resolved address — never a hostname)
 * falls in a default-blocked private/loopback/link-local range and the
 * operator has not explicitly enabled "Allow private infrastructure" for
 * this audit.
 */
export function isBlockedIp(ip: string, options: IpValidationOptions): boolean {
  if (options.allowPrivateNetworks) return false;

  if (isIPv4(ip)) {
    return IPV4_BLOCKED_CIDRS.some((cidr) => isIpv4InCidr(ip, cidr));
  }

  if (isIPv6(ip)) {
    const addr = ipv6ToBigInt(ip);
    if (IPV6_BLOCKED_RANGES.some(({ address, prefixLen }) => isIpv6InCidr(addr, address, prefixLen))) {
      return true;
    }
    const mappedIpv4 = extractIpv4MappedAddress(addr);
    if (mappedIpv4) {
      return IPV4_BLOCKED_CIDRS.some((cidr) => isIpv4InCidr(mappedIpv4, cidr));
    }
    return false;
  }

  return false;
}
