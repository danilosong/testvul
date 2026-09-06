import { describe, expect, it } from "vitest";
import { detectPathIdentifiers, detectQueryIdentifiers, detectBodyIdentifiers, detectObjectIdentifiers } from "./object-identifier-detection";

describe("detectPathIdentifiers", () => {
  it("detects a projectId from a REST-style path segment pair", () => {
    expect(detectPathIdentifiers("/api/projects/123")).toEqual([{ location: "PATH", name: "projectId", value: "123" }]);
  });

  it("detects multiple identifiers in a nested path", () => {
    expect(detectPathIdentifiers("/api/users/42/orders/99")).toEqual([
      { location: "PATH", name: "userId", value: "42" },
      { location: "PATH", name: "orderId", value: "99" },
    ]);
  });

  it("finds nothing in a path with no known resource-type segment", () => {
    expect(detectPathIdentifiers("/api/health")).toEqual([]);
  });
});

describe("detectQueryIdentifiers", () => {
  it("detects an identifier passed as a query parameter", () => {
    expect(detectQueryIdentifiers("https://example.com/api/reports?tenantId=acme")).toEqual([
      { location: "QUERY", name: "tenantId", value: "acme" },
    ]);
  });

  it("ignores unrelated query parameters", () => {
    expect(detectQueryIdentifiers("https://example.com/api/reports?sort=desc&page=2")).toEqual([]);
  });
});

describe("detectBodyIdentifiers", () => {
  it("detects an identifier field at the top level of a JSON body", () => {
    expect(detectBodyIdentifiers({ campaignId: "c-1", name: "Summer Sale" })).toEqual([
      { location: "BODY", name: "campaignId", value: "c-1" },
    ]);
  });

  it("detects an identifier field nested inside an object", () => {
    expect(detectBodyIdentifiers({ owner: { organizationId: "org-9" } })).toEqual([
      { location: "BODY", name: "owner.organizationId", value: "org-9" },
    ]);
  });

  it("detects identifier fields inside array elements", () => {
    expect(detectBodyIdentifiers({ orders: [{ orderId: "o-1" }, { orderId: "o-2" }] })).toEqual([
      { location: "BODY", name: "orders[0].orderId", value: "o-1" },
      { location: "BODY", name: "orders[1].orderId", value: "o-2" },
    ]);
  });

  it("finds nothing in a body with no identifier-shaped fields", () => {
    expect(detectBodyIdentifiers({ title: "Hello", published: true })).toEqual([]);
  });
});

describe("detectObjectIdentifiers", () => {
  it("detects identifiers across path, query, and body at once", () => {
    const result = detectObjectIdentifiers("https://example.com/api/projects/123?tenantId=acme", { ownerId: "u-1" });
    expect(result).toEqual(
      expect.arrayContaining([
        { location: "PATH", name: "projectId", value: "123" },
        { location: "QUERY", name: "tenantId", value: "acme" },
        { location: "BODY", name: "ownerId", value: "u-1" },
      ]),
    );
  });
});
