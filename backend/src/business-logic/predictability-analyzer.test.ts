import { describe, expect, it } from "vitest";
import {
  analyzePredictabilityExploitation,
  classifyIdentifierPredictability,
  predictNextIdentifier,
} from "./predictability-analyzer";

describe("classifyIdentifierPredictability (Section 13.12)", () => {
  it("classifies a strictly +1 sequence as SEQUENTIAL", () => {
    expect(classifyIdentifierPredictability([101, 102, 103, 104])).toBe("SEQUENTIAL");
  });

  it("classifies a constant-step, bounded-step monotonic sequence as POTENTIALLY_PREDICTABLE", () => {
    expect(classifyIdentifierPredictability([100, 105, 110, 115])).toBe("POTENTIALLY_PREDICTABLE");
  });

  it("classifies an irregular, non-monotonic sequence as RANDOM_LOOKING", () => {
    expect(classifyIdentifierPredictability([58, 301, 942, 17])).toBe("RANDOM_LOOKING");
  });

  it("classifies a large-step monotonic sequence as RANDOM_LOOKING, not POTENTIALLY_PREDICTABLE", () => {
    expect(classifyIdentifierPredictability([1000, 5231, 19042])).toBe("RANDOM_LOOKING");
  });

  it("classifies fewer than 3 observations as INSUFFICIENT_DATA regardless of shape", () => {
    expect(classifyIdentifierPredictability([1, 2])).toBe("INSUFFICIENT_DATA");
    expect(classifyIdentifierPredictability([])).toBe("INSUFFICIENT_DATA");
  });
});

describe("predictNextIdentifier (Section 13.12)", () => {
  it("extrapolates the next id for a SEQUENTIAL sequence", () => {
    expect(predictNextIdentifier([10, 11, 12])).toBe(13);
  });

  it("extrapolates the next id for a POTENTIALLY_PREDICTABLE sequence", () => {
    expect(predictNextIdentifier([100, 105, 110])).toBe(115);
  });

  it("returns null for a RANDOM_LOOKING sequence — no prediction is defensible", () => {
    expect(predictNextIdentifier([58, 301, 942, 17])).toBeNull();
  });

  it("returns null for INSUFFICIENT_DATA", () => {
    expect(predictNextIdentifier([1, 2])).toBeNull();
  });
});

describe("analyzePredictabilityExploitation (Section 13.12) — a finding requires both predictability and proven unauthorized access", () => {
  it("produces no finding for a SEQUENTIAL sequence alone when the predicted id is PROTECTED", () => {
    const result = analyzePredictabilityExploitation("SEQUENTIAL", "PROTECTED");
    expect(result).toEqual({ classification: "SEQUENTIAL", finding: false });
  });

  it("produces no finding for a SEQUENTIAL sequence when the predicted id yields no matching content (false-positive avoidance)", () => {
    const result = analyzePredictabilityExploitation("SEQUENTIAL", "NO_FINDING");
    expect(result).toEqual({ classification: "SEQUENTIAL", finding: false });
  });

  it("produces a finding once a SEQUENTIAL prediction is shown to access another user's resource", () => {
    const result = analyzePredictabilityExploitation("SEQUENTIAL", "POTENTIAL_BOLA");
    expect(result).toEqual({ classification: "SEQUENTIAL", finding: true });
  });

  it("produces a finding for a POTENTIALLY_PREDICTABLE prediction shown to access another user's resource", () => {
    const result = analyzePredictabilityExploitation("POTENTIALLY_PREDICTABLE", "POTENTIAL_BOLA");
    expect(result).toEqual({ classification: "POTENTIALLY_PREDICTABLE", finding: true });
  });

  it("never produces a finding for RANDOM_LOOKING or INSUFFICIENT_DATA, even if access happened to succeed", () => {
    expect(analyzePredictabilityExploitation("RANDOM_LOOKING", "POTENTIAL_BOLA").finding).toBe(false);
    expect(analyzePredictabilityExploitation("INSUFFICIENT_DATA", "POTENTIAL_BOLA").finding).toBe(false);
  });
});
