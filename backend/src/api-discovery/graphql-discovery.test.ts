import { describe, expect, it } from "vitest";
import { identifyGraphQlEndpoint, type GraphQlRequester } from "./graphql-discovery";

describe("identifyGraphQlEndpoint", () => {
  it("identifies a GraphQL endpoint from its query-required error shape", async () => {
    const client: GraphQlRequester = {
      request: async () => ({ status: 400, body: JSON.stringify({ errors: [{ message: "Must provide query string." }] }) }),
    };
    const result = await identifyGraphQlEndpoint(client, "http://example.com/graphql");
    expect(result.isGraphQlEndpoint).toBe(true);
  });

  it("never sends an introspection query — only calls request(url) with no body or query params", async () => {
    const calls: { url: string; argCount: number }[] = [];
    const client: GraphQlRequester = {
      request: async (url, ...rest) => {
        calls.push({ url, argCount: rest.length });
        return { status: 400, body: JSON.stringify({ errors: [{ message: "Must provide query string." }] }) };
      },
    };
    await identifyGraphQlEndpoint(client, "http://example.com/graphql");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://example.com/graphql");
    expect(calls[0]!.url).not.toMatch(/__schema|IntrospectionQuery|query=/);
    expect(calls[0]!.argCount).toBe(0); // no body/init object of any kind was passed
  });

  it("does not identify a non-GraphQL JSON error response as GraphQL", async () => {
    const client: GraphQlRequester = { request: async () => ({ status: 404, body: JSON.stringify({ error: "NOT_FOUND" }) }) };
    const result = await identifyGraphQlEndpoint(client, "http://example.com/graphql");
    expect(result.isGraphQlEndpoint).toBe(false);
  });

  it("does not throw on a non-JSON response", async () => {
    const client: GraphQlRequester = { request: async () => ({ status: 200, body: "<html>not graphql</html>" }) };
    const result = await identifyGraphQlEndpoint(client, "http://example.com/graphql");
    expect(result.isGraphQlEndpoint).toBe(false);
  });
});
