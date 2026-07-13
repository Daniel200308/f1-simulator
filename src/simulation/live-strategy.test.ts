import { describe, expect, it } from "vitest";

import type { TyreCompound, TyreSetState, WeatherState } from "@/domain/race";
import {
  calculateFieldLiveStrategies,
  calculateLiveStrategy,
  estimateLivePitLossSeconds,
  type LiveStrategyCar,
  type LiveStrategyContext,
} from "@/simulation/live-strategy";

const dryWeather: WeatherState = {
  condition: "DRY",
  rainIntensity: 0,
  trackWetness: 0,
  airTemperature: 21,
  trackTemperature: 31,
  forecastRainInMinutes: null,
  forecast: [0, 5, 10, 15].map((minutesAhead) => ({
    minutesAhead,
    condition: "DRY" as const,
    rainProbability: 0,
    rainIntensity: 0,
  })),
};

const wetWeather: WeatherState = {
  condition: "LIGHT_RAIN",
  rainIntensity: 0.52,
  trackWetness: 0.43,
  airTemperature: 17,
  trackTemperature: 20,
  forecastRainInMinutes: 0,
  forecast: [0, 3, 7, 12, 15].map((minutesAhead) => ({
    minutesAhead,
    condition: "LIGHT_RAIN" as const,
    rainProbability: 0.9,
    rainIntensity: 0.5,
  })),
};

function sets(carId: string, fitted: TyreCompound = "MEDIUM"): readonly TyreSetState[] {
  return (["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const).map((compound) => ({
    id: `${carId}-${compound}`,
    compound,
    status: compound === fitted ? "FITTED" as const : "AVAILABLE" as const,
    condition: 100,
    lapsUsed: 0,
  }));
}

function car(overrides: Partial<LiveStrategyCar> = {}): LiveStrategyCar {
  const carId = overrides.carId ?? "player";
  return {
    carId,
    teamId: "player-team",
    racePosition: 2,
    currentLap: 22,
    totalDistance: 120_000,
    gapToLeader: 7,
    gapToCarAhead: 7,
    gapToCarBehind: 5,
    currentSpeed: 250,
    tyreCompound: "MEDIUM",
    tyreAgeLaps: 13,
    tyreLife: 62,
    tyreSets: sets(carId),
    pitStatus: "TRACK",
    scheduledPitCompound: null,
    finished: false,
    ...overrides,
  };
}

function context(
  overrides: Partial<LiveStrategyContext> = {},
  playerOverrides: Partial<LiveStrategyCar> = {},
): LiveStrategyContext {
  const player = car(playerOverrides);
  return {
    raceControl: "GREEN",
    pitLaneOpen: true,
    weather: dryWeather,
    totalLaps: 52,
    cars: [
      car({ carId: "leader", teamId: "rival-a", racePosition: 1, gapToLeader: 0, gapToCarAhead: 0, gapToCarBehind: 7, totalDistance: 120_480 }),
      player,
      car({ carId: "third", teamId: "rival-b", racePosition: 3, gapToLeader: 12, gapToCarAhead: 5, gapToCarBehind: 6, totalDistance: 119_650 }),
    ],
    ...overrides,
  };
}

