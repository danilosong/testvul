import type { Db } from "../../db/connection";
import type { ResourceKey } from "../../mutation/resource-key";
import { listResourceOwnership } from "../../ownership/resource-ownership-repository";

export type AuthorizationMatrixRelation = "OWNER" | "NON_OWNER";

export interface AuthorizationMatrixEntry {
  authProfileId: number;
  resourceKey: ResourceKey;
  relation: AuthorizationMatrixRelation;
}

/**
 * The Automated Authorization Matrix: a cross product of every supplied
 * Authentication Profile against every resource with declared ownership
 * (Section 8.7's `resource_ownership`), classifying each cell OWNER or
 * NON_OWNER. This is the complete set of (profile, resource) pairs the
 * IDOR scanner's Read/Write tests consider — generated automatically from
 * declared ownership data rather than requiring the operator to enumerate
 * every combination by hand.
 */
export function generateAuthorizationMatrix(db: Db, targetId: number, authProfileIds: readonly number[]): AuthorizationMatrixEntry[] {
  const ownerships = listResourceOwnership(db, targetId);
  const entries: AuthorizationMatrixEntry[] = [];

  for (const authProfileId of authProfileIds) {
    for (const ownership of ownerships) {
      entries.push({
        authProfileId,
        resourceKey: ownership.resourceKey,
        relation: ownership.ownerAuthProfileId === authProfileId ? "OWNER" : "NON_OWNER",
      });
    }
  }

  return entries;
}
