import type { ResourceKey } from "../mutation/resource-key";

export interface ResourceOwnershipInput {
  resourceKey: ResourceKey;
  ownerAuthProfileId: number;
}

export interface ResourceOwnership {
  id: number;
  resourceKey: ResourceKey;
  ownerAuthProfileId: number;
}
