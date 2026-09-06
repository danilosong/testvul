import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Opens a SQLite connection with the pragmas every connection needs:
 * foreign key enforcement is off by default per-connection in SQLite, so it
 * must be turned on explicitly every time, not just at schema-creation time.
 */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}
