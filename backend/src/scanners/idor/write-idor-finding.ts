export type WriteIdorFindingClassification = "BROKEN_AUTHORIZATION" | "NO_FINDING";

/**
 * UI absence is never evidence of backend authorization (design.md —
 * Section 12.21): this function's signature has no parameter for UI
 * affordance state at all — only the acting profile, the resource's real
 * declared owner (Section 11.9's Automated Authorization Matrix), and
 * whether the backend actually accepted the mutation. A backend PATCH
 * User A's own credential successfully applies to User B's resource is
 * Broken Authorization regardless of whether any UI ever exposed an edit
 * control for it — the frontend's own choices about what to render are
 * not a security boundary this engine trusts.
 */
export function classifyWriteIdorFinding(
  actingProfileId: number,
  resourceOwnerProfileId: number,
  mutationWasAccepted: boolean,
): WriteIdorFindingClassification {
  if (actingProfileId === resourceOwnerProfileId) return "NO_FINDING";
  return mutationWasAccepted ? "BROKEN_AUTHORIZATION" : "NO_FINDING";
}
