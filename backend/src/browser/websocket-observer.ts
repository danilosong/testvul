import type { Page, WebSocket } from "playwright";

export interface ObservedWebSocketActivity {
  url: string;
  frameCount: number;
}

/**
 * Detects WebSocket connections a page opens and records the endpoint and
 * that runtime communication occurred — observation only. No frame this
 * module observes is ever sent, resent, or otherwise reused: there is no
 * code path here that calls anything on the observed `WebSocket` beyond
 * `.on(...)` listeners, so replaying an observed message as a mutation is
 * structurally impossible from this module alone.
 */
export function observeWebSockets(page: Page): { activity: ObservedWebSocketActivity[]; stop: () => void } {
  const activity: ObservedWebSocketActivity[] = [];
  const onWebSocket = (ws: WebSocket): void => {
    const entry: ObservedWebSocketActivity = { url: ws.url(), frameCount: 0 };
    activity.push(entry);
    ws.on("framesent", () => {
      entry.frameCount++;
    });
    ws.on("framereceived", () => {
      entry.frameCount++;
    });
  };
  page.on("websocket", onWebSocket);
  return { activity, stop: () => page.off("websocket", onWebSocket) };
}

export type WebSocketActivityClassification = "WEBSOCKET_OPERATION_OBSERVED" | "WEBSOCKET_MUTATION_INCONCLUSIVE";

export interface WebSocketActivityResult {
  url: string;
  /** Every observed WebSocket endpoint gets this baseline classification — communication happened, nothing more claimed. */
  classification: "WEBSOCKET_OPERATION_OBSERVED";
  /** Set when this endpoint had any activity at all AND no equivalent HTTP-based `DiscoveredOperation` was found for it — flagging a real gap rather than silently assuming the functionality is safe/already covered. */
  mutationInconclusive: boolean;
}

/**
 * Classifies each observed WebSocket endpoint: always
 * WEBSOCKET_OPERATION_OBSERVED (activity happened), and additionally
 * flagged `mutationInconclusive` (WEBSOCKET_MUTATION_INCONCLUSIVE) when
 * activity was observed but `hasCorrespondingHttpOperation` finds no
 * matching HTTP-based operation for it — this engine has no safe way to
 * test WebSocket-only functionality, and does not pretend otherwise.
 */
export function classifyWebSocketActivity(
  activity: readonly ObservedWebSocketActivity[],
  hasCorrespondingHttpOperation: (url: string) => boolean,
): WebSocketActivityResult[] {
  return activity.map((entry) => ({
    url: entry.url,
    classification: "WEBSOCKET_OPERATION_OBSERVED",
    mutationInconclusive: entry.frameCount > 0 && !hasCorrespondingHttpOperation(entry.url),
  }));
}
