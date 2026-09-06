import { describe, expect, it } from "vitest";
import { sanitizeEvidence, fingerprint } from "./sanitize-evidence";

describe("sanitizeEvidence", () => {
  it("redacts an email address embedded in a response body field, regardless of the field's name", () => {
    const sanitized = sanitizeEvidence({ bio: "Contact me at jane.doe@example.com for details" });
    expect(sanitized.bio).not.toContain("jane.doe@example.com");
    expect(sanitized.bio).toContain("[REDACTED_EMAIL]");
  });

  it("redacts a Brazilian CPF-style national-ID string", () => {
    const sanitized = sanitizeEvidence({ document: "CPF: 123.456.789-09 on file" });
    expect(sanitized.document).not.toContain("123.456.789-09");
    expect(sanitized.document).toContain("[REDACTED_ID]");
  });

  it("redacts an address-like string", () => {
    const sanitized = sanitizeEvidence({ shippingInfo: "Ship to 742 Evergreen Terrace Street, please" });
    expect(sanitized.shippingInfo).toContain("[REDACTED_ADDRESS]");
  });

  it("redacts a phone number embedded in text", () => {
    const sanitized = sanitizeEvidence({ note: "call me at 555-123-4567 anytime" });
    expect(sanitized.note).not.toContain("555-123-4567");
    expect(sanitized.note).toContain("[REDACTED_PHONE]");
  });

  it("still fully masks a known-sensitive key name (credential masking is preserved)", () => {
    const sanitized = sanitizeEvidence({ password: "super-secret-value-1234" });
    expect(sanitized.password).not.toBe("super-secret-value-1234");
  });

  it("walks nested objects and arrays", () => {
    const sanitized = sanitizeEvidence({
      users: [{ email: "a@b.com", contact: "reach a@b.com anytime" }, { contact: "no pii here" }],
    });
    expect(JSON.stringify(sanitized)).not.toContain("a@b.com");
  });

  it("redacts PII even when a scanner passes raw data with no masking logic of its own", () => {
    // Simulates a scanner that does nothing but forward whatever the
    // upstream server returned — the sanitization is not something the
    // scanner opted into.
    const rawScannerOutput = { response: { body: '{"supportEmail":"user@customer.example"}' } };
    const sanitized = sanitizeEvidence(rawScannerOutput);
    expect(sanitized.response.body).not.toContain("user@customer.example");
  });

  it("does not mutate the input", () => {
    const input = { email: "keep@example.com" };
    sanitizeEvidence(input);
    expect(input.email).toBe("keep@example.com");
  });
});

describe("fingerprint", () => {
  it("produces the same fingerprint for identical content", () => {
    const a = fingerprint({ id: 42, owner: "user-a" });
    const b = fingerprint({ id: 42, owner: "user-a" });
    expect(a).toBe(b);
  });

  it("produces a different fingerprint for different content", () => {
    const a = fingerprint({ id: 42, owner: "user-a" });
    const b = fingerprint({ id: 42, owner: "user-b" });
    expect(a).not.toBe(b);
  });

  it("supports IDOR comparison via fingerprint instead of raw content", () => {
    // A response body fetched twice against the same resource under two
    // different auth profiles: comparing fingerprints proves they
    // reference identical underlying content without ever needing to
    // store or diff the raw bodies (which could contain PII).
    const responseAsUserA = JSON.stringify({ projectId: 456, name: "Confidential Project", owner: "user-a" });
    const responseAsUserB = JSON.stringify({ projectId: 456, name: "Confidential Project", owner: "user-a" });
    expect(fingerprint(responseAsUserB)).toBe(fingerprint(responseAsUserA));

    const responseForDifferentProject = JSON.stringify({ projectId: 789, name: "Other Project", owner: "user-b" });
    expect(fingerprint(responseForDifferentProject)).not.toBe(fingerprint(responseAsUserA));
  });

  it("does not reveal the original content", () => {
    const hash = fingerprint("some very sensitive raw content");
    expect(hash).not.toContain("sensitive");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
