import type { BusinessProfilePlugin, BusinessProfileContribution } from "./profile-plugin";
import type { GenericProfileContext } from "./generic";

/** Every object shape the Contest/Ticketing profile recognizes — recognition only, never a presumed rule about any of them. */
const CONTEST_OBJECT_TYPES = ["Campaign", "Ticket", "Reservation", "Purchase", "Prize", "Winner"];

/**
 * The Contest/Ticketing Profile (Section 13.21), optional and disabled
 * unless the operator explicitly enables it. It only ever recognizes
 * Campaign/Ticket/Reservation/Purchase/Prize/Winner-shaped objects as an
 * *additional* set of candidates — never presuming any rule about them by
 * default. None of the profile's eight named rules (ticket assignment
 * authority, eligibility, post-payment mutability, leading-number
 * visibility with its lifecycle condition, ranking access, cancelled-
 * ticket eligibility, reservation expiration, and the winner rule) is
 * ever assumed here: every one stays an entirely unconfigured
 * `BusinessExpectation` (Section 13.2) or `BusinessInvariant` (Section
 * 13.17) row until the operator adds it explicitly — this plugin's own
 * `invariants` contribution is always empty, whether enabled or not.
 */
export function createContestProfile(enabled: boolean): BusinessProfilePlugin {
  return {
    name: "contest",
    enabled,
    contribute(baseContext: unknown): BusinessProfileContribution {
      const context = baseContext as GenericProfileContext;
      const contestObjectTypes = context.discoveredObjectTypes.filter((t) => CONTEST_OBJECT_TYPES.includes(t));
      return { candidates: contestObjectTypes.map((objectType) => ({ source: "contest", objectType })), invariants: [] };
    },
  };
}