describe("live strategy core", () => {
  it("prices the same stop progressively cheaper under yellow, VSC and Safety Car", () => {
    const green = calculateLiveStrategy(context({ raceControl: "GREEN" }), "player");
    const yellow = calculateLiveStrategy(context({ raceControl: "YELLOW" }), "player");
    const vsc = calculateLiveStrategy(context({ raceControl: "VSC" }), "player");
    const safetyCar = calculateLiveStrategy(context({ raceControl: "SAFETY_CAR" }), "player");

    expect(green.pitLoss.expectedSeconds).toBe(23);
    expect(yellow.pitLoss.expectedSeconds).toBe(20.8);
    expect(vsc.pitLoss.expectedSeconds).toBe(15.6);
    expect(safetyCar.pitLoss.expectedSeconds).toBe(11.8);
    expect(safetyCar.pitLoss.byRaceControl).toEqual({ GREEN: 23, YELLOW: 20.8, VSC: 15.6, SAFETY_CAR: 11.8 });
    expect(green.call).toBe("STAY_OUT");
    expect(vsc.call).toBe("BOX_NOW");
    expect(safetyCar.call).toBe("BOX_NOW");
    expect(vsc.reasons.some((reason) => reason.includes("saves 7.4s"))).toBe(true);
  });

  it("holds the second team car when an imminent double-stack would erase a cheap stop", () => {
    const base = context({ raceControl: "VSC" }, { tyreLife: 45 });
    const teammate = car({
      carId: "teammate",
      teamId: "player-team",
      racePosition: 4,
      gapToLeader: 14,
      gapToCarAhead: 2,
      scheduledPitCompound: "HARD",
    });
    const assessment = calculateLiveStrategy({ ...base, cars: [...base.cars, teammate] }, "player");

    expect(assessment.doubleStack).toEqual({ risk: "CONFLICT", teammateCarId: "teammate", queueDelaySeconds: 1.8 });
    expect(assessment.pitLoss.expectedSeconds).toBe(17.4);
    expect(assessment.call).toBe("EXTEND");
    expect(assessment.reasons.some((reason) => reason.includes("Double-stack"))).toBe(true);
  });

  it("detects a dense rejoin train and favours an overcut instead of releasing into traffic", () => {
    const player = car({ tyreLife: 64, gapToLeader: 8, gapToCarAhead: 7, racePosition: 2 });
    const crowded = context({
      cars: [
        car({ carId: "leader", teamId: "rival-a", racePosition: 1, gapToLeader: 0, gapToCarAhead: 0 }),
        player,
        car({ carId: "train-a", teamId: "rival-b", racePosition: 3, gapToLeader: 29.2 }),
        car({ carId: "train-b", teamId: "rival-c", racePosition: 4, gapToLeader: 30.4 }),
        car({ carId: "train-c", teamId: "rival-d", racePosition: 5, gapToLeader: 32.1 }),
        car({ carId: "train-d", teamId: "rival-e", racePosition: 6, gapToLeader: 34.4 }),
      ],
    });
    const assessment = calculateLiveStrategy(crowded, "player");

    expect(assessment.rejoin.position).toBe(4);
    expect(assessment.rejoin.trafficLevel).toBe("HIGH");
    expect(assessment.rejoin.nearbyCarIds).toHaveLength(4);
    expect(assessment.battle.preferred).toBe("OVERCUT");
    expect(assessment.call).toBe("EXTEND");
  });

  it("boxes for the intermediate crossover when sustained rain repays the stop", () => {
    const wetContext = context(
      { weather: wetWeather },
      { currentLap: 38, tyreCompound: "SOFT", tyreSets: sets("player", "SOFT"), tyreLife: 78, tyreAgeLaps: 4 },
    );
    const assessment = calculateLiveStrategy(wetContext, "player");

    expect(assessment.crossover.shouldPit).toBe(true);
    expect(assessment.recommendedCompound).toBe("INTERMEDIATE");
    expect(assessment.crossover.netRaceGainSeconds).toBeGreaterThan(2.5);
    expect(assessment.call).toBe("BOX_NOW");
    expect(assessment.confidence).toBeGreaterThan(0.6);
  });

  it("keeps a reserved weather set available to the live recommendation", () => {
    const tyreSets = sets("player", "SOFT").map((set) => set.compound === "INTERMEDIATE"
      ? { ...set, status: "RESERVED" as const }
      : set.compound === "WET"
        ? { ...set, status: "USED" as const }
        : set);
    const assessment = calculateLiveStrategy(context(
      { weather: wetWeather },
      { currentLap: 38, tyreCompound: "SOFT", tyreSets, scheduledPitCompound: "INTERMEDIATE", tyreLife: 78, tyreAgeLaps: 4 },
    ), "player");

    expect(assessment.recommendedCompound).toBe("INTERMEDIATE");
    expect(assessment.crossover.compounds.some((estimate) => estimate.compound === "INTERMEDIATE")).toBe(true);
  });

  it("only adds the unserved portion of pit loss once a car is already in the pit procedure", () => {
    const track = calculateLiveStrategy(context({}, { pitStatus: "TRACK", gapToLeader: 7 }), "player");
    const pitEntry = calculateLiveStrategy(context({}, { pitStatus: "PIT_ENTRY", gapToLeader: 7 }), "player");
    const pitLane = calculateLiveStrategy(context({}, { pitStatus: "PIT_LANE", gapToLeader: 7 }), "player");
    const pitExit = calculateLiveStrategy(context({}, { pitStatus: "PIT_EXIT", gapToLeader: 7 }), "player");

    expect(track.rejoin.projectedGapToLeaderSeconds).toBe(30);
    expect(pitEntry.rejoin.projectedGapToLeaderSeconds).toBeCloseTo(25.86, 2);
    expect(pitLane.rejoin.projectedGapToLeaderSeconds).toBeCloseTo(18.96, 2);
    expect(pitExit.rejoin.projectedGapToLeaderSeconds).toBe(7);
  });

  it("returns byte-for-byte stable decisions and stable field order for identical telemetry", () => {
    const input = context({ raceControl: "VSC" }, { tyreLife: 53, gapToCarAhead: 2.1 });
    const first = calculateLiveStrategy(input, "player");
    const second = calculateLiveStrategy(input, "player");

    expect(second).toEqual(first);
    expect(calculateFieldLiveStrategies(input).map((assessment) => assessment.carId)).toEqual(["leader", "player", "third"]);
  });

  it("rejects malformed telemetry before it can contaminate projections", () => {
    const invalid = context({}, { currentSpeed: Number.NaN });
    expect(() => calculateLiveStrategy(invalid, "player")).toThrow(/currentSpeed/);
    expect(() => estimateLivePitLossSeconds("GREEN", -1)).toThrow(/doubleStackDelaySeconds/);
    expect(() => calculateLiveStrategy(context(), "missing")).toThrow(/Unknown carId/);
  });
});
