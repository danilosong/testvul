import { describe, expect, it } from "vitest";
import { maskSecret, maskSecrets } from "./mask-secrets";

describe("maskSecret", () => {
  it("keeps a short prefix/suffix visible and masks the rest", () => {
    expect(maskSecret("eyJhbGciOiJIUzI1NiJ9.abc.def")).toBe("eyJhbG*****.def");
  });

  it("masks a short value entirely rather than revealing any part of it", () => {
    expect(maskSecret("abc123")).toBe("******");
  });
});

describe("maskSecrets", () => {
  it("masks a token in serialized output while leaving the original object completely unmodified", () => {
    const original = { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.abc.def" }, url: "/api/me" };
    const originalSnapshot = structuredClone(original);

    const serialized = maskSecrets(original);

    expect(serialized.headers.Authorization).not.toBe(original.headers.Authorization);
    expect(serialized.headers.Authorization).toMatch(/\*{5}/);
    expect(serialized.url).toBe("/api/me"); // non-sensitive fields pass through unchanged

    // The in-memory value a caller would still use to actually issue a
    // request remains complete — maskSecrets never mutates its input.
    expect(original).toEqual(originalSnapshot);
    expect(original.headers.Authorization).toBe("Bearer eyJhbGciOiJIUzI1NiJ9.abc.def");
  });

  it("masks known sensitive keys at any nesting depth", () => {
    const result = maskSecrets({
      request: { headers: { Cookie: "session=abcdef123456" } },
      profile: { credential: "super-secret-token-value" },
    });
    expect(result.request.headers.Cookie).not.toContain("abcdef123456");
    expect(result.profile.credential).not.toContain("super-secret-token-value");
  });

  it("masks sensitive values inside an array of objects", () => {
    const result = maskSecrets([{ apiKey: "abcdefghijklmnop" }, { name: "not sensitive" }]);
    expect(result[0]!.apiKey).not.toBe("abcdefghijklmnop");
    expect(result[1]!.name).toBe("not sensitive");
  });

  it("does not mask a non-sensitive key even with a token-shaped value", () => {
    const result = maskSecrets({ projectName: "Bearer-themed-project" });
    expect(result.projectName).toBe("Bearer-themed-project");
  });

  it("passes through primitives and null unchanged", () => {
    expect(maskSecrets(42)).toBe(42);
    expect(maskSecrets(true)).toBe(true);
    expect(maskSecrets(null)).toBe(null);
    expect(maskSecrets("plain string")).toBe("plain string");
  });
});
