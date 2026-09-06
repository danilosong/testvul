import { describe, expect, it } from "vitest";
import { composeProfiles } from "./profile-plugin";
import { GENERIC_PROFILE, type GenericProfileContext } from "./generic";
import { createContestProfile } from "./contest";

const CONTEXT: GenericProfileContext = {
  discoveredObjectTypes: ["Campaign", "Ticket", "Reservation", "Purchase", "Prize", "Winner", "Project"],
};

describe("Contest/Ticketing profile object recognizers (Section 13.21)", () => {
  it("recognizes Campaign/Ticket/Reservation/Purchase/Prize/Winner as additional candidates when enabled", () => {
    const result = createContestProfile(true).contribute(CONTEXT);
    const objectTypes = (result.candidates as { objectType: string }[]).map((c) => c.objectType).sort();
    expect(objectTypes).toEqual(["Campaign", "Prize", "Purchase", "Reservation", "Ticket", "Winner"]);
  });

  it("never recognizes an object type it wasn't built for (e.g. the Generic Profile's own 'Project')", () => {
    const result = createContestProfile(true).contribute(CONTEXT);
    const objectTypes = (result.candidates as { objectType: string }[]).map((c) => c.objectType);
    expect(objectTypes).not.toContain("Project");
  });

  it("produces zero effect on a scan where the Contest profile is not enabled — same non-contamination pattern as Section 13.1", () => {
    const withoutContestRegistered = composeProfiles([GENERIC_PROFILE], CONTEXT);
    const withContestDisabled = composeProfiles([GENERIC_PROFILE, createContestProfile(false)], CONTEXT);
    expect(withContestDisabled).toEqual(withoutContestRegistered);
  });

  it("enabling the profile without configuring any rule assumes no default value for any of the eight Contest-specific rules", () => {
    // The eight rules — ticket assignment authority, eligibility,
    // post-payment mutability, leading-number visibility (with its
    // lifecycle condition), ranking access, cancelled-ticket eligibility,
    // reservation expiration, and the winner rule — are only ever
    // BusinessExpectation/BusinessInvariant rows the operator configures
    // (Section 13.2/13.17). Enabling the profile must never conjure any
    // of them: its own contribution carries zero invariants and zero
    // expectation-shaped data, enabled or not.
    const enabled = createContestProfile(true).contribute(CONTEXT);
    const disabled = createContestProfile(false).contribute(CONTEXT);
    expect(enabled.invariants).toEqual([]);
    expect(disabled.invariants).toEqual([]);
  });
});
