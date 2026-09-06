import { describe, expect, it } from "vitest";
import { generateCandidates, priorityFor } from "./candidate-generator";

describe("priorityFor / generateCandidates", () => {
  it("assigns Priority 1 to an HTML field candidate, per the spec scenario", () => {
    const [candidate] = generateCandidates([{ path: "certificate.certificateText", value: "<p>x</p>" }], "/api/certs/1");
    expect(candidate!.priority).toBe(1);
    expect(candidate!.scanner).toBe("XSS");
  });

  it("assigns Priority 3 to a purely informational Boolean config flag, per the spec scenario", () => {
    const [candidate] = generateCandidates([{ path: "settings.darkModeEnabled", value: true }], "/api/settings");
    expect(candidate!.priority).toBe(3);
    expect(candidate!.scanner).toBe("INFORMATIONAL");
  });

  it("assigns Priority 1 to a GTM field", () => {
    expect(priorityFor("analytics.gtmId", "GTM-ABC123")).toBe(1);
  });

  it("assigns Priority 1 to an authorization-boundary identifier", () => {
    expect(priorityFor("project.tenantId", "42")).toBe(1);
    expect(priorityFor("project.ownerId", "42")).toBe(1);
  });

  it("does not assign Priority 1 to a non-boundary identifier", () => {
    expect(priorityFor("comment.commentId", "42")).not.toBe(1);
  });

  it("assigns Priority 2 to a URL field", () => {
    expect(priorityFor("imageUrl", "https://cdn.example.com/x.png")).toBe(2);
  });

  it("assigns Priority 2 to an affiliate identifier field", () => {
    expect(priorityFor("user.affiliateId", "aff-42")).toBe(2);
  });

  it("assigns Priority 2 to an authentication metadata field", () => {
    expect(priorityFor("user.role", "admin")).toBe(2);
  });

  it("assigns Priority 3 to plain informational strings/numbers", () => {
    expect(priorityFor("project.description", "hello")).toBe(3);
    expect(priorityFor("settings.maxItems", 10)).toBe(3);
  });

  it("generates one candidate per analyzed field, preserving field path and endpoint", () => {
    const candidates = generateCandidates(
      [
        { path: "bio", value: "<b>hi</b>" },
        { path: "name", value: "Alice" },
      ],
      "/api/users/1",
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.endpoint === "/api/users/1")).toBe(true);
  });
});
