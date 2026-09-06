import { join } from "node:path";
import { buildApp } from "./app";
import { openDb } from "./db/connection";
import { runMigrations } from "./db/migrator";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "data.db");
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

const db = openDb(DB_PATH);
runMigrations(db, MIGRATIONS_DIR);

buildApp(db)
  .listen({ port: PORT, host: "127.0.0.1" })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
