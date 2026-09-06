import { describe, expect, it } from "vitest";
import { isApiReference } from "./api-reference-detector";

describe("isApiReference", () => {
  it("recognizes /api/ references", () => {
    expect(isApiReference("/api/settings")).toBe(true);
  });

  it("recognizes /api/v1/ references", () => {
    expect(isApiReference("/api/v1/users")).toBe(true);
  });

  it("recognizes /graphql references", () => {
    expect(isApiReference("/graphql")).toBe(true);
    expect(isApiReference("http://example.com/graphql")).toBe(true);
  });

  it("does not flag an unrelated path", () => {
    expect(isApiReference("/about")).toBe(false);
    expect(isApiReference("/graphqlsomething")).toBe(false);
  });
});
