import { describe, expect, it } from "vitest";
import { generateSanitizerProbe, classifySanitizerProbe } from "./sanitizer-probe";
import { classifyStoredXss } from "./xss-canary";

describe("generateSanitizerProbe", () => {
  it("produces an inert marker — never real JavaScript, never rendered or executed", () => {
    const probe = generateSanitizerProbe();
    expect(probe.payload).toContain(`onerror="PROBE_${probe.uuid}"`);
    expect(probe.payload).toContain(`<script data-security-probe-tag="${probe.uuid}">`);
    expect(probe.payload).not.toMatch(/alert\(|document\.|window\./);
  });
});

describe("classifySanitizerProbe", () => {
  it("classifies UNSAFE_ATTRIBUTE_SURVIVED when the event-handler attribute survives verbatim, without executing anything", () => {
    const probe = generateSanitizerProbe();
    expect(classifySanitizerProbe(probe.payload, probe.uuid)).toBe("UNSAFE_ATTRIBUTE_SURVIVED");
  });

  it("classifies POTENTIALLY_EXECUTABLE when a disallowed <script> tag survives but the attribute was stripped", () => {
    const probe = generateSanitizerProbe();
    const withAttributeStripped = `<img src="x" data-security-probe="${probe.uuid}"><script data-security-probe-tag="${probe.uuid}">/*NOOP_${probe.uuid}*/</script>`;
    expect(classifySanitizerProbe(withAttributeStripped, probe.uuid)).toBe("POTENTIALLY_EXECUTABLE");
  });

  it("classifies SAFE when neither the attribute nor the script tag survives", () => {
    const probe = generateSanitizerProbe();
    expect(classifySanitizerProbe("", probe.uuid)).toBe("SAFE");
  });

  it("classifies SAFE when the markup is escaped rather than surviving as live attributes/tags", () => {
    const probe = generateSanitizerProbe();
    const escaped = probe.payload.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    expect(classifySanitizerProbe(escaped, probe.uuid)).toBe("SAFE");
  });
});

describe("the base canary alone can never produce UNSAFE_ATTRIBUTE_SURVIVED or POTENTIALLY_EXECUTABLE", () => {
  it("classifyStoredXss's result type structurally excludes both states", () => {
    // classifyStoredXss's return type is XssCanaryVerdict, which has no
    // UNSAFE_ATTRIBUTE_SURVIVED/POTENTIALLY_EXECUTABLE member at all — so
    // no possible input can make it produce one. Exercise a representative
    // spread of inputs (including ones containing the probe's own event-handler
    // shape) and confirm every result stays within the base four states.
    const baseStates = new Set(["REMOVED", "ESCAPED", "HTML_ALLOWED", "RAW_HTML"]);
    const probe = generateSanitizerProbe();

    for (const body of ["", "some text", probe.payload, "<strong>plain</strong>"]) {
      expect(baseStates.has(classifyStoredXss(body, "some-uuid"))).toBe(true);
    }
  });
});
