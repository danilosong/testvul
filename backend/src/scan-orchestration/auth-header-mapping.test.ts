import { describe, expect, it } from "vitest";
import { buildAuthHeaders } from "./auth-header-mapping";

describe("buildAuthHeaders (Section 14.2)", () => {
  it("builds a Bearer Authorization header", () => {
    expect(buildAuthHeaders("BEARER", "userA-token")).toEqual({ Authorization: "Bearer userA-token" });
  });

  it("builds an X-Api-Key header", () => {
    expect(buildAuthHeaders("API_KEY", "abc123")).toEqual({ "X-Api-Key": "abc123" });
  });

  it("builds a Cookie header from the full name=value pair", () => {
    expect(buildAuthHeaders("COOKIE", "session=userA-token")).toEqual({ Cookie: "session=userA-token" });
  });

  it("builds custom headers from a JSON object credential", () => {
    expect(buildAuthHeaders("CUSTOM_HEADERS", JSON.stringify({ "X-Tenant": "acme", "X-Trace": "1" }))).toEqual({
      "X-Tenant": "acme",
      "X-Trace": "1",
    });
  });

  it("returns no headers for a malformed CUSTOM_HEADERS credential, rather than guessing", () => {
    expect(buildAuthHeaders("CUSTOM_HEADERS", "not json")).toEqual({});
  });
});
