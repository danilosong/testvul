import { describe, expect, it } from "vitest";
import { classifyEndpoint } from "./endpoint-classifier";

describe("classifyEndpoint", () => {
  it("classifies a settings endpoint as CONFIGURATION with high priority, per the spec scenario", () => {
    const result = classifyEndpoint("/api/project/123/settings");
    expect(result.classification).toBe("CONFIGURATION");
    expect(result.priority).toBe(1);
  });

  it("classifies an auth endpoint as AUTH", () => {
    expect(classifyEndpoint("/api/auth/login").classification).toBe("AUTH");
  });

  it("classifies a plain user endpoint as USER", () => {
    expect(classifyEndpoint("/api/users/42").classification).toBe("USER");
  });

  it("classifies a plain project endpoint (no config keyword) as PROJECT", () => {
    const result = classifyEndpoint("/api/projects/123");
    expect(result.classification).toBe("PROJECT");
    expect(result.priority).toBe(1); // "project" is itself a configuration-priority keyword
  });

  it("classifies a plain campaign endpoint as CAMPAIGN", () => {
    expect(classifyEndpoint("/api/campaigns/5").classification).toBe("CAMPAIGN");
  });

  it("classifies a payment endpoint as PAYMENT", () => {
    expect(classifyEndpoint("/api/billing/invoices").classification).toBe("PAYMENT");
  });

  it("classifies the root path as PUBLIC", () => {
    expect(classifyEndpoint("/").classification).toBe("PUBLIC");
  });

  it("classifies a known public page as PUBLIC", () => {
    expect(classifyEndpoint("/about").classification).toBe("PUBLIC");
  });

  it("classifies an admin endpoint as ADMIN", () => {
    expect(classifyEndpoint("/admin/ranking").classification).toBe("ADMIN");
  });

  it("classifies an unrecognized endpoint as UNKNOWN with low priority", () => {
    const result = classifyEndpoint("/api/widgets/42");
    expect(result.classification).toBe("UNKNOWN");
    expect(result.priority).toBe(3);
  });

  it("gives non-configuration, non-public/unknown categories medium priority", () => {
    expect(classifyEndpoint("/api/auth/login").priority).toBe(2);
    expect(classifyEndpoint("/api/users/42").priority).toBe(2);
  });
});
