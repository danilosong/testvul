import { describe, expect, it } from "vitest";
import { classifyField } from "./field-classifier";

describe("classifyField", () => {
  it("classifies HTML content as HTML, per the spec scenario", () => {
    expect(classifyField("certificate.certificateText", "<p>Some rich text</p>")).toBe("HTML");
  });

  it("classifies a field ending in gtmId as GTM, per the spec scenario", () => {
    expect(classifyField("analytics.gtmId", "anything")).toBe("GTM");
  });

  it("classifies a value matching the GTM container pattern as GTM even without a matching field name", () => {
    expect(classifyField("analytics.container", "GTM-NPN9598R")).toBe("GTM");
  });

  it("classifies a URL value as URL", () => {
    expect(classifyField("imageUrl", "https://cdn.example.com/logo.png")).toBe("URL");
  });

  it("classifies an identifier field as IDENTIFIER", () => {
    expect(classifyField("project.userId", "42")).toBe("IDENTIFIER");
    expect(classifyField("project.id", "550e8400-e29b-41d4-a716-446655440000")).toBe("IDENTIFIER");
  });

  it("classifies a pixel field as PIXEL", () => {
    expect(classifyField("tracking.fbPixelId", "1234567890123456")).toBe("PIXEL");
  });

  it("classifies an email address as EMAIL", () => {
    expect(classifyField("user.contact", "person@example.com")).toBe("EMAIL");
  });

  it("classifies a phone-shaped field as PHONE", () => {
    expect(classifyField("user.phoneNumber", "+1 (555) 123-4567")).toBe("PHONE");
  });

  it("classifies a boolean value as BOOLEAN", () => {
    expect(classifyField("settings.enabled", true)).toBe("BOOLEAN");
  });

  it("classifies a numeric value as NUMBER", () => {
    expect(classifyField("settings.maxItems", 10)).toBe("NUMBER");
  });

  it("classifies a plain string as GENERIC_STRING", () => {
    expect(classifyField("project.name", "My Project")).toBe("GENERIC_STRING");
  });
});
