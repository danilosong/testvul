import type { Db } from "../db/connection";
import { buildAttackSurface, type AttackSurfaceTreeNode } from "../discovery/attack-surface";
import { getDiscoveredEndpointById, listDiscoveredResources } from "../discovery/discovered-endpoints-repository";
import { listDiscoveredFieldsForEndpoint, type DiscoveredField } from "../discovery/discovered-fields-repository";

/**
 * The Attack Surface tree (Section 15.4) — the exact same
 * `buildAttackSurface` summarizer Section 5.9 already built, fed with
 * every endpoint persisted so far (Section 15.3's `discovered_endpoints`
 * writer) regardless of whether static crawling or Section 12's browser
 * navigation found it. No separate merge logic exists, or is needed: both
 * sources already land in the same table.
 */
export function getAttackSurfaceTree(db: Db, scanRunId: number): AttackSurfaceTreeNode[] {
  return buildAttackSurface(listDiscoveredResources(db, scanRunId)).tree;
}

/** Fields worth a human's attention on an Endpoint Detail view — everything except the purely structural BOOLEAN/NUMBER/GENERIC_STRING classifications. */
const NOT_INTERESTING = new Set(["BOOLEAN", "NUMBER", "GENERIC_STRING"]);

export interface EndpointDetail {
  id: number;
  method: string;
  url: string;
  classification: string;
  contentType?: string;
  /** `undefined` — never `false` — until an actual authenticated-vs-unauthenticated observation was recorded (Section 15.4 never guesses this). */
  authRequired?: boolean;
  fieldCount: number;
  interestingFields: DiscoveredField[];
}

export function getEndpointDetail(db: Db, endpointId: number): EndpointDetail | null {
  const endpoint = getDiscoveredEndpointById(db, endpointId);
  if (!endpoint) return null;

  const fields = listDiscoveredFieldsForEndpoint(db, endpointId);
  const detail: EndpointDetail = {
    id: endpoint.id,
    method: endpoint.method,
    url: endpoint.url,
    classification: endpoint.classification,
    fieldCount: fields.length,
    interestingFields: fields.filter((field) => !NOT_INTERESTING.has(field.classification)),
  };
  if (endpoint.contentType !== undefined) detail.contentType = endpoint.contentType;
  if (endpoint.authRequired !== undefined) detail.authRequired = endpoint.authRequired;
  return detail;
}
