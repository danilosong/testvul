/**
 * The four bounded queues (Section 14.1, design.md Decision 16): Target,
 * Page, API, and Security Test. Reaching a queue's configured bound stops
 * *accepting new items* into that queue — it never discards an item that
 * was already accepted. Each queue is independent: one queue's bound
 * being reached has no effect on any other queue, including the Security
 * Test Queue, whose already-accepted items always still run to
 * completion.
 */
export type BoundedQueueName = "TARGET" | "PAGE" | "API" | "SECURITY_TEST";

export interface BoundedQueueEnqueueResult {
  accepted: boolean;
}

export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private truncated = false;

  constructor(
    public readonly name: BoundedQueueName,
    public readonly maxSize: number,
  ) {}

  /** Never discards an already-accepted item to make room — once full, every further call simply reports `accepted: false` and marks this queue truncated. */
  enqueue(item: T): BoundedQueueEnqueueResult {
    if (this.items.length >= this.maxSize) {
      this.truncated = true;
      return { accepted: false };
    }
    this.items.push(item);
    return { accepted: true };
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }

  isTruncated(): boolean {
    return this.truncated;
  }
}

export interface ScanQueueTruncationSummary {
  truncated: boolean;
  /** The first queue (in Target/Page/API/Security Test order) found truncated — `scan_runs.truncation_limit_reached` records exactly this, never a vague "some limit was hit". */
  limitReached?: BoundedQueueName;
}

/** Bundles the four queues so the orchestrator has exactly one place to ask "was anything truncated, and which limit was it." */
export class ScanQueues {
  readonly target: BoundedQueue<unknown>;
  readonly page: BoundedQueue<unknown>;
  readonly api: BoundedQueue<unknown>;
  readonly securityTest: BoundedQueue<unknown>;

  constructor(bounds: { target: number; page: number; api: number; securityTest: number }) {
    this.target = new BoundedQueue("TARGET", bounds.target);
    this.page = new BoundedQueue("PAGE", bounds.page);
    this.api = new BoundedQueue("API", bounds.api);
    this.securityTest = new BoundedQueue("SECURITY_TEST", bounds.securityTest);
  }

  getTruncationSummary(): ScanQueueTruncationSummary {
    for (const queue of [this.target, this.page, this.api, this.securityTest]) {
      if (queue.isTruncated()) return { truncated: true, limitReached: queue.name };
    }
    return { truncated: false };
  }
}
