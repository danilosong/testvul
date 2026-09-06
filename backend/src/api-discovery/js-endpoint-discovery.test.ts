import { describe, expect, it } from "vitest";
import { discoverJsEndpoints } from "./js-endpoint-discovery";

describe("discoverJsEndpoints", () => {
  it("discovers a GET endpoint from a plain fetch() call, per the spec scenario", () => {
    const result = discoverJsEndpoints('fetch("/api/settings")');
    expect(result).toEqual([{ method: "GET", path: "/api/settings" }]);
  });

  it("discovers the method from fetch()'s options object", () => {
    const result = discoverJsEndpoints('fetch("/api/settings", { method: "PATCH", body: JSON.stringify(x) })');
    expect(result).toEqual([{ method: "PATCH", path: "/api/settings" }]);
  });

  it("discovers an axios.<method>() call", () => {
    const result = discoverJsEndpoints('axios.patch("/api/projects/1", body)');
    expect(result).toEqual([{ method: "PATCH", path: "/api/projects/1" }]);
  });

  it("captures only the static literal prefix of a concatenated path, never evaluating it", () => {
    const result = discoverJsEndpoints('axios.patch("/api/projects/" + id, body)');
    expect(result).toEqual([{ method: "PATCH", path: "/api/projects/" }]);
  });

  it("finds multiple call sites in the same source", () => {
    const source = `
      function a() { return fetch("/api/one"); }
      function b() { return axios.post("/api/two", {}); }
    `;
    const result = discoverJsEndpoints(source);
    expect(result).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/api/one" },
        { method: "POST", path: "/api/two" },
      ]),
    );
  });

  it("never executes the source — only text pattern matching", () => {
    expect(() => discoverJsEndpoints('fetch("/api/x"); throw new Error("would blow up if executed");')).not.toThrow();
  });

  it("returns an empty list for source with no fetch/axios calls", () => {
    expect(discoverJsEndpoints("const x = 1;")).toEqual([]);
  });
});
