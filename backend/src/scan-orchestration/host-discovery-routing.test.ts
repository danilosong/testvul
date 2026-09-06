import { describe, expect, it } from "vitest";
import { BoundedQueue } from "./bounded-queue";
import { routeHostCandidates } from "./host-discovery-routing";
import type { HostCandidate } from "../discovery/host-candidate-discovery";

const CANDIDATES: HostCandidate[] = [
  { hostname: "sub.example.test", source: "LINK", inScope: true, queued: true },
  { hostname: "out-of-scope.example.test", source: "LINK", inScope: false, queued: false },
];

describe("routeHostCandidates (Section 14.4)", () => {
  it("enqueues only the in-scope candidate into the Target Queue, and only records the out-of-scope one", () => {
    const targetQueue = new BoundedQueue<string>("TARGET", 10);
    const result = routeHostCandidates(targetQueue, CANDIDATES);

    expect(result.queued).toEqual(["sub.example.test"]);
    expect(result.recordedOutOfScope).toEqual(["out-of-scope.example.test"]);
    expect(targetQueue.dequeue()).toBe("sub.example.test");
    expect(targetQueue.dequeue()).toBeUndefined(); // the out-of-scope host was never enqueued
  });

  it("routes identically regardless of the candidate's discovery source (static crawl LINK vs Section 12 BROWSER)", () => {
    const targetQueue = new BoundedQueue<string>("TARGET", 10);
    const browserCandidates: HostCandidate[] = [
      { hostname: "sub.example.test", source: "BROWSER", inScope: true, queued: true },
      { hostname: "out-of-scope.example.test", source: "BROWSER", inScope: false, queued: false },
    ];
    const result = routeHostCandidates(targetQueue, browserCandidates);
    expect(result.queued).toEqual(["sub.example.test"]);
    expect(result.recordedOutOfScope).toEqual(["out-of-scope.example.test"]);
  });

  it("records — never silently drops — an in-scope host the Target Queue's own bound was already reached for", () => {
    const targetQueue = new BoundedQueue<string>("TARGET", 1);
    targetQueue.enqueue("already-queued.example.test");
    const result = routeHostCandidates(targetQueue, [{ hostname: "sub.example.test", source: "LINK", inScope: true, queued: true }]);

    expect(result.queued).toEqual([]);
    expect(result.targetQueueTruncated).toBe(true);
  });
});
