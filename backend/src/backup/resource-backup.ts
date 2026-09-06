import type { ResourceKey } from "../mutation/resource-key";

export interface ResourceSnapshot {
  resourceKey: ResourceKey;
  content: string;
  contentHash: string;
  capturedAt: string;
}
