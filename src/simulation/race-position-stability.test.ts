import { describe, expect, it } from "vitest";
import { createInitialSnapshot, stepSnapshot } from "@/simulation/engine";
import type { RaceSnapshot } from "@/domain/race";

describe("race position stability", () => {
  it("never moves a running car more than one place in a single tick", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(7_311), status: "RUNNING" };
    const jumps: string[] = [];

    for (let tick = 0; tick < 4_000; tick += 1) {
      const previous = new Map(snapshot.cars.map((car) => [car.carId, car]));
      snapshot = stepSnapshot(snapshot);

      for (const car of snapshot.cars) {
        const before = previous.get(car.carId);
        if (!before) continue;
        // Retirements, finishes, and cars crossing pit-lane runners legitimately
        // reshuffle more than one classification place in a single simulation tick.
        if (car.incidentStatus === "RETIRED" || before.incidentStatus === "RETIRED") continue;
        if (car.finishTime !== null || before.finishTime !== null) continue;
        const delta = Math.abs(car.racePosition - before.racePosition);
        const crossedPitCar = delta > 1 && snapshot.cars.some((candidate) => {
          if (candidate.carId === car.carId) return false;
          const candidateBefore = previous.get(candidate.carId);
          if (!candidateBefore) return false;
          const wasCrossed = car.racePosition < before.racePosition
            ? candidateBefore.racePosition < before.racePosition &&
              candidateBefore.racePosition >= car.racePosition
            : candidateBefore.racePosition > before.racePosition &&
              candidateBefore.racePosition <= car.racePosition;
          return wasCrossed &&
            (candidateBefore.pitStatus !== "TRACK" || candidate.pitStatus !== "TRACK");
        });
        if (crossedPitCar) continue;
        if (delta > 1 && jumps.length < 10) {
          jumps.push(`tick=${tick} ${car.carId} P${before.racePosition} -> P${car.racePosition}`);
        }
      }
    }

    expect(jumps).toEqual([]);
  }, 40_000);

  it("keeps the classification order consistent with running distance", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(7_312), status: "RUNNING" };
    for (let tick = 0; tick < 2_000; tick += 1) snapshot = stepSnapshot(snapshot);

    const running = snapshot.cars
      .filter((car) => car.incidentStatus !== "RETIRED" && car.finishTime === null)
      .sort((left, right) => left.racePosition - right.racePosition);

    for (let index = 1; index < running.length; index += 1) {
      // A car classified ahead must have covered at least as much distance.
      expect(running[index - 1].totalDistance).toBeGreaterThanOrEqual(running[index].totalDistance);
    }
  }, 30_000);
});
