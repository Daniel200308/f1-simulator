import { describe, expect, it } from "vitest";

import type { WeatherState, WeekendTyreUsage } from "@/domain/race";
import { DRIVERS } from "@/fixtures/grid";
import { createInitialSnapshot } from "@/simulation/engine";
import { buildRaceStartingTyrePlan, freshRaceStartSets } from "@/simulation/starting-tyre-strategy";
import { createSpatialWeather } from "@/simulation/weather";

const gridOrder = DRIVERS.map((driver) => driver.id);

function wetWeather(kind: "INTERMEDIATE" | "WET"): WeatherState {
  const base = createSpatialWeather(44);
  return {
    ...base,
    condition: kind === "WET" ? "HEAVY_RAIN" : "LIGHT_RAIN",
    rainIntensity: kind === "WET" ? 0.82 : 0.34,
    trackWetness: kind === "WET" ? 0.78 : 0.32,
    surfaceZones: base.surfaceZones?.map((zone) => ({
      ...zone,
      rainIntensity: kind === "WET" ? 0.82 : 0.34,
      wetness: kind === "WET" ? 0.78 : 0.32,
      standingWater: kind === "WET" ? 0.26 : 0.06,
      dryingLine: 0.05,
    })),
  };
}

describe("race starting tyre strategy", () => {
  it("builds a deterministic full-field plan with strategic variety", () => {
    const weather = createSpatialWeather(20_260_712);
    const first = buildRaceStartingTyrePlan({ seed: 20_260_712, gridOrder, weather });
    const second = buildRaceStartingTyrePlan({ seed: 20_260_712, gridOrder, weather });
    expect(second).toEqual(first);
    expect(Object.keys(first)).toHaveLength(DRIVERS.length);
    expect(new Set(Object.values(first).map((decision) => decision.compound)).size).toBeGreaterThanOrEqual(2);

    const oldIndexPattern = gridOrder.map((_, index) => (["SOFT", "MEDIUM", "HARD"] as const)[(index + Math.floor(index / 2)) % 3]);
    expect(gridOrder.map((carId) => first[carId].compound)).not.toEqual(oldIndexPattern);
  });

  it("coordinates team doctrines while allowing intentional split coverage", () => {
    const plan = buildRaceStartingTyrePlan({ seed: 9_091, gridOrder, weather: createSpatialWeather(9_091) });
    const teamPairs = Array.from({ length: DRIVERS.length / 2 }, (_, index) => DRIVERS.slice(index * 2, index * 2 + 2).map((driver) => plan[driver.id]));
    expect(teamPairs.every(([first, second]) => first.doctrine === second.doctrine)).toBe(true);
    expect(teamPairs.some(([first, second]) => first.compound === second.compound)).toBe(true);
    expect(teamPairs.some(([first, second]) => first.compound !== second.compound)).toBe(true);
  });

  it("selects the correct wet-weather family for a wet start", () => {
    const intermediate = buildRaceStartingTyrePlan({ seed: 44, gridOrder, weather: wetWeather("INTERMEDIATE") });
    const wet = buildRaceStartingTyrePlan({ seed: 45, gridOrder, weather: wetWeather("WET") });
    expect(Object.values(intermediate).every((decision) => decision.compound === "INTERMEDIATE")).toBe(true);
    expect(Object.values(wet).every((decision) => decision.compound === "WET")).toBe(true);
  });

  it("keeps a player-selected scrubbed soft legal when the fresh allocation is exhausted", () => {
    const target = gridOrder[0];
    const tyreUsage: WeekendTyreUsage = { [target]: { SOFT: 8, MEDIUM: 3 } };
    const plan = buildRaceStartingTyrePlan({ seed: 5, gridOrder, tyreUsage, weather: createSpatialWeather(5), playerOverrides: { [target]: "SOFT" } });
    expect(freshRaceStartSets(target, tyreUsage).SOFT).toBe(0);
    expect(plan[target].compound).toBe("SOFT");
  });

  it("allows a player override without changing the team doctrine", () => {
    const target = gridOrder[0];
    const base = buildRaceStartingTyrePlan({ seed: 77, gridOrder, weather: createSpatialWeather(77) });
    const overridden = buildRaceStartingTyrePlan({ seed: 77, gridOrder, weather: createSpatialWeather(77), playerOverrides: { [target]: "SOFT" } });
    expect(overridden[target].compound).toBe("SOFT");
    expect(overridden[target].doctrine).toBe(base[target].doctrine);
    expect(overridden[target].rationale).toContain("Player override");
  });

  it("fits the generated plan to every car in the initial race snapshot", () => {
    const seed = 81_200;
    const weather = createSpatialWeather(seed);
    const plan = buildRaceStartingTyrePlan({ seed, gridOrder, weather });
    const snapshot = createInitialSnapshot(seed);
    snapshot.cars.forEach((car) => {
      expect(car.tyreCompound).toBe(plan[car.carId].compound);
      const fittedSets = car.tyreSets.filter((set) => set.status === "FITTED");
      expect(fittedSets).toHaveLength(1);
      expect(fittedSets[0].compound).toBe(car.tyreCompound);
    });
  });
});
