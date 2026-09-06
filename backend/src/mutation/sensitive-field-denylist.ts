/** Applies to DEVELOPMENT, STAGING, and PRODUCTION targets with no
 * exception or bypass available — Section 9.13's LOCAL_FIXTURE Test
 * Capability is the one narrow, non-product-surfaced exception. */
export const SENSITIVE_FIELD_DENYLIST = [
  "balance",
  "payment",
  "price",
  "password",
  "winner",
  "financialStatus",
  "withdrawal",
  "credit",
  "prize",
];

const LOWERCASE_DENYLIST = SENSITIVE_FIELD_DENYLIST.map((word) => word.toLowerCase());

function lastSegment(fieldPath: string): string {
  return (fieldPath.split(".").pop() ?? fieldPath).toLowerCase();
}

export function isDenylistedField(fieldPath: string): boolean {
  const segment = lastSegment(fieldPath);
  return LOWERCASE_DENYLIST.some((word) => segment.includes(word));
}

export class DenylistedFieldError extends Error {
  constructor(public readonly fieldPath: string) {
    super(`Field "${fieldPath}" matches the sensitive-field denylist and cannot be automatically mutated`);
    this.name = "DenylistedFieldError";
  }
}

export interface LocalFixtureTestCapabilityContext {
  targetEnvironment: string;
  /** From `config.localFixtureTestCapability` — set only by the test/build harness, never a production build. */
  testCapabilityEnabled: boolean;
}

/**
 * The mutation entry-point guard every mutation-initiating subsystem must
 * call before mutating a field. Structurally, no caller can get past this
 * function for a denylisted field without it throwing first — with exactly
 * one narrow exception: the LOCAL_FIXTURE Test Capability (Section 9.13,
 * design.md Decision 52), which lifts the denylist only when the target's
 * Environment Classification is LOCAL_FIXTURE AND the test/build-harness
 * flag is set. There is no ordinary UI/API path that can supply this
 * context — it exists only as a caller-supplied parameter used by the test
 * suite itself.
 */
export function assertFieldNotDenylisted(fieldPath: string, localFixtureContext?: LocalFixtureTestCapabilityContext): void {
  if (!isDenylistedField(fieldPath)) return;
  if (localFixtureContext?.targetEnvironment === "LOCAL_FIXTURE" && localFixtureContext.testCapabilityEnabled) {
    return;
  }
  throw new DenylistedFieldError(fieldPath);
}
