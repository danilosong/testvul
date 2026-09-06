import { describe, expect, it } from "vitest";
import { runReadIdorTest } from "./read-idor-test";
import type { RestoreRequester } from "../../restore/restore-engine";

function fakeRequester(status: number, body: string): RestoreRequester {
  return { request: async () => ({ status, headers: {}, body }) };
}

const BASE_PARAMS = {
  resourceUrl: "https://example.com/api/projects/1",
  resourceIdFieldPath: "id",
  expectedResourceId: "1",
  ownerFieldPath: "owner",
  expectedOwnerId: "userA",
};

describe("runReadIdorTest", () => {
  it("classifies PROTECTED for a 403", async () => {
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester: fakeRequester(403, "{}") });
    expect(result.outcome).toBe("PROTECTED");
  });

  it("classifies PROTECTED for a 404", async () => {
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester: fakeRequester(404, "{}") });
    expect(result.outcome).toBe("PROTECTED");
  });

  it("classifies POTENTIAL_BOLA on 200 when both the resource id and owner id genuinely match", async () => {
    const requester = fakeRequester(200, JSON.stringify({ id: "1", owner: "userA", name: "Alpha" }));
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester });
    expect(result.outcome).toBe("POTENTIAL_BOLA");
  });

  it("classifies NO_FINDING on 200 with a generic/non-matching body (a common false-positive shape)", async () => {
    const requester = fakeRequester(200, JSON.stringify({ error: "not found", message: "generic response" }));
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester });
    expect(result.outcome).toBe("NO_FINDING");
  });

  it("classifies NO_FINDING on 200 when the owner doesn't match, even if the resource id does", async () => {
    const requester = fakeRequester(200, JSON.stringify({ id: "1", owner: "someone-else" }));
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester });
    expect(result.outcome).toBe("NO_FINDING");
  });

  it("classifies NO_FINDING on 200 with a non-object body", async () => {
    const requester = fakeRequester(200, JSON.stringify(["not", "an", "object"]));
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester });
    expect(result.outcome).toBe("NO_FINDING");
  });

  it("classifies NO_FINDING on 200 with an unparseable body", async () => {
    const requester = fakeRequester(200, "not json");
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester });
    expect(result.outcome).toBe("NO_FINDING");
  });

  it("classifies NO_FINDING for an unrelated error status", async () => {
    const requester = fakeRequester(500, "{}");
    const result = await runReadIdorTest({ ...BASE_PARAMS, requester });
    expect(result.outcome).toBe("NO_FINDING");
  });
});
