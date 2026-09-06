import type { BusinessProfilePlugin, BusinessProfileContribution } from "./profile-plugin";

/**
 * Scaffold — the Commerce Profile plugin boundary. Not built out by any
 * task in this MVP's task list; registered as a disabled, no-op plugin so
 * the Profile Plugin architecture's additive-only composition already has
 * a real second optional profile to compose against, without inventing
 * commerce-specific rules this MVP was never asked to build.
 */
export function createCommerceProfile(enabled: boolean): BusinessProfilePlugin {
  return {
    name: "commerce",
    enabled,
    contribute(): BusinessProfileContribution {
      return { candidates: [], invariants: [] };
    },
  };
}
