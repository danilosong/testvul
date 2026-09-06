import type { Db } from "../db/connection";

export function recordAuditEvent(db: Db, scanRunId: number, eventType: string, payload: unknown): void {
  db.prepare("INSERT INTO audit_events (scan_run_id, event_type, payload_json) VALUES (?, ?, ?)").run(
    scanRunId,
    eventType,
    JSON.stringify(payload),
  );
}

export interface AuditEvent {
  id: number;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export function listAuditEvents(db: Db, scanRunId: number): AuditEvent[] {
  const rows = db
    .prepare("SELECT id, event_type, payload_json, created_at FROM audit_events WHERE scan_run_id = ? ORDER BY id")
    .all(scanRunId) as unknown as { id: number; event_type: string; payload_json: string; created_at: string }[];
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, payload: JSON.parse(row.payload_json), createdAt: row.created_at }));
}
