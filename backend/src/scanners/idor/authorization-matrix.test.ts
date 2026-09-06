import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/connection";
import { runMigrations } from "../../db/migrator";
import { declareResourceOwnership } from "../../ownership/resource-ownership-repository";
import { generateAuthorizationMatrix } from "./authorization-matrix";
import type { ResourceKey } from "../../mutation/resource-key";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-authz-matrix-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User B', 'BEARER')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Admin', 'BEARER')").run();
  return db;
}

const RESOURCE_1: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "1" };
const RESOURCE_2: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "2" };

describe("generateAuthorizationMatrix", () => {
  it("covers every declared profile x resource pair", () => {
    const db = freshTarget();
    declareResourceOwnership(db, { resourceKey: RESOURCE_1, ownerAuthProfileId: 1 }); // User A owns resource 1
    declareResourceOwnership(db, { resourceKey: RESOURCE_2, ownerAuthProfileId: 2 }); // User B owns resource 2

    const matrix = generateAuthorizationMatrix(db, 1, [1, 2, 3]);

    // 3 profiles x 2 resources = 6 cells, every pair present exactly once.
    expect(matrix).toHaveLength(6);
    for (const authProfileId of [1, 2, 3]) {
      for (const resourceKey of [RESOURCE_1, RESOURCE_2]) {
        expect(matrix).toContainEqual(
          expect.objectContaining({ authProfileId, resourceKey, relation: expect.any(String) }),
        );
      }
    }
  });

  it("classifies OWNER only for the resource's actual declared owner, NON_OWNER for every other profile", () => {
    const db = freshTarget();
    declareResourceOwnership(db, { resourceKey: RESOURCE_1, ownerAuthProfileId: 1 });

    const matrix = generateAuthorizationMatrix(db, 1, [1, 2, 3]);

    expect(matrix.find((e) => e.authProfileId === 1)?.relation).toBe("OWNER");
    expect(matrix.find((e) => e.authProfileId === 2)?.relation).toBe("NON_OWNER");
    expect(matrix.find((e) => e.authProfileId === 3)?.relation).toBe("NON_OWNER");
  });

  it("returns an empty matrix when no ownership has been declared", () => {
    const db = freshTarget();
    expect(generateAuthorizationMatrix(db, 1, [1, 2, 3])).toEqual([]);
  });
});
