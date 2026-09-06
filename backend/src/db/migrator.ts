import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./connection";

/**
 * Applies every .sql file in `migrationsDir`, in filename order, that has not
 * already been recorded in `_migrations`. Each migration runs inside its own
 * transaction; a failure rolls back that migration only and stops the run
 * (nothing after it is attempted), so a fresh file always ends up either
 * fully migrated or stopped at a known, reported point.
 */
export function runMigrations(db: Db, migrationsDir: string): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const alreadyApplied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((row) => (row as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec("BEGIN;");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
      db.exec("COMMIT;");
      applied.push(file);
    } catch (err) {
      db.exec("ROLLBACK;");
      throw new Error(`Migration ${file} failed and was rolled back: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  return { applied };
}
