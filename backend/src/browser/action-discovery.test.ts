import { describe, expect, it } from "vitest";
import { classifyActionLabel } from "./action-discovery";

describe("classifyActionLabel", () => {
  it("classifies 'Save Settings' as SAFE_MUTATION", () => {
    expect(classifyActionLabel("Save Settings")).toBe("SAFE_MUTATION");
  });

  it("classifies 'Delete Account' as DESTRUCTIVE", () => {
    expect(classifyActionLabel("Delete Account")).toBe("DESTRUCTIVE");
  });

  it("classifies a withdrawal-shaped label as DESTRUCTIVE — it's on the absolute Destructive Action Denylist (Section 12.16)", () => {
    expect(classifyActionLabel("Withdraw Funds")).toBe("DESTRUCTIVE");
  });

  it("classifies a password-shaped label as SENSITIVE_MUTATION (not on the destructive denylist)", () => {
    expect(classifyActionLabel("Change Password")).toBe("SENSITIVE_MUTATION");
  });

  it("classifies a read-only-shaped label as SAFE_READ", () => {
    expect(classifyActionLabel("View Report")).toBe("SAFE_READ");
  });

  it("classifies an unrecognized label as UNKNOWN rather than guessing safe", () => {
    expect(classifyActionLabel("Go")).toBe("UNKNOWN");
  });

  it("prioritizes DESTRUCTIVE over a co-occurring sensitive keyword", () => {
    expect(classifyActionLabel("Delete Payment Method")).toBe("DESTRUCTIVE");
  });
});
