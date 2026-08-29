import { describe, expect, it } from "vitest";

import {
  normalizedDriverRisk,
  pitMistakeRiskBias,
  qualifyingErrorRisk,
  raceIncidentRiskMultiplier,
} from "@/simulation/driver-risk";

describe("driver risk scaling", () => {
  it("is bounded and monotonic across the supplied 1..10 scale", () => {
    expect(normalizedDriverRisk(-5)).toBe(0);
    expect(normalizedDriverRisk(1)).toBe(0);
    expect(normalizedDriverRisk(10)).toBe(1);
    expect(normalizedDriverRisk(25)).toBe(1);
    expect(qualifyingErrorRisk(9)).toBeGreaterThan(qualifyingErrorRisk(4));
    expect(raceIncidentRiskMultiplier(9)).toBeGreaterThan(raceIncidentRiskMultiplier(4));
    expect(pitMistakeRiskBias(9)).toBeGreaterThan(pitMistakeRiskBias(4));
  });

  it("keeps risk as a modest outcome modifier rather than a pace multiplier", () => {
    expect(qualifyingErrorRisk(3)).toBeGreaterThanOrEqual(0.002);
    expect(qualifyingErrorRisk(9)).toBeLessThan(0.014);
    expect(raceIncidentRiskMultiplier(3)).toBeGreaterThan(0.9);
    expect(raceIncidentRiskMultiplier(9)).toBeLessThan(1.5);
    expect(pitMistakeRiskBias(10)).toBe(0.2);
  });
});
