import { describe, expect, it } from "vitest";

import {
  RELIABILITY_COMPONENTS,
  applyGridPenaltyToCars,
  applySeededWeekendWear,
  assessReliability,
  consumePendingGridPenalty,
  createReliabilityState,
  performBetweenRoundMaintenance,
  reliabilityCondition,
  type ReliabilityState,
} from "@/simulation/reliability";

describe("reliability state", () => {
  it("creates a fresh independent record for every managed component", () => {
    const state = createReliabilityState();

    expect(Object.keys(state.components)).toEqual(RELIABILITY_COMPONENTS);
    for (const kind of RELIABILITY_COMPONENTS) {
      expect(state.components[kind]).toMatchObject({
        kind,
        unitNumber: 1,
        health: 100,
        mileageKm: 0,
        raceCount: 0,
        repairCount: 0,
        replacementCount: 0,
      });
    }
    expect(state.pendingGridPenaltyPlaces).toBe(0);
  });

  it("maps health boundaries to explicit condition stages", () => {
    expect(reliabilityCondition(100)).toBe("OPTIMAL");
    expect(reliabilityCondition(80)).toBe("OPTIMAL");
    expect(reliabilityCondition(79.999)).toBe("SERVICEABLE");
    expect(reliabilityCondition(60)).toBe("SERVICEABLE");
    expect(reliabilityCondition(59.999)).toBe("WORN");
    expect(reliabilityCondition(35)).toBe("WORN");
    expect(reliabilityCondition(34.999)).toBe("CRITICAL");
    expect(reliabilityCondition(0)).toBe("FAILED");
  });
});

describe("seeded weekend wear", () => {
  const weekend = {
    seed: 44_201,
    round: 1,
    distanceKm: 742.8,
    countsAsRace: true,
    intensity: 1.12,
    thermalStress: 0.36,
  } as const;

  it("is deterministic for identical state, seed and usage without mutation", () => {
    const initial = createReliabilityState();
    const initialCopy = structuredClone(initial);
    const first = applySeededWeekendWear(initial, weekend);
    const second = applySeededWeekendWear(initial, weekend);

    expect(first).toEqual(second);
    expect(initial).toEqual(initialCopy);
    expect(first.state).not.toBe(initial);
  });

  it("uses independent seeded variation while recording mileage and race count", () => {
    const initial = createReliabilityState();
    const first = applySeededWeekendWear(initial, weekend);
    const otherSeed = applySeededWeekendWear(initial, { ...weekend, seed: weekend.seed + 1 });

    expect(first.reports.map((report) => report.seededVariation)).not.toEqual(otherSeed.reports.map((report) => report.seededVariation));
    expect(new Set(first.reports.map((report) => report.seededVariation)).size).toBe(RELIABILITY_COMPONENTS.length);
    for (const kind of RELIABILITY_COMPONENTS) {
      expect(first.state.components[kind].health).toBeLessThan(100);
      expect(first.state.components[kind].mileageKm).toBe(742.8);
      expect(first.state.components[kind].raceCount).toBe(1);
    }
  });

  it("supports practice-only mileage and component-specific stress or damage", () => {
    const initial = createReliabilityState();
    const baseline = applySeededWeekendWear(initial, {
      seed: 7,
      round: 1,
      distanceKm: 200,
      countsAsRace: false,
    });
    const stressed = applySeededWeekendWear(initial, {
      seed: 7,
      round: 1,
      distanceKm: 200,
      countsAsRace: false,
      componentLoad: { ICE: 1.8 },
      incidentDamage: { BRAKES: 14 },
    });

    expect(stressed.state.components.ICE.health).toBeLessThan(baseline.state.components.ICE.health);
    expect(stressed.state.components.BRAKES.health).toBeLessThanOrEqual(baseline.state.components.BRAKES.health - 14);
    expect(stressed.state.components.ICE.raceCount).toBe(0);
    expect(stressed.state.components.ICE.mileageKm).toBe(200);
  });

  it("rejects invalid usage instead of producing non-finite state", () => {
    const initial = createReliabilityState();

    expect(() => applySeededWeekendWear(initial, { seed: 1, round: 1, distanceKm: -1 })).toThrow(/distanceKm/);
    expect(() => applySeededWeekendWear(initial, { seed: 1, round: 1, distanceKm: 1, thermalStress: 2 })).toThrow(/thermalStress/);
  });
});

