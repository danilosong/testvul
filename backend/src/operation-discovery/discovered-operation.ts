export type OperationSource =
  | "OPENAPI"
  | "HTML_FORM"
  | "JAVASCRIPT_STATIC_ANALYSIS"
  | "BROWSER_RUNTIME"
  | "BROWSER_DRY_RUN"
  | "MANUAL";

export type OperationConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface DiscoveredOperation {
  method: string;
  url: string;
  contentType?: string;
  requestSchema?: unknown;
  responseSchema?: unknown;
  source: OperationSource;
  confidence: OperationConfidence;
}

const CONFIDENCE_RANK: Record<OperationConfidence, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/**
 * The no-guess-write-template query: is there an operation for this exact
 * method/url, from ANY source, whose confidence meets or exceeds what the
 * caller requires? A mutating scanner test must never run without this
 * returning true first.
 */
export function hasEligibleOperation(
  operations: readonly DiscoveredOperation[],
  method: string,
  url: string,
  minConfidence: OperationConfidence,
): boolean {
  return operations.some(
    (op) =>
      op.method.toUpperCase() === method.toUpperCase() &&
      op.url === url &&
      CONFIDENCE_RANK[op.confidence] >= CONFIDENCE_RANK[minConfidence],
  );
}
