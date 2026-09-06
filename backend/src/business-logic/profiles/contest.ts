import type { BusinessProfilePlugin, BusinessProfileContribution } from "./profile-plugin";
import type { GenericProfileContext } from "./generic";

/**
 * The Contest/Ticketing Profile (Section 13.21), optional and disabled
 * unless the operator explicitly enables it. It only ever recognizes
 * Campaign/Ticket/Reservation-shaped objects as an *additional* set of
 * candidates — never presuming any rule about them by default (ticket
 * assignment authority, eligibility, etc. all remain unconfigured
 * `BusinessExpectation`/`BusinessInvariant` entries until the operator
 * configures them, per Section 13.21). Scaffolded here as an
 * additive-only plugin; its actual recognizer logic is Section 13.21's job.
 */
export function createContestProfile(enabled: boolean): BusinessProfilePlugin {
  return {
    name: "contest",
    enabled,
    contribute(baseContext: unknown): BusinessProfileContribution {
      const context = baseContext as GenericProfileContext;
      const contestObjectTypes = context.discoveredObjectTypes.filter((t) => ["Campaign", "Ticket", "Reservation", "Purchase"].includes(t));
      return { candidates: contestObjectTypes.map((objectType) => ({ source: "contest", objectType })), invariants: [] };
    },
  };
}
