export interface BusinessProfileContribution {
  candidates: readonly unknown[];
  invariants: readonly unknown[];
}

export interface BusinessProfilePlugin {
  name: string;
  /** Never true by default for any non-Generic profile. */
  enabled: boolean;
  /** Returns only what this profile itself adds — never anything that inspects or could suppress another profile's or the Generic Profile's own contribution. */
  contribute(baseContext: unknown): BusinessProfileContribution;
}

/**
 * Additive-only Profile Plugin composition (design.md Decision 36): every
 * enabled profile's contribution is simply concatenated — a disabled
 * profile contributes nothing at all (not even an empty marker that could
 * later change behavior), and no profile ever removes, filters, or
 * otherwise alters another profile's or the Generic Profile's output.
 * This is what makes it structurally impossible for an optional profile
 * to change the Generic Profile's own results merely by existing.
 */
export function composeProfiles(profiles: readonly BusinessProfilePlugin[], baseContext: unknown): BusinessProfileContribution {
  const candidates: unknown[] = [];
  const invariants: unknown[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const contribution = profile.contribute(baseContext);
    candidates.push(...contribution.candidates);
    invariants.push(...contribution.invariants);
  }
  return { candidates, invariants };
}
