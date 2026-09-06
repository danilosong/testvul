import { describe, expect, it } from "vitest";
import { classifyWebSocketActivity, type ObservedWebSocketActivity } from "./websocket-observer";

describe("classifyWebSocketActivity", () => {
  it("classifies WEBSOCKET_OPERATION_OBSERVED as the baseline for every observed endpoint", () => {
    const activity: ObservedWebSocketActivity[] = [{ url: "ws://example.com/ws", frameCount: 3 }];
    const [result] = classifyWebSocketActivity(activity, () => true);
    expect(result!.classification).toBe("WEBSOCKET_OPERATION_OBSERVED");
  });

  it("flags mutationInconclusive when activity was observed but no corresponding HTTP operation exists — never assumed safe", () => {
    const activity: ObservedWebSocketActivity[] = [{ url: "ws://example.com/ws", frameCount: 2 }];
    const [result] = classifyWebSocketActivity(activity, () => false);
    expect(result!.mutationInconclusive).toBe(true);
  });

  it("does not flag mutationInconclusive when a corresponding HTTP operation was found", () => {
    const activity: ObservedWebSocketActivity[] = [{ url: "ws://example.com/ws", frameCount: 2 }];
    const [result] = classifyWebSocketActivity(activity, () => true);
    expect(result!.mutationInconclusive).toBe(false);
  });

  it("does not flag mutationInconclusive for an endpoint with no actual frame activity", () => {
    const activity: ObservedWebSocketActivity[] = [{ url: "ws://example.com/ws", frameCount: 0 }];
    const [result] = classifyWebSocketActivity(activity, () => false);
    expect(result!.mutationInconclusive).toBe(false);
  });
});
