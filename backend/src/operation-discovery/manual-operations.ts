import type { DiscoveredOperation } from "./discovered-operation";

export interface ManualOperationInput {
  method: string;
  url: string;
  contentType?: string;
  body?: unknown;
}

/** Anything the operator directly configures — manual mode, or a parsed
 * cURL/raw-HTTP import — is registered as HIGH confidence: it came from
 * the operator, not an inference. */
export function operationFromManualRequest(input: ManualOperationInput): DiscoveredOperation {
  const operation: DiscoveredOperation = {
    method: input.method.toUpperCase(),
    url: input.url,
    source: "MANUAL",
    confidence: "HIGH",
  };
  if (input.contentType !== undefined) operation.contentType = input.contentType;
  if (input.body !== undefined) operation.requestSchema = input.body;
  return operation;
}
