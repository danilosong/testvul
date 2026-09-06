import { describe, expect, it } from "vitest";
import { describeBusinessFinding, getFindingConfirmationLabel, type BusinessFindingProofLevel } from "./business-findings";

describe("getFindingConfirmationLabel (Section 13.20)", () => {
  it.each(["OBSERVED", "INFERRED", "INCONCLUSIVE", "NOT_TESTED"] as BusinessFindingProofLevel[])(
    "never labels %s as CONFIRMED",
    (proofLevel) => {
      expect(getFindingConfirmationLabel(proofLevel)).toBe("UNCONFIRMED");
    },
  );

  it.each(["CONFIRMED", "SAFE_PROBE_CONFIRMED"] as BusinessFindingProofLevel[])("labels %s as CONFIRMED", (proofLevel) => {
    expect(getFindingConfirmationLabel(proofLevel)).toBe("CONFIRMED");
  });
});

describe("describeBusinessFinding (Section 13.20) — UI/report rendering never labels an INFERRED finding as confirmed", () => {
  it("never renders the word CONFIRMED for an INFERRED finding", () => {
    const rendered = describeBusinessFinding({ title: "GTM value changed by a low-privilege account", proofLevel: "INFERRED" });
    expect(rendered).not.toContain("CONFIRMED");
    expect(rendered).toContain("INFERRED");
  });

  it("never renders the word CONFIRMED for an OBSERVED finding", () => {
    const rendered = describeBusinessFinding({ title: "currentLowestEligibleNumber exposed unauthenticated", proofLevel: "OBSERVED" });
    expect(rendered).not.toContain("CONFIRMED");
    expect(rendered).toContain("OBSERVED");
  });

  it("does render CONFIRMED for a genuinely CONFIRMED finding", () => {
    const rendered = describeBusinessFinding({ title: "Ticket number changed after PAID", proofLevel: "CONFIRMED" });
    expect(rendered).toContain("[CONFIRMED]");
  });

  it("does render CONFIRMED for a SAFE_PROBE_CONFIRMED finding", () => {
    const rendered = describeBusinessFinding({ title: "Predicted ticket id granted unauthorized access", proofLevel: "SAFE_PROBE_CONFIRMED" });
    expect(rendered).toContain("[CONFIRMED]");
  });
});
