import { describe, expect, it } from "vitest";

import type { TyreCompound, TyreSetState, WeatherState } from "@/domain/race";
import {
  calculateFieldStrategyIntelligence,
  calculateStrategyIntelligence,
  type StrategyIntelligenceCar,
  type StrategyIntelligenceContext,
} from "@/simulation/strategy-intelligence";

const dryWeather: WeatherState = {
  condition: "DRY",
  rainIntensity: 0,
  trackWetness: 0,
  airTemperature: 21,
  trackTemperature: 32,
  forecastRainInMinutes: null,
  forecast: [0, 5, 10, 15].map((minutesAhead) => ({
    minutesAhead,
    condition: "DRY" as const,
    rainProbability: 0,
    rainIntensity: 0,
  })),
};

const sustainedRain: WeatherState = {
  condition: "LIGHT_RAIN",
  rainIntensity: 0.52,
  trackWetness: 0.43,
  airTemperature: 17,
  trackTemperature: 20,
  forecastRainInMinutes: 0,
  forecast: [0, 3, 7, 12, 18].map((minutesAhead) => ({
    minutesAhead,
    condition: "LIGHT_RAIN" as const,
    rainProbability: 0.92,
    rainIntensity: 0.5,
  })),
};

function tyreSets(carId: string, fitted: TyreCompound = "MEDIUM"): readonly TyreSetState[] {
  return (["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const).map((compound) => ({
    id: `${carId}-${compound}`,
    compound,
    status: compound === fitted ? "FITTED" as const : "AVAILABLE" as const,
    condition: 100,
    lapsUsed: 0,
  }));
}

function car(overrides: Partial<StrategyIntelligenceCar> = {}): StrategyIntelligenceCar {
  const carId = overrides.carId ?? "player";
  return {
    carId,
    teamId: "player-team",
    racePosition: 2,
    currentLap: 28,
    totalDistance: 158_000,
    totalRaceTime: 2_430,
    gapToLeader: 6.2,
    gapToCarAhead: 6.2,
    gapToCarBehind: 3.8,
    currentSpeed: 265,
    tyreCompound: "MEDIUM",
    tyreAgeLaps: 14,
    tyreLife: 58,
    tyreTemperatures: { frontLeft: 96, frontRight: 98, rearLeft: 99, rearRight: 97 },
    tyreTemperature: 97.5,
    tyreSets: tyreSets(carId),
    pitStatus: "TRACK",
    scheduledPitCompound: null,
    brakeTemperature: 790,
    powerUnitTemperature: 106,
    gearboxTemperature: 94,
    energyStoreTemperature: 43,
    damageLevel: 0,
    paceMode: "STANDARD",
    energyMode: "BALANCED",
    finished: false,
    ...overrides,
  };
}

function context(
  overrides: Partial<StrategyIntelligenceContext> = {},
  playerOverrides: Partial<StrategyIntelligenceCar> = {},
): StrategyIntelligenceContext {
  const player = car(playerOverrides);
  return {
    raceControl: "GREEN",
    pitLaneOpen: true,
    weather: dryWeather,
    elapsedTime: 2_450,
    totalLaps: 52,
    cars: [
      car({ carId: "leader", teamId: "rival-a", racePosition: 1, gapToLeader: 0, gapToCarAhead: 0, gapToCarBehind: 6.2 }),
      player,
      car({ carId: "third", teamId: "rival-b", racePosition: 3, gapToLeader: 10, gapToCarAhead: 3.8, gapToCarBehind: 5 }),
      car({ carId: "fourth", teamId: "rival-c", racePosition: 4, gapToLeader: 15, gapToCarAhead: 5, gapToCarBehind: 8 }),
    ],
    ...overrides,
  };
}

