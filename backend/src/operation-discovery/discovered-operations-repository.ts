import type { Db } from "../db/connection";
import type { DiscoveredOperation } from "./discovered-operation";

/** Registers a `DiscoveredOperation` — the single insertion path every
 * source (OpenAPI, forms, JS static analysis, browser runtime/dry-run,
 * manual import) is meant to go through. */
export function registerDiscoveredOperation(db: Db, scanRunId: number, operation: DiscoveredOperation): void {
  db.prepare(
    `INSERT INTO discovered_operations
      (scan_run_id, method, url, content_type, request_schema_json, response_schema_json, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scanRunId,
    operation.method,
    operation.url,
    operation.contentType ?? null,
    operation.requestSchema !== undefined ? JSON.stringify(operation.requestSchema) : null,
    operation.responseSchema !== undefined ? JSON.stringify(operation.responseSchema) : null,
    operation.source,
    operation.confidence,
  );
}

interface DiscoveredOperationRow {
  method: string;
  url: string;
  content_type: string | null;
  request_schema_json: string | null;
  response_schema_json: string | null;
  source: DiscoveredOperation["source"];
  confidence: DiscoveredOperation["confidence"];
}

export function getDiscoveredOperations(db: Db, scanRunId: number): DiscoveredOperation[] {
  const rows = db
    .prepare(
      "SELECT method, url, content_type, request_schema_json, response_schema_json, source, confidence FROM discovered_operations WHERE scan_run_id = ?",
    )
    .all(scanRunId) as unknown as DiscoveredOperationRow[];

  return rows.map((row) => {
    const operation: DiscoveredOperation = {
      method: row.method,
      url: row.url,
      source: row.source,
      confidence: row.confidence,
    };
    if (row.content_type !== null) operation.contentType = row.content_type;
    if (row.request_schema_json !== null) operation.requestSchema = JSON.parse(row.request_schema_json);
    if (row.response_schema_json !== null) operation.responseSchema = JSON.parse(row.response_schema_json);
    return operation;
  });
}
