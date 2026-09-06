import { createHash } from "node:crypto";

function splitPath(path: string): string[] {
  return path.split(".");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setByPath(obj: any, path: string, value: unknown): void {
  const segments = splitPath(path);
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]!];
  }
  current[segments[segments.length - 1]!] = value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getByPath(obj: any, path: string): unknown {
  return splitPath(path).reduce((current, segment) => current?.[segment], obj);
}

/** Sorts object keys recursively so the same logical value always produces
 * the same string, regardless of property insertion order. */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprintExcluding(obj: unknown, excludePath: string): string {
  const clone = structuredClone(obj);
  setByPath(clone, excludePath, "__MUTATED_FIELD_EXCLUDED__");
  return createHash("sha256").update(canonicalStringify(clone)).digest("hex");
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

/** What the scanner expects to find if it reads the resource back after
 * mutating it — used by Restore's fallback verification (Section 9.4) when
 * the target exposes no optimistic-concurrency signal. */
export interface MutationExpectedState {
  fieldPath: string;
  testValue: unknown;
  otherFieldsFingerprint: string;
}

export interface MutationResult {
  mutatedBody: unknown;
  expectedPostMutationState: MutationExpectedState;
}

/**
 * Changes only `fieldPath` on a structural (parsed-JSON) clone of
 * `originalBody` — every sibling field and unrelated array is carried over
 * by value, so it is unaffected by re-serialization differences
 * (whitespace/key order/escaping) and can never have its type or contents
 * altered by this function.
 */
export function mutateField(originalBody: unknown, fieldPath: string, testValue: unknown): MutationResult {
  const mutatedBody = structuredClone(originalBody);
  setByPath(mutatedBody, fieldPath, testValue);
  return {
    mutatedBody,
    expectedPostMutationState: {
      fieldPath,
      testValue,
      otherFieldsFingerprint: fingerprintExcluding(mutatedBody, fieldPath),
    },
  };
}

/** True if `currentBody` still holds the test value at `fieldPath` and every
 * other field still matches what mutateField produced — the fallback
 * signal Restore uses when no ETag/version/updatedAt is available. */
export function matchesExpectedState(currentBody: unknown, expected: MutationExpectedState): boolean {
  const currentValue = getByPath(currentBody, expected.fieldPath);
  if (!deepEqual(currentValue, expected.testValue)) return false;
  return fingerprintExcluding(currentBody, expected.fieldPath) === expected.otherFieldsFingerprint;
}
