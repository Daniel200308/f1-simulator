import { describe, expect, it } from "vitest";

import type { RaceCarState } from "@/domain/race";
import { TEAM_BY_ID } from "@/fixtures/grid";
import { buildAiStrategyDecision } from "@/simulation/ai-strategy";
import { createInitialSnapshot } from "@/simulation/engine";

function aiCars(): RaceCarState[] {
  return createInitialSnapshot(4_242).cars.filter((car) => !TEAM_BY_ID.get(car.teamId)?.isPlayer);
}

describe("AI strategy model", () => {
  it("reacts immediately to a wet-weather crossover using an available wet set", () => {
    const cars = aiCars();
    const car = cars[0];
    const decision = buildAiStrategyDecision({ trackWetness: 0.7, raceControl: "GREEN", pitLaneOpen: true, cars }, car);
    expect(decision.pitNow).toBe(true);
    expect(decision.compound).toBe("WET");
    expect(decision.intent).toBe("WEATHER");
    expect(decision.confidence).toBeGreaterThan(0.6);
  });

  it("never selects a compound with no available tyre set", () => {
    const cars = aiCars();
    const original = cars[0];
    const car: RaceCarState = { ...original, tyreSets: original.tyreSets.map((set) => set.compound === "WET" ? { ...set, status: "USED" as const } : set) };
    const contextCars = cars.map((candidate) => candidate.carId === car.carId ? car : candidate);
    const decision = buildAiStrategyDecision({ trackWetness: 0.72, raceControl: "GREEN", pitLaneOpen: true, cars: contextCars }, car);
    expect(decision.pitNow).toBe(true);
    expect(decision.compound).toBe("INTERMEDIATE");
  });

  it("uses a VSC to stop earlier than it would under green", () => {
    const cars = aiCars();
    const car: RaceCarState = { ...cars[0], tyreLife: 58, currentLap: 12, gapToCarAhead: 4 };
    const contextCars = cars.map((candidate) => candidate.carId === car.carId ? car : candidate);
    const green = buildAiStrategyDecision({ trackWetness: 0, raceControl: "GREEN", pitLaneOpen: true, cars: contextCars }, car);
    const vsc = buildAiStrategyDecision({ trackWetness: 0, raceControl: "VSC", pitLaneOpen: true, cars: contextCars }, car);
    expect(green.pitNow).toBe(false);
    expect(vsc.pitNow).toBe(true);
    expect(vsc.intent).toBe("CHEAP_STOP");
  });

  it("keeps fresh dry tyres on track during the opening laps", () => {
    const snapshot = createInitialSnapshot(4_242);
    const cars = snapshot.cars.filter((car) => !TEAM_BY_ID.get(car.teamId)?.isPlayer);
    const softCar = cars.find((car) => car.tyreCompound === "SOFT")!;
    const decision = buildAiStrategyDecision({
      trackWetness: 0,
      weather: snapshot.weather,
      raceControl: "GREEN",
      pitLaneOpen: true,
      cars,
    }, softCar);

    expect(decision.pitNow).toBe(false);
    expect(decision.compound).toBeNull();
  });

  it("produces different rational tyre choices from team strategy profiles", () => {
    const cars = aiCars().map((car) => ({ ...car, currentLap: 40, tyreLife: 34 }));
    const choices = cars.map((car) => buildAiStrategyDecision({ trackWetness: 0, raceControl: "GREEN", pitLaneOpen: true, cars }, car).compound);
    expect(new Set(choices).size).toBeGreaterThan(1);
    expect(choices.every((compound) => compound === "SOFT" || compound === "MEDIUM")).toBe(true);
  });

  it("does not change a decision when hidden rival resource values change", () => {
    const cars = aiCars();
    const car: RaceCarState = { ...cars[0], tyreLife: 42, currentLap: 24, gapToCarAhead: 1.2 };
    const baselineCars = cars.map((candidate) => candidate.carId === car.carId ? car : candidate);
    const hiddenRivalChanges = baselineCars.map((candidate) => candidate.teamId === car.teamId ? candidate : { ...candidate, tyreLife: 1, batteryPercent: 0, fuelRemainingKg: 1, damageLevel: 0.9 });
    const baseline = buildAiStrategyDecision({ trackWetness: 0, raceControl: "GREEN", pitLaneOpen: true, cars: baselineCars }, car);
    const changed = buildAiStrategyDecision({ trackWetness: 0, raceControl: "GREEN", pitLaneOpen: true, cars: hiddenRivalChanges }, car);
    expect(changed).toEqual(baseline);
  });
});
