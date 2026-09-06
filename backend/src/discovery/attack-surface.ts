import { isApiReference } from "../api-discovery/api-reference-detector";
import { classifyEndpoint } from "../analysis/endpoint-classifier";

export interface DiscoveredResource {
  url: string;
  method: string;
  contentType?: string;
  /** True for an HTML page the crawler actually fetched (as opposed to a
   * link/script/form reference merely observed on one). */
  isPage?: boolean;
  /** True for a resource extracted from a `<form>`'s action. */
  isForm?: boolean;
}

export interface AttackSurfaceCounts {
  pages: number;
  apiEndpoints: number;
  forms: number;
  jsonEndpoints: number;
  authEndpoints: number;
  configEndpoints: number;
}

export interface AttackSurfaceTreeNode {
  name: string;
  children: AttackSurfaceTreeNode[];
  /** Present on a leaf that corresponds to an actual discovered resource. */
  url?: string;
}

export interface AttackSurfaceSummary {
  counts: AttackSurfaceCounts;
  /** One root node per discovered hostname. */
  tree: AttackSurfaceTreeNode[];
}

function isJsonEndpoint(resource: DiscoveredResource): boolean {
  if (resource.contentType && /json/i.test(resource.contentType)) return true;
  return /\.json(?:$|[?#])/i.test(resource.url);
}

function classificationOf(resource: DiscoveredResource): string {
  try {
    return classifyEndpoint(new URL(resource.url).pathname).classification;
  } catch {
    return "UNKNOWN";
  }
}

function insertIntoTree(roots: Map<string, AttackSurfaceTreeNode>, urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return;
  }

  let hostNode = roots.get(parsed.hostname);
  if (!hostNode) {
    hostNode = { name: parsed.hostname, children: [] };
    roots.set(parsed.hostname, hostNode);
  }

  let current = hostNode;
  for (const segment of parsed.pathname.split("/").filter(Boolean)) {
    let child = current.children.find((c) => c.name === segment);
    if (!child) {
      child = { name: segment, children: [] };
      current.children.push(child);
    }
    current = child;
  }
  current.url = urlStr;
}

/**
 * Merges static discovery output (crawled pages, extracted forms/scripts,
 * classified endpoints) into the counts and navigable tree the Attack
 * Surface view needs. Section 12 extends this with browser-runtime
 * discovery results; this function only ever sees what's handed to it.
 */
export function buildAttackSurface(resources: readonly DiscoveredResource[]): AttackSurfaceSummary {
  const counts: AttackSurfaceCounts = {
    pages: resources.filter((r) => r.isPage).length,
    apiEndpoints: resources.filter((r) => isApiReference(r.url)).length,
    forms: resources.filter((r) => r.isForm).length,
    jsonEndpoints: resources.filter(isJsonEndpoint).length,
    authEndpoints: resources.filter((r) => classificationOf(r) === "AUTH").length,
    configEndpoints: resources.filter((r) => classificationOf(r) === "CONFIGURATION").length,
  };

  const roots = new Map<string, AttackSurfaceTreeNode>();
  for (const resource of resources) insertIntoTree(roots, resource.url);

  return { counts, tree: [...roots.values()] };
}
