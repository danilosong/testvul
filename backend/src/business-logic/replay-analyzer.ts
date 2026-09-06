/**
 * Scaffold — filled in by Section 13.13 (Replay and Idempotency
 * Analysis). Compares an operation's original result against a replayed
 * result, detecting Idempotency-Key/request-ID/nonce support — real
 * financial/sensitive operations on live targets default to
 * PASSIVE/INCONCLUSIVE, only ever replayed against a fixture.
 */
export interface ReplayAnalysis {
  operation: string;
  originalResult: unknown;
  replayResult: unknown;
  expectedIdempotent: boolean;
}
