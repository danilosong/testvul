import { resolveCname as defaultResolveCname, resolve4 as defaultResolve4, resolve6 as defaultResolve6 } from "node:dns/promises";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface DnsResolutionResult {
  hostname: string;
  /** Each hop of the CNAME chain, in order; empty if `hostname` has no CNAME. */
  cnameChain: string[];
  /** The name A/AAAA records were actually resolved against — the last
   * link of `cnameChain`, or `hostname` itself if there was no CNAME. */
  finalHostname: string;
  addresses: ResolvedAddress[];
}

export interface DnsResolverFns {
  resolveCname: (hostname: string) => Promise<string[]>;
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
}

const defaultFns: DnsResolverFns = {
  resolveCname: defaultResolveCname,
  resolve4: defaultResolve4,
  resolve6: defaultResolve6,
};

async function resolveCnameChain(hostname: string, resolveCname: DnsResolverFns["resolveCname"]): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set([hostname]);
  let current = hostname;

  for (;;) {
    let cnames: string[];
    try {
      cnames = await resolveCname(current);
    } catch {
      break; // no CNAME record at this name — it's the final hostname
    }
    const next = cnames[0];
    if (!next || seen.has(next)) break; // no target, or a loop — stop rather than spin forever
    chain.push(next);
    seen.add(next);
    current = next;
  }

  return chain;
}

/**
 * Resolves A, AAAA, and CNAME records for `hostname`, following the full
 * CNAME chain to whatever name the address records actually sit on.
 */
export async function resolveDns(hostname: string, fns: DnsResolverFns = defaultFns): Promise<DnsResolutionResult> {
  const cnameChain = await resolveCnameChain(hostname, fns.resolveCname);
  const finalHostname = cnameChain.length > 0 ? cnameChain[cnameChain.length - 1]! : hostname;

  const addresses: ResolvedAddress[] = [];
  try {
    const v4 = await fns.resolve4(finalHostname);
    addresses.push(...v4.map((address) => ({ address, family: 4 as const })));
  } catch {
    // no A records — not an error, just nothing to add
  }
  try {
    const v6 = await fns.resolve6(finalHostname);
    addresses.push(...v6.map((address) => ({ address, family: 6 as const })));
  } catch {
    // no AAAA records — not an error, just nothing to add
  }

  return { hostname, cnameChain, finalHostname, addresses };
}
