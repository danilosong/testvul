import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { hashContent } from "../backup/backup-engine";
import { mutateField } from "../mutation/request-mutator";
import { restoreResource } from "./restore-engine";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let client: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
});

afterAll(async () => {
  await servers.stop();
});

const ETAG_URL = () => `http://127.0.0.1:${ports.httpPort}/api/resources/etag/etag-1`;
const PLAIN_URL = () => `http://127.0.0.1:${ports.httpPort}/api/resources/plain/plain-1`;

describe("restoreResource against the fixture app's ETag-supporting and no-signal endpoints", () => {
  it("produces RESTORE_OK for a successful restore via the ETag concurrency signal, per the spec scenario", async () => {
    const before = await client.request(ETAG_URL());
    const originalContentHash = hashContent(before.body);
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-value");

    const mutateRes = await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-value" }),
    });
    const etagAfterMutation = mutateRes.headers.etag as string;

    const result = await restoreResource({
      requester: client,
      resourceUrl: ETAG_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash,
      expectedPostMutationState,
      concurrencySignalAfterMutation: { type: "etag", value: etagAfterMutation },
    });

    expect(result.outcome).toBe("RESTORE_OK");
    const after = await client.request(ETAG_URL());
    expect(JSON.parse(after.body).value).toBe("original-value");
  });

  it("produces RESTORE_FAILED when the restored content's hash does not match the backup hash, per the spec scenario", async () => {
    const before = await client.request(ETAG_URL());
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-value-2");

    const mutateRes = await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-value-2" }),
    });

    const result = await restoreResource({
      requester: client,
      resourceUrl: ETAG_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash: hashContent("some completely different snapshot content"), // deliberately wrong
      expectedPostMutationState,
      concurrencySignalAfterMutation: { type: "etag", value: mutateRes.headers.etag as string },
    });

    expect(result.outcome).toBe("RESTORE_FAILED");
  });

  it("produces RESTORE_CONFLICT when the ETag shows an external change happened since the mutation, per the spec scenario", async () => {
    const before = await client.request(ETAG_URL());
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-value-3");

    const mutateRes = await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-value-3" }),
    });
    const etagAfterMutation = mutateRes.headers.etag as string;

    // Simulate a legitimate external change happening after our mutation.
    await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": etagAfterMutation, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "changed-by-someone-else" }),
    });

    const result = await restoreResource({
      requester: client,
      resourceUrl: ETAG_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash: hashContent(before.body),
      expectedPostMutationState,
      concurrencySignalAfterMutation: { type: "etag", value: etagAfterMutation }, // now stale
    });

    expect(result.outcome).toBe("RESTORE_CONFLICT");
    // The external change was never overwritten.
    const after = await client.request(ETAG_URL());
    expect(JSON.parse(after.body).value).toBe("changed-by-someone-else");
  });

  it("produces RESTORE_CONFLICT via fallback comparison when the target has no concurrency signal at all, per the spec scenario", async () => {
    const before = await client.request(PLAIN_URL());
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-plain-value");

    await client.request(PLAIN_URL(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-plain-value" }),
    });

    // No signal exists for this endpoint at all, and something else
    // changed the resource in the meantime (simulated directly here).
    await client.request(PLAIN_URL(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "changed-by-someone-else" }),
    });

    const result = await restoreResource({
      requester: client,
      resourceUrl: PLAIN_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash: hashContent(before.body),
      expectedPostMutationState,
      // no concurrencySignalAfterMutation — this endpoint has none
    });

    expect(result.outcome).toBe("RESTORE_CONFLICT");
    const after = await client.request(PLAIN_URL());
    expect(JSON.parse(after.body).value).toBe("changed-by-someone-else"); // not overwritten
  });

  it("still succeeds via fallback comparison when nothing else changed and no signal exists", async () => {
    // Reset the plain resource to a known state first (previous test left it modified).
    await client.request(PLAIN_URL(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "original-value" }),
    });

    const before = await client.request(PLAIN_URL());
    const originalBody = JSON.parse(before.body);
    const { expectedPostMutationState } = mutateField(originalBody, "value", "mutated-plain-value-2");

    await client.request(PLAIN_URL(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-plain-value-2" }),
    });

    const result = await restoreResource({
      requester: client,
      resourceUrl: PLAIN_URL(),
      fieldPath: "value",
      originalValue: "original-value",
      originalContentHash: hashContent(before.body),
      expectedPostMutationState,
    });

    expect(result.outcome).toBe("RESTORE_OK");
  });
});
