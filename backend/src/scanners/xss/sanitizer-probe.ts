import { randomUUID } from "node:crypto";

export type SanitizerProbeVerdict = "UNSAFE_ATTRIBUTE_SURVIVED" | "POTENTIALLY_EXECUTABLE" | "SAFE";

export interface SanitizerProbe {
  uuid: string;
  /** An inert, non-executing marker combining an event-handler-shaped
   * attribute (on an `<img>`, never rendered/loaded) and a disallowed
   * `<script>` tag — both carry only benign marker text, never real
   * JavaScript, and neither is ever rendered or executed by this probe. */
  payload: string;
}

/**
 * The Sanitizer Probe (design.md — `scanners-xss-gtm-idor`'s Sanitizer
 * Probe requirement): a distinct safe-canary variant from the base
 * `<strong>` canary (Section 11.2), purpose-built to reach
 * UNSAFE_ATTRIBUTE_SURVIVED / POTENTIALLY_EXECUTABLE — classifications the
 * base canary structurally cannot produce, since it contains no
 * event-handler attribute or disallowed tag to check the survival of.
 */
export function generateSanitizerProbe(): SanitizerProbe {
  const uuid = randomUUID();
  return {
    uuid,
    payload: `<img src="x" onerror="PROBE_${uuid}" data-security-probe="${uuid}"><script data-security-probe-tag="${uuid}">/*NOOP_${uuid}*/</script>`,
  };
}

/**
 * Classifies the Sanitizer Probe's outcome by static text/DOM inspection
 * of the retrieved (decoded) field value only — never by rendering or
 * executing anything in a browser.
 */
export function classifySanitizerProbe(fieldValue: string, uuid: string): SanitizerProbeVerdict {
  const attributeSurvived =
    new RegExp(`onerror\\s*=\\s*"[^"]*PROBE_${uuid}[^"]*"`, "i").test(fieldValue) ||
    new RegExp(`onerror\\s*=\\s*'[^']*PROBE_${uuid}[^']*'`, "i").test(fieldValue);
  if (attributeSurvived) return "UNSAFE_ATTRIBUTE_SURVIVED";

  const scriptTagSurvived = new RegExp(`<script[^>]*data-security-probe-tag="${uuid}"[^>]*>`, "i").test(fieldValue);
  if (scriptTagSurvived) return "POTENTIALLY_EXECUTABLE";

  return "SAFE";
}
