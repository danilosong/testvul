import type { BusinessProfilePlugin, BusinessProfileContribution } from "./profile-plugin";

/**
 * Scaffold — the SaaS Profile plugin boundary. Not built out by any task
 * in this MVP's task list; registered as a disabled, no-op plugin for the
 * same reason as `commerce.ts`.
 */
export function createSaasProfile(enabled: boolean): BusinessProfilePlugin {
  return {
    name: "saas",
    enabled,
    contribute(): BusinessProfileContribution {
      return { candidates: [], invariants: [] };
    },
  };
}
