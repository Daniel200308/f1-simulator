import { describe, expect, it } from "vitest";

import { createInitialSnapshot } from "@/simulation/engine";
import { calculateRacecraftDecision } from "@/simulation/racecraft";

describe("racecraft AI 2.0", () => {
  it("selects an attack when the car ahead is within range", () => {
    const snapshot = createInitialSnapshot(20);
    const cars = snapshot.cars.map((car, index) => index === 1
      ? { ...car, currentSpeed: 300, gapToCarAhead: 0.55, batteryPercent: 82, currentSegment: 0 }
      : index === 0 ? { ...car, currentSpeed: 286 } : car);
    const decision = calculateRacecraftDecision({ raceControl: "GREEN", weather: snapshot.weather, cars }, cars[1].carId);
    expect(decision.intent).toBe("ATTACK");
    expect(decision.recommendedEnergyMode).toBe("ATTACK");
    expect(decision.overtakeProbability).toBeGreaterThan(0.5);
    expect(decision.trackLineOffset).toBe(0);
  });

  it("prioritises harvesting when thermal protection is active", () => {
    const snapshot = createInitialSnapshot(21);
    const car = snapshot.cars[1];
    const cars = snapshot.cars.map((candidate) => candidate.carId === car.carId
      ? { ...candidate, gapToCarAhead: 0.45, batteryPercent: 80, thermalDeratePercent: 4, thermalRiskPercent: 18 }
      : candidate);
    const decision = calculateRacecraftDecision({ raceControl: "GREEN", weather: snapshot.weather, cars }, car.carId);
    expect(decision.intent).toBe("HARVEST");
    expect(decision.recommendedPaceMode).toBe("COOL");
    expect(decision.recommendedEnergyMode).toBe("RECHARGE");
  });

  it("neutralises attack instructions under safety car", () => {
    const snapshot = createInitialSnapshot(22);
    const car = snapshot.cars[1];
    const decision = calculateRacecraftDecision({ raceControl: "SAFETY_CAR", weather: snapshot.weather, cars: snapshot.cars }, car.carId);
    expect(decision.intent).toBe("HARVEST");
    expect(decision.overtakeProbability).toBe(0);
  });

  it("returns a safe hold state for a retired selected car", () => {
    const snapshot = createInitialSnapshot(23);
    const car = snapshot.cars[1];
    const cars = snapshot.cars.map((candidate) => candidate.carId === car.carId
      ? { ...candidate, incidentStatus: "RETIRED" as const, finished: true }
      : candidate);

    const decision = calculateRacecraftDecision({ raceControl: "GREEN", weather: snapshot.weather, cars }, car.carId);

    expect(decision.intent).toBe("HOLD");
    expect(decision.overtakeProbability).toBe(0);
    expect(decision.reasons[0]).toMatch(/retired/i);
  });
});
