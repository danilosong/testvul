import type { Db } from "../db/connection";
import type { WebhookOperation, WebhookOperationInput } from "./webhook-operation";

export function recordWebhookOperation(db: Db, input: WebhookOperationInput): number {
  const result = db
    .prepare(
      `INSERT INTO webhook_operations (scan_run_id, endpoint, provider, authentication_mechanism, signature_mechanism, replay_protection, idempotency, resulting_state_transition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.scanRunId,
      input.endpoint,
      input.provider ?? null,
      input.authenticationMechanism ?? null,
      input.signatureMechanism ?? null,
      input.replayProtection ?? null,
      input.idempotency ?? null,
      input.resultingStateTransition ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface WebhookOperationRow {
  id: number;
  scan_run_id: number;
  endpoint: string;
  provider: string | null;
  authentication_mechanism: string | null;
  signature_mechanism: string | null;
  replay_protection: string | null;
  idempotency: string | null;
  resulting_state_transition: string | null;
}

function rowToWebhookOperation(row: WebhookOperationRow): WebhookOperation {
  const op: WebhookOperation = { id: row.id, scanRunId: row.scan_run_id, endpoint: row.endpoint };
  if (row.provider !== null) op.provider = row.provider;
  if (row.authentication_mechanism !== null) op.authenticationMechanism = row.authentication_mechanism;
  if (row.signature_mechanism !== null) op.signatureMechanism = row.signature_mechanism;
  if (row.replay_protection !== null) op.replayProtection = row.replay_protection;
  if (row.idempotency !== null) op.idempotency = row.idempotency;
  if (row.resulting_state_transition !== null) op.resultingStateTransition = row.resulting_state_transition;
  return op;
}

export function listWebhookOperations(db: Db, scanRunId: number): WebhookOperation[] {
  const rows = db.prepare("SELECT * FROM webhook_operations WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as WebhookOperationRow[];
  return rows.map(rowToWebhookOperation);
}
