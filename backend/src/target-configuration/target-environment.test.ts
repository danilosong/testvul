import { describe, expect, it } from "vitest";
import { assertEnvironmentMutationPolicy, EnvironmentMutationPolicyError } from "../mutation/scan-run-environment";
import { validateNewSecurityAuditInput } from "./new-security-audit";

const COMPLETE_PRODUCTION_POLICY = {
  environment: "PRODUCTION" as const,
  mutationAuthorized: true,
  isTestResource: true,
  reversibilityProven: true,
  backupRestoreCapable: true,
};

describe("Section 16.10 — Target Environment Classification", () => {
  it("accepts exactly the official enum and rejects ad hoc values", () => {
    for (const environment of ["LOCAL_FIXTURE", "DEVELOPMENT", "STAGING", "PRODUCTION"] as const) {
      expect(validateNewSecurityAuditInput({ projectName: "Audit", targetDns: "example.com", environment })).toEqual([]);
    }
    expect(validateNewSecurityAuditInput({ projectName: "Audit", targetDns: "example.com", environment: "QA" as never })).toContain(
      "INVALID_ENVIRONMENT",
    );
  });

  it.each([
    ["mutation authorization", { mutationAuthorized: false }, "MUTATION_AUTHORIZATION"],
    ["explicit TEST_RESOURCE", { isTestResource: false }, "TEST_RESOURCE"],
    ["proven reversibility", { reversibilityProven: false }, "REVERSIBILITY_PROVEN"],
    ["backup/restore capability", { backupRestoreCapable: false }, "BACKUP_RESTORE_CAPABILITY"],
  ])("blocks a PRODUCTION mutation when %s is missing", (_label, override, expectedMissing) => {
    expect(() => assertEnvironmentMutationPolicy({ ...COMPLETE_PRODUCTION_POLICY, ...override })).toThrow(EnvironmentMutationPolicyError);
    try {
      assertEnvironmentMutationPolicy({ ...COMPLETE_PRODUCTION_POLICY, ...override });
    } catch (error) {
      expect((error as EnvironmentMutationPolicyError).missingPreconditions).toContain(expectedMissing);
    }
  });

  it("allows a PRODUCTION mutation only when all four preconditions hold", () => {
    expect(() => assertEnvironmentMutationPolicy(COMPLETE_PRODUCTION_POLICY)).not.toThrow();
  });
});
