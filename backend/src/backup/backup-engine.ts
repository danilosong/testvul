import { createHash } from "node:crypto";
import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import type { ResourceSnapshot } from "./resource-backup";
import { saveResourceBackup } from "./resource-backups-repository";

/** Shared with the Restore Engine (Section 9.4), which hashes the
 * post-restore content with this exact function to compare against a
 * snapshot's `contentHash`. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Captures and persists a resource's current content, a timestamp, and its
 * hash — the mandatory first step of every write-based test's
 * backup→mutate→verify→restore→restore-verify cycle. Nothing in this
 * codebase is meant to mutate a resource without this having run first for
 * that exact `ResourceKey`.
 */
export function captureBackup(db: Db, scanRunId: number, resourceKey: ResourceKey, content: string): ResourceSnapshot {
  const snapshot: ResourceSnapshot = {
    resourceKey,
    content,
    contentHash: hashContent(content),
    capturedAt: new Date().toISOString(),
  };
  saveResourceBackup(db, scanRunId, snapshot);
  return snapshot;
}
