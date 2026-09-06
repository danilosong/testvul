import { describe, expect, it } from "vitest";
import { operationsFromForms } from "./form-operations";
import { hasEligibleOperation } from "./discovered-operation";
import { ScopeValidator, ScopeViolationError } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import type { ExtractedForm } from "../crawler/html-extractor";

describe("operationsFromForms", () => {
  it("creates a HTML_FORM operation from a form with an explicit method, per the spec scenario", () => {
    const form: ExtractedForm = {
      action: "http://example.com/profile",
      method: "POST",
      hasExplicitMethod: true,
      inputNames: ["name", "bio"],
      enctype: "application/x-www-form-urlencoded",
    };

    const [operation] = operationsFromForms([form]);

    expect(operation).toEqual({
      method: "POST",
      url: "http://example.com/profile",
      contentType: "application/x-www-form-urlencoded",
      requestSchema: { fields: ["name", "bio"] },
      source: "HTML_FORM",
      confidence: "HIGH",
    });
  });

  it("assigns MEDIUM confidence when the form's method was defaulted rather than declared", () => {
    const form: ExtractedForm = {
      action: "http://example.com/search",
      method: "GET",
      hasExplicitMethod: false,
      inputNames: ["q"],
      enctype: "application/x-www-form-urlencoded",
    };
    const [operation] = operationsFromForms([form]);
    expect(operation?.confidence).toBe("MEDIUM");
  });

  it("discovering a form is not authorization to mutate: the resulting operation is still blocked by scope validation when actually attempted", async () => {
    const form: ExtractedForm = {
      action: "http://not-authorized.com/profile",
      method: "POST",
      hasExplicitMethod: true,
      inputNames: ["name"],
      enctype: "application/x-www-form-urlencoded",
    };
    const [operation] = operationsFromForms([form]);

    // The operation is a perfectly valid, eligible write template by itself...
    expect(hasEligibleOperation([operation!], "POST", operation!.url, "HIGH")).toBe(true);

    // ...but actually issuing it still goes through the full mandatory
    // scope gate, which has never been told this host is authorized.
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]) });
    await expect(client.request(operation!.url, { method: operation!.method })).rejects.toThrow(ScopeViolationError);
  });
});
