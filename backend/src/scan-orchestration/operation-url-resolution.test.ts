import { describe, expect, it } from "vitest";
import { resolveOperationUrl } from "./operation-url-resolution";

describe("resolveOperationUrl (Section 14.2)", () => {
  it("replaces a single path parameter with the concrete resource id", () => {
    expect(resolveOperationUrl("http://127.0.0.1:3000", "/api/projects/{id}", "1")).toBe("http://127.0.0.1:3000/api/projects/1");
  });

  it("replaces every path-parameter-shaped segment, whatever its name", () => {
    expect(resolveOperationUrl("http://127.0.0.1:3000", "/api/tickets/{ticketId}", "7")).toBe("http://127.0.0.1:3000/api/tickets/7");
  });

  it("leaves a template with no path parameters unchanged", () => {
    expect(resolveOperationUrl("http://127.0.0.1:3000", "/api/settings", "1")).toBe("http://127.0.0.1:3000/api/settings");
  });
});