describe("strategy intelligence 3.0", () => {
  it("builds four directly comparable scenarios with exactly one recommendation", () => {
    const input = context();
    const assessment = calculateStrategyIntelligence(input, "player");

    expect(assessment.scenarios.map((scenario) => scenario.id)).toEqual(["BOX_NOW", "STAY_OUT", "UNDERCUT", "OVERCUT"]);
    expect(assessment.scenarios.filter((scenario) => scenario.recommended)).toHaveLength(1);
    expect(assessment.scenarios.find((scenario) => scenario.recommended)?.id).toBe(assessment.recommendedScenarioId);
    expect(assessment.scenarios.find((scenario) => scenario.recommended)?.projectedFinishTimeDeltaSeconds).toBe(0);
    for (const scenario of assessment.scenarios) {
      expect(Number.isFinite(scenario.projectedTotalRaceTimeSeconds)).toBe(true);
      expect(scenario.predictedFinishPosition).toBeGreaterThanOrEqual(1);
      expect(scenario.predictedFinishPosition).toBeLessThanOrEqual(input.cars.length);
      expect(scenario.traffic.density).toBeGreaterThanOrEqual(0);
      expect(scenario.traffic.density).toBeLessThanOrEqual(1);
      expect(scenario.tyreRisk.score).toBeGreaterThanOrEqual(0);
      expect(scenario.thermalRisk.score).toBeLessThanOrEqual(1);
      expect(scenario.confidence).toBeGreaterThan(0);
      expect(scenario.reasons.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic and does not mutate its context", () => {
    const input = context();
    const before = structuredClone(input);
    const first = calculateStrategyIntelligence(input, "player");
    const second = calculateStrategyIntelligence(input, "player");

    expect(second).toEqual(first);
    expect(input).toEqual(before);
  });

  it("recommends boxing for a sustained intermediate crossover", () => {
    const assessment = calculateStrategyIntelligence(context(
      { weather: sustainedRain },
      {
        currentLap: 38,
        tyreCompound: "SOFT",
        tyreSets: tyreSets("player", "SOFT"),
        tyreAgeLaps: 5,
        tyreLife: 78,
        tyreTemperatures: { frontLeft: 71, frontRight: 70, rearLeft: 73, rearRight: 72 },
      },
    ), "player");
    const box = assessment.scenarios.find((scenario) => scenario.id === "BOX_NOW")!;
    const stayOut = assessment.scenarios.find((scenario) => scenario.id === "STAY_OUT")!;

    expect(assessment.recommendedScenarioId).toBe("BOX_NOW");
    expect(assessment.recommendedCompound).toBe("INTERMEDIATE");
    expect(box.weatherOpportunity.state).toBe("CAPTURED");
    expect(stayOut.weatherOpportunity.state).toBe("MISSED");
    expect(stayOut.tyreRisk.level).toMatch(/HIGH|CRITICAL/);
    expect(box.projectedRemainingTimeSeconds).toBeLessThan(stayOut.projectedRemainingTimeSeconds);
  });

  it("does not recommend an unnecessary lap-one stop on fresh dry tyres", () => {
    const assessment = calculateStrategyIntelligence(context({}, {
      currentLap: 1,
      tyreAgeLaps: 0,
      tyreLife: 100,
      totalRaceTime: 0,
    }), "player");
    const box = assessment.scenarios.find((scenario) => scenario.id === "BOX_NOW")!;
    const stayOut = assessment.scenarios.find((scenario) => scenario.id === "STAY_OUT")!;

    expect(assessment.recommendedScenarioId).toBe("STAY_OUT");
    expect(stayOut.projectedRemainingTimeSeconds).toBeLessThan(box.projectedRemainingTimeSeconds);
    expect(box.reasons[0]).toMatch(/early dry stop/i);
  });

  it("keeps a fresh soft starter out until its real opening window", () => {
    const assessment = calculateStrategyIntelligence(context({}, {
      currentLap: 1,
      tyreCompound: "SOFT",
      tyreSets: tyreSets("player", "SOFT"),
      tyreAgeLaps: 0,
      tyreLife: 100,
      totalRaceTime: 0,
    }), "player");

    expect(assessment.recommendedScenarioId).toBe("STAY_OUT");
    expect(assessment.scenarios.find((scenario) => scenario.id === "BOX_NOW")?.feasible).toBe(false);
  });

  it("does not suppress an emergency lap-one stop for a damaged car", () => {
    const assessment = calculateStrategyIntelligence(context({}, {
      currentLap: 1,
      tyreAgeLaps: 0,
      tyreLife: 100,
      damageLevel: 0.7,
      totalRaceTime: 0,
    }), "player");

    expect(assessment.scenarios.find((scenario) => scenario.id === "BOX_NOW")?.feasible).toBe(true);
  });

  it("counts the current lap until the car has finished", () => {
    const active = calculateStrategyIntelligence(context({}, { currentLap: 52, finished: false }), "player");
    const finished = calculateStrategyIntelligence(context({}, { currentLap: 52, finished: true }), "player");

    expect(active.remainingLaps).toBe(1);
    expect(finished.remainingLaps).toBe(0);
  });

  it.each(["VSC", "SAFETY_CAR"] as const)("prices and captures the %s cheap-stop opportunity", (raceControl) => {
    const assessment = calculateStrategyIntelligence(context(
      { raceControl },
      { tyreLife: 54, tyreAgeLaps: 15 },
    ), "player");
    const recommended = assessment.scenarios.find((scenario) => scenario.recommended)!;
    const stayOut = assessment.scenarios.find((scenario) => scenario.id === "STAY_OUT")!;

    expect(["BOX_NOW", "UNDERCUT"]).toContain(assessment.recommendedScenarioId);
    expect(recommended.safetyCarOpportunity.state).toBe("CAPTURED");
    expect(recommended.safetyCarOpportunity.valueSeconds).toBe(raceControl === "VSC" ? 7.4 : 11.2);
    expect(stayOut.safetyCarOpportunity.state).toBe("MISSED");
    expect(recommended.projectedRemainingTimeSeconds).toBeLessThan(stayOut.projectedRemainingTimeSeconds);
  });

  it("can compare a fresh set of the currently fitted compound", () => {
    const sameCompoundSets: readonly TyreSetState[] = [
      { id: "player-medium-fitted", compound: "MEDIUM", status: "FITTED", condition: 58, lapsUsed: 14 },
      { id: "player-medium-fresh", compound: "MEDIUM", status: "AVAILABLE", condition: 100, lapsUsed: 0 },
    ];
    const assessment = calculateStrategyIntelligence(context(
      { raceControl: "SAFETY_CAR" },
      { tyreSets: sameCompoundSets, tyreLife: 42, tyreAgeLaps: 18 },
    ), "player");
    const box = assessment.scenarios.find((scenario) => scenario.id === "BOX_NOW")!;

    expect(box.feasible).toBe(true);
    expect(box.compound).toBe("MEDIUM");
    expect(["BOX_NOW", "UNDERCUT"]).toContain(assessment.recommendedScenarioId);
  });

  it("surfaces tyre, thermal and traffic risk independently", () => {
    const player = car({
      tyreLife: 25,
      tyreAgeLaps: 22,
      tyreTemperatures: { frontLeft: 123, frontRight: 121, rearLeft: 118, rearRight: 119 },
      brakeTemperature: 1_060,
      powerUnitTemperature: 132,
      gearboxTemperature: 126,
      energyStoreTemperature: 66,
      damageLevel: 0.35,
    });
    const crowded = context({
      cars: [
        car({ carId: "leader", teamId: "rival-a", racePosition: 1, gapToLeader: 0, gapToCarAhead: 0 }),
        player,
        car({ carId: "train-a", teamId: "rival-b", racePosition: 3, gapToLeader: 28.4 }),
        car({ carId: "train-b", teamId: "rival-c", racePosition: 4, gapToLeader: 29.3 }),
        car({ carId: "train-c", teamId: "rival-d", racePosition: 5, gapToLeader: 30.2 }),
      ],
    });
    const assessment = calculateStrategyIntelligence(crowded, "player");
    const stayOut = assessment.scenarios.find((scenario) => scenario.id === "STAY_OUT")!;
    const box = assessment.scenarios.find((scenario) => scenario.id === "BOX_NOW")!;

    expect(stayOut.tyreRisk.level).toBe("CRITICAL");
    expect(stayOut.thermalRisk.level).toBe("CRITICAL");
    expect(box.thermalRisk.score).toBeLessThan(stayOut.thermalRisk.score);
    expect(box.traffic.level).toBe("HIGH");
    expect(box.traffic.nearbyCarIds.length).toBeGreaterThanOrEqual(3);
  });

  it("returns stable race order for field assessments and rejects malformed thermal telemetry", () => {
    const input = context({
      cars: [
        car({ carId: "third", racePosition: 3, teamId: "rival-b", gapToLeader: 12 }),
        car({ carId: "leader", racePosition: 1, teamId: "rival-a", gapToLeader: 0 }),
        car({ carId: "second", racePosition: 2, teamId: "rival-c", gapToLeader: 5 }),
      ],
    });

    expect(calculateFieldStrategyIntelligence(input).map((assessment) => assessment.carId)).toEqual(["leader", "second", "third"]);
    expect(() => calculateStrategyIntelligence(context({}, { powerUnitTemperature: Number.NaN }), "player"))
      .toThrow(/powerUnitTemperature/);
  });
});
