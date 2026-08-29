import { describe, expect, it } from "vitest";

import {
  MAX_RETIREMENTS_PER_RACE,
  MIN_RETIREMENTS_PER_RACE,
  createInitialSnapshot,
  plannedRetirementCount,
  plannedRetirementTriggerDistance,
  stepSnapshot,
} from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

describe("race retirement plan", () => {
  it("sets every seed to a target between two and six retirements", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      expect(plannedRetirementCount(seed)).toBeGreaterThanOrEqual(MIN_RETIREMENTS_PER_RACE);
      expect(plannedRetirementCount(seed)).toBeLessThanOrEqual(MAX_RETIREMENTS_PER_RACE);
    }
  });

  it("spreads the planned incidents across the race in increasing order", () => {
    const seed = 20_260_801;
    const count = plannedRetirementCount(seed);
    const distances = Array.from({ length: count }, (_, index) => plannedRetirementTriggerDistance(seed, index, count));
    expect(distances).toEqual([...distances].sort((left, right) => left - right));
    expect(distances[0]).toBeGreaterThan(SILVERSTONE_CIRCUIT.lengthMeters * 7);
    expect(distances.at(-1)).toBeLessThan(SILVERSTONE_CIRCUIT.lengthMeters * 47);
  });

  it("creates a real retirement when the first planned distance is reached", () => {
    const seed = 20_260_811;
    const initial = createInitialSnapshot(seed, "RUNNING");
    const trigger = plannedRetirementTriggerDistance(seed, 0);
    const before = {
      ...initial,
      tick: 9,
      elapsedTime: 180,
      scheduledSafetyCarDistance: SILVERSTONE_CIRCUIT.lengthMeters * 60,
      cars: initial.cars.map((car, index) => ({
        ...car,
        totalDistance: trigger + 20 - index * 12,
        lapDistance: ((trigger + 20 - index * 12) % SILVERSTONE_CIRCUIT.lengthMeters + SILVERSTONE_CIRCUIT.lengthMeters) % SILVERSTONE_CIRCUIT.lengthMeters,
        reactionTime: 0,
        currentSpeed: 240,
      })),
    };
    const after = stepSnapshot(before);
    const retired = after.cars.filter((car) => car.incidentStatus === "RETIRED");
    expect(retired).toHaveLength(1);
    expect(retired[0]).toMatchObject({ finished: true, currentSpeed: 0, finishTime: null });
    expect(after.events.some((event) => event.message.includes("retired"))).toBe(true);
  });

  it("reaches the seed target without ever exceeding six retirements", () => {
    const seed = 20_260_823;
    const target = plannedRetirementCount(seed);
    let snapshot = createInitialSnapshot(seed, "RUNNING");

    for (let index = 0; index < target; index += 1) {
      const trigger = plannedRetirementTriggerDistance(seed, index, target);
      snapshot = stepSnapshot({
        ...snapshot,
        tick: index * 10 + 9,
        elapsedTime: 300 + index * 300,
        raceControl: "GREEN",
        raceControlTimer: 0,
        activeIncident: null,
        scheduledSafetyCarDistance: SILVERSTONE_CIRCUIT.lengthMeters * 60,
        cars: snapshot.cars.map((car, carIndex) => car.incidentStatus === "RETIRED" ? car : ({
          ...car,
          totalDistance: trigger + 30 - carIndex * 4,
          lapDistance: ((trigger + 30 - carIndex * 4) % SILVERSTONE_CIRCUIT.lengthMeters + SILVERSTONE_CIRCUIT.lengthMeters) % SILVERSTONE_CIRCUIT.lengthMeters,
          reactionTime: 0,
          currentSpeed: 235,
        })),
      });
      expect(snapshot.cars.filter((car) => car.incidentStatus === "RETIRED")).toHaveLength(index + 1);
    }

    expect(target).toBeGreaterThanOrEqual(MIN_RETIREMENTS_PER_RACE);
    expect(target).toBeLessThanOrEqual(MAX_RETIREMENTS_PER_RACE);
  });
});
