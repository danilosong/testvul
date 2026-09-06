import { describe, expect, it } from "vitest";
import { composeProfiles } from "./profile-plugin";
import { GENERIC_ANALYSIS_TYPES, GENERIC_PROFILE, type GenericProfileContext } from "./generic";
import { createContestProfile } from "./contest";
import { recognizeObjectTypesFromUrl } from "../business-object-discovery";

const CONTEXT: GenericProfileContext = { discoveredObjectTypes: ["Campaign", "Ticket", "Project"] };

describe("composeProfiles — additive-only Profile Plugin composition (design.md Decision 36)", () => {
  it("a scan with the Contest profile registered-but-disabled produces identical Generic Profile output to a scan with no Contest profile registered at all", () => {
    const withoutContestRegistered = composeProfiles([GENERIC_PROFILE], CONTEXT);
    const withContestDisabled = composeProfiles([GENERIC_PROFILE, createContestProfile(false)], CONTEXT);

    expect(withContestDisabled).toEqual(withoutContestRegistered);
  });

  it("enabling the Contest profile only adds to the Generic Profile's output, never replaces or suppresses it", () => {
    const genericOnly = composeProfiles([GENERIC_PROFILE], CONTEXT);
    const withContestEnabled = composeProfiles([GENERIC_PROFILE, createContestProfile(true)], CONTEXT);

    expect(withContestEnabled.candidates.length).toBeGreaterThan(genericOnly.candidates.length);
    expect(withContestEnabled.candidates).toEqual(expect.arrayContaining(genericOnly.candidates));
  });

  it("a disabled profile contributes nothing at all", () => {
    const result = composeProfiles([createContestProfile(false)], CONTEXT);
    expect(result).toEqual({ candidates: [], invariants: [] });
  });

  it("runs every standard generic analysis for a non-contest Project area without any domain profile enabled", () => {
    const discoveredObjectTypes = recognizeObjectTypesFromUrl("https://fixture.example/api/projects/1");
    const result = composeProfiles([GENERIC_PROFILE], { discoveredObjectTypes });

    expect(result.candidates).toEqual(
      GENERIC_ANALYSIS_TYPES.map((analysisType) => ({ source: "generic", objectType: "Project", analysisType })),
    );
    expect(result.invariants).toEqual([]);
  });
});
