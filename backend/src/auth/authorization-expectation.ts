export type ExpectedPermission = "ALLOWED" | "DENIED";

export interface AuthorizationExpectationInput {
  authProfileId: number;
  action: string;
  expected: ExpectedPermission;
}

export interface AuthorizationExpectation extends AuthorizationExpectationInput {
  id: number;
}

/** Distinct from `ALLOWED`/`DENIED` — an unconfigured profile/action pair
 * is not silently treated as either. */
export type PermissionQueryResult = ExpectedPermission | "NO_EXPECTATION_CONFIGURED";
