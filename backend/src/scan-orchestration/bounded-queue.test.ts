import { describe, expect, it } from "vitest";
import { BoundedQueue, ScanQueues } from "./bounded-queue";

describe("BoundedQueue (Section 14.1)", () => {
  it("accepts items up to its bound", () => {
    const queue = new BoundedQueue<number>("PAGE", 3);
    expect(queue.enqueue(1)).toEqual({ accepted: true });
    expect(queue.enqueue(2)).toEqual({ accepted: true });
    expect(queue.enqueue(3)).toEqual({ accepted: true });
    expect(queue.size).toBe(3);
    expect(queue.isTruncated()).toBe(false);
  });

  it("stops accepting new items once the bound is reached, marking itself truncated, without discarding what was already accepted", () => {
    const queue = new BoundedQueue<number>("PAGE", 2);
    queue.enqueue(1);
    queue.enqueue(2);
    const result = queue.enqueue(3);
    expect(result).toEqual({ accepted: false });
    expect(queue.isTruncated()).toBe(true);
    expect(queue.size).toBe(2); // items 1 and 2 are still there
  });

  it("dequeues items in FIFO order, and every accepted item can still be drained to completion after truncation", () => {
    const queue = new BoundedQueue<number>("SECURITY_TEST", 2);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3); // rejected — truncated
    expect(queue.dequeue()).toBe(1);
    expect(queue.dequeue()).toBe(2);
    expect(queue.dequeue()).toBeUndefined();
  });
});

describe("ScanQueues (Section 14.1) — the Page Queue's bound has no effect on the Security Test Queue", () => {
  it("accepted Security Test items still run to completion after the Page Queue's bound is reached", () => {
    const queues = new ScanQueues({ target: 10, page: 2, api: 10, securityTest: 10 });

    // Fill and overflow the Page Queue.
    queues.page.enqueue("page-1");
    queues.page.enqueue("page-2");
    const overflow = queues.page.enqueue("page-3");
    expect(overflow).toEqual({ accepted: false });
    expect(queues.page.isTruncated()).toBe(true);

    // The Security Test Queue is entirely unaffected: every accepted test still runs to completion.
    const acceptedTests = ["xss-test-1", "gtm-test-1", "idor-test-1"];
    for (const test of acceptedTests) {
      expect(queues.securityTest.enqueue(test)).toEqual({ accepted: true });
    }
    expect(queues.securityTest.isTruncated()).toBe(false);

    const completed: string[] = [];
    let next: unknown;
    while ((next = queues.securityTest.dequeue()) !== undefined) completed.push(next as string);
    expect(completed).toEqual(acceptedTests);
  });

  it("records exactly which limit was reached first, in Target/Page/API/Security Test order", () => {
    const queues = new ScanQueues({ target: 10, page: 1, api: 1, securityTest: 10 });
    queues.page.enqueue("p1");
    queues.page.enqueue("p2"); // truncates PAGE
    queues.api.enqueue("a1");
    queues.api.enqueue("a2"); // truncates API too

    expect(queues.getTruncationSummary()).toEqual({ truncated: true, limitReached: "PAGE" });
  });

  it("reports no truncation when every queue stays within its bound", () => {
    const queues = new ScanQueues({ target: 10, page: 10, api: 10, securityTest: 10 });
    queues.page.enqueue("p1");
    expect(queues.getTruncationSummary()).toEqual({ truncated: false });
  });
});
