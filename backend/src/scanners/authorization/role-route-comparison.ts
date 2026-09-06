import type { Db } from "../../db/connection";
import { getAuthorizationExpectation } from "../../auth/authorization-expectations-repository";

export interface ProfileRouteDifference {
  route: string;
  /** Every profile ID that currently can reach this route — a strict subset of every profile compared, since a route every profile reaches is not a difference at all. */
  reachableByProfileIds: number[];
}

/**
 * Role and Route Comparison (Section 12.23): finds routes/operations
 * reachable by some, but not all, of the compared profiles. This is a
 * pure set-difference — it makes no judgment about whether a difference
 * is a problem.
 */
export function findRouteDifferences(profileRoutes: ReadonlyMap<number, readonly string[]>): ProfileRouteDifference[] {
  const routeToProfiles = new Map<string, number[]>();
  for (const [profileId, routes] of profileRoutes) {
    for (const route of routes) {
      const list = routeToProfiles.get(route) ?? [];
      list.push(profileId);
      routeToProfiles.set(route, list);
    }
  }

  const totalProfiles = profileRoutes.size;
  return [...routeToProfiles.entries()]
    .filter(([, profiles]) => profiles.length !== totalProfiles)
    .map(([route, profiles]) => ({ route, reachableByProfileIds: profiles }));
}

export type RouteDifferenceVerdict = "SURFACED" | "AUTHORIZATION_POLICY_VIOLATION";

export interface EvaluatedRouteDifference extends ProfileRouteDifference {
  verdict: RouteDifferenceVerdict;
}

/**
 * Surfaces every route difference between profiles without an automatic
 * verdict — unless Section 8.8's Expected Permission Policy has a
 * configured DENIED expectation for that route against a profile that
 * currently CAN reach it, in which case it's an
 * AUTHORIZATION_POLICY_VIOLATION. Absent any configured expectation, a
 * difference is only ever SURFACED, never auto-flagged.
 */
export function evaluateRouteDifferences(db: Db, differences: readonly ProfileRouteDifference[]): EvaluatedRouteDifference[] {
  return differences.map((diff) => {
    const hasDeniedExpectation = diff.reachableByProfileIds.some(
      (profileId) => getAuthorizationExpectation(db, profileId, diff.route) === "DENIED",
    );
    return { ...diff, verdict: hasDeniedExpectation ? "AUTHORIZATION_POLICY_VIOLATION" : "SURFACED" };
  });
}
