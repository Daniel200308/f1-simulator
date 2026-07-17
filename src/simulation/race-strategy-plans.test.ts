import { describe, expect, it } from "vitest";

import type { TyreSetState, WeatherState } from "@/domain/race";
import { buildRaceStrategyPlans, type RaceStrategyPlanContext } from "@/simulation/race-strategy-plans";

const sets: readonly TyreSetState[] = (["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const).map((compound) => ({
  id: compound,
  compound,
  status: compound === "MEDIUM" ? "FITTED" : "AVAILABLE",
  condition: 100,
  lapsUsed: 0,
}));

const dry: WeatherState = { condition: "DRY", rainIntensity: 0, trackWetness: 0, airTemperature: 20, trackTemperature: 32, forecastRainInMinutes: null };

function context(overrides: Partial<RaceStrategyPlanContext> = {}): RaceStrategyPlanContext {
  return {
    currentLap: 1,
    totalLaps: 52,
    tyreCompound: "MEDIUM",
    tyreLife: 100,
    tyreAgeLaps: 0,
    tyreSets: sets,
    weather: dry,
    raceControl: "GREEN",
    ...overrides,
  };
}

describe("full-race strategy plans", () => {
  it("returns ranked Plan A, B and C timelines that cover every remaining lap", () => {
    const plans = buildRaceStrategyPlans(context());
    expect(plans.map((plan) => plan.id)).toEqual(["A", "B", "C"]);
    expect(plans[0].recommended).toBe(true);
    expect(plans[0].projectedDeltaSeconds).toBe(0);
    for (const plan of plans) {
      expect(plan.stints[0].startLap).toBe(1);
      expect(plan.stints.at(-1)?.endLap).toBe(52);
      plan.stints.slice(1).forEach((stint, index) => expect(stint.startLap).toBe(plan.stints[index].endLap + 1));
    }
  });

  it("preserves the currently fitted tyre as the first stint", () => {
    const plans = buildRaceStrategyPlans(context({ currentLap: 18, tyreCompound: "SOFT", tyreLife: 48, tyreAgeLaps: 12 }));
    expect(plans.every((plan) => plan.stints[0].compound === "SOFT" && plan.stints[0].startLap === 18)).toBe(true);
  });

  it("uses at least two dry compounds in every scheduled dry-race plan", () => {
    const plans = buildRaceStrategyPlans(context());
    for (const plan of plans) {
      expect(new Set(plan.stints.map((stint) => stint.compound)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("creates a weather crossover plan when the track becomes wet", () => {
    const plans = buildRaceStrategyPlans(context({
      currentLap: 21,
      tyreLife: 70,
      weather: { ...dry, condition: "HEAVY_RAIN", rainIntensity: 0.8, trackWetness: 0.74 },
    }));
    expect(plans[0].stints.some((stint) => stint.compound === "WET")).toBe(true);
    expect(plans[0].stints[0].pitAtEnd).toBe(true);
  });

  it("can recommend reaching the flag without another stop", () => {
    const plans = buildRaceStrategyPlans(context({ currentLap: 47, tyreCompound: "HARD", tyreLife: 54, tyreAgeLaps: 20 }));
    expect(plans[0].stopCount).toBe(0);
    expect(plans[0].name).toMatch(/NO-STOP/);
  });
});