describe("between-round maintenance", () => {
  it("drops both team cars without changing either relative order", () => {
    const grid = ["a", "b", "c", "d", "e", "f", "g", "h"];

    expect(applyGridPenaltyToCars(grid, ["a", "b"], 5)).toEqual(["c", "d", "e", "f", "g", "a", "b", "h"]);
    expect(applyGridPenaltyToCars(grid, ["missing"], 5)).toEqual(grid);
    expect(() => applyGridPenaltyToCars(grid, ["a"], -1)).toThrow(/penaltyPlaces/);
  });

  it("repairs below a health ceiling while preserving unit age", () => {
    const worn = createReliabilityState({ initialHealth: { ICE: 50, TC: 88 } });
    const used = applySeededWeekendWear(worn, { seed: 8, round: 1, distanceKm: 100, countsAsRace: true }).state;
    const result = performBetweenRoundMaintenance(used, 2, [
      { type: "REPAIR", component: "ICE", level: "STANDARD" },
      { type: "REPAIR", component: "TC", level: "REBUILD" },
    ]);

    expect(result.state.components.ICE.health).toBeGreaterThan(used.components.ICE.health);
    expect(result.state.components.ICE.health).toBeLessThanOrEqual(90);
    expect(result.state.components.TC.health).toBe(94);
    expect(result.state.components.ICE.mileageKm).toBe(used.components.ICE.mileageKm);
    expect(result.state.components.ICE.raceCount).toBe(used.components.ICE.raceCount);
    expect(result.state.components.ICE.repairCount).toBe(1);
    expect(result.gridPenaltyAdded).toBe(0);
  });

  it("replaces a unit with a fresh zero-mile component", () => {
    const worn = applySeededWeekendWear(createReliabilityState(), {
      seed: 12,
      round: 1,
      distanceKm: 700,
    }).state;
    const result = performBetweenRoundMaintenance(worn, 2, [{ type: "REPLACE", component: "GEARBOX" }]);
    const gearbox = result.state.components.GEARBOX;

    expect(gearbox).toMatchObject({
      unitNumber: 2,
      health: 100,
      mileageKm: 0,
      raceCount: 0,
      repairCount: 0,
      replacementCount: 1,
      lastServiceRound: 2,
    });
    expect(result.gridPenaltyAdded).toBe(0);
  });

  it("accumulates penalties only after the included allocation is exceeded", () => {
    let state = createReliabilityState();
    for (let nextRound = 2; nextRound <= 5; nextRound += 1) {
      state = performBetweenRoundMaintenance(state, nextRound, [{ type: "REPLACE", component: "ICE" }]).state;
    }
    expect(state.components.ICE.unitNumber).toBe(5);
    expect(state.pendingGridPenaltyPlaces).toBe(10);

    state = performBetweenRoundMaintenance(state, 6, [
      { type: "REPLACE", component: "ICE" },
      { type: "REPLACE", component: "ES" },
      { type: "REPLACE", component: "BRAKES" },
    ]).state;
    state = performBetweenRoundMaintenance(state, 7, [
      { type: "REPLACE", component: "ES" },
      { type: "REPLACE", component: "BRAKES" },
    ]).state;

    expect(state.components.ES.unitNumber).toBe(3);
    expect(state.pendingGridPenaltyPlaces).toBe(30);
    expect(state.accumulatedGridPenaltyPlaces).toBe(30);
    expect(state.components.BRAKES.unitNumber).toBe(3);

    const consumed = consumePendingGridPenalty(state);
    expect(consumed.penaltyPlaces).toBe(30);
    expect(consumed.state.pendingGridPenaltyPlaces).toBe(0);
    expect(consumed.state.accumulatedGridPenaltyPlaces).toBe(30);
  });

  it("rejects duplicate work and requires replacement for a failed component", () => {
    const failed = createReliabilityState({ initialHealth: { ICE: 0 } });
    expect(() => performBetweenRoundMaintenance(failed, 2, [
      { type: "REPAIR", component: "ICE", level: "REBUILD" },
    ])).toThrow(/must be replaced/);
    expect(() => performBetweenRoundMaintenance(failed, 2, [
      { type: "REPLACE", component: "TC" },
      { type: "REPAIR", component: "TC", level: "LIGHT" },
    ])).toThrow(/one maintenance action/);
  });
});

describe("risk and performance assessment", () => {
  function withComponent(
    state: ReliabilityState,
    component: "ICE" | "TC",
    patch: Partial<ReliabilityState["components"][typeof component]>,
  ): ReliabilityState {
    return {
      ...state,
      components: {
        ...state.components,
        [component]: { ...state.components[component], ...patch },
      },
    };
  }

  it("returns bounded, deterministic aggregate risk for a race distance", () => {
    const state = applySeededWeekendWear(createReliabilityState(), {
      seed: 98,
      round: 1,
      distanceKm: 700,
      thermalStress: 0.4,
    }).state;
    const first = assessReliability(state, { horizonKm: 305, intensity: 1.1 });
    const second = assessReliability(state, { horizonKm: 305, intensity: 1.1 });

    expect(first).toEqual(second);
    expect(first.failureProbability).toBeGreaterThanOrEqual(0);
    expect(first.failureProbability).toBeLessThanOrEqual(1);
    expect(first.failureRiskPercent).toBeCloseTo(first.failureProbability * 100, 4);
    expect(first.performanceDeratePercent).toBeGreaterThanOrEqual(0);
  });

  it("increases risk and derate as health and age deteriorate", () => {
    const fresh = createReliabilityState();
    const oldButHealthy = withComponent(fresh, "ICE", { mileageKm: 6_000, raceCount: 10 });
    const critical = withComponent(oldButHealthy, "ICE", { health: 18 });
    const freshAssessment = assessReliability(fresh);
    const oldAssessment = assessReliability(oldButHealthy);
    const criticalAssessment = assessReliability(critical);

    expect(oldAssessment.failureProbability).toBeGreaterThan(freshAssessment.failureProbability);
    expect(criticalAssessment.failureProbability).toBeGreaterThan(oldAssessment.failureProbability);
    expect(criticalAssessment.performanceDeratePercent).toBeGreaterThan(oldAssessment.performanceDeratePercent);
    expect(criticalAssessment.condition).toBe("CRITICAL");
    expect(criticalAssessment.limitingComponent).toBe("ICE");
  });

  it("treats a failed component as certain failure", () => {
    const failed = withComponent(createReliabilityState(), "TC", { health: 0 });
    const assessment = assessReliability(failed);
    const turbo = assessment.components.find((component) => component.component === "TC");

    expect(turbo?.failureProbability).toBe(1);
    expect(assessment.failureProbability).toBe(1);
    expect(assessment.condition).toBe("FAILED");
    expect(assessment.limitingComponent).toBe("TC");
  });
});
