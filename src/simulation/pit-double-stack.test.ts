import { describe, expect, it } from "vitest";
import type { RaceSnapshot } from "@/domain/race";
import { playerCarIdsFor } from "@/fixtures/grid";
import { createInitialSnapshot, setCarPit, stepSnapshot } from "@/simulation/engine";

describe("double pit stack", () => {
  it("runs both player cars through the pit lane with their own timers", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(9_412), status: "RUNNING" };
    const [firstCar, secondCar] = playerCarIdsFor(snapshot.playerTeamId);

    // Get the field running before calling both cars in on the same lap.
    for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
    snapshot = setCarPit(snapshot, firstCar, "MEDIUM");
    snapshot = setCarPit(snapshot, secondCar, "MEDIUM");

    let bothInPitLane = false;
    const tyreServiceSeen = new Set<string>();
    for (let tick = 0; tick < 6_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      const cars = [firstCar, secondCar].map((carId) => snapshot.cars.find((car) => car.carId === carId)!);
      if (cars.every((car) => car.pitStatus !== "TRACK")) bothInPitLane = true;
      for (const car of cars) {
        if (car.pitStatus === "PIT_STOP") tyreServiceSeen.add(car.carId);
      }
      // Run until both stops are actually complete, not merely under way.
      if (cars.every((car) => car.pitStops >= 1 && car.pitStatus === "TRACK")) break;
    }

    expect(bothInPitLane).toBe(true);
    // Each car must have its own tyre-service phase, which is what the stacked
    // pit panel renders one timer per.
    expect([...tyreServiceSeen].sort()).toEqual([firstCar, secondCar].sort());

    for (const carId of [firstCar, secondCar]) {
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      expect(car.pitStops).toBeGreaterThanOrEqual(1);
    }
  }, 40_000);

  it("reports a distinct tyre-change and total pit-lane time per car", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(9_413), status: "RUNNING" };
    const [firstCar, secondCar] = playerCarIdsFor(snapshot.playerTeamId);
    for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
    snapshot = setCarPit(snapshot, firstCar, "HARD");
    snapshot = setCarPit(snapshot, secondCar, "HARD");

    for (let tick = 0; tick < 5_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      const done = [firstCar, secondCar].every((carId) => {
        const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
        return car.lastPitStopTime !== null && car.lastPitLaneTime !== null;
      });
      if (done) break;
    }

    for (const carId of [firstCar, secondCar]) {
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      expect(car.lastPitStopTime).toBeGreaterThan(0);
      expect(car.lastPitLaneTime).toBeGreaterThan(car.lastPitStopTime!);
    }
  }, 40_000);

  it("exposes a live tyre-service phase for the pulsing clock to key off", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(9_414), status: "RUNNING" };
    const [firstCar] = playerCarIdsFor(snapshot.playerTeamId);
    for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
    snapshot = setCarPit(snapshot, firstCar, "SOFT");

    /*
     * The UI pulses the tyre clock exactly while `pitStatus === "PIT_STOP"`, so
     * that phase has to be observable and its elapsed service time has to climb.
     */
    const serviceSamples: number[] = [];
    for (let tick = 0; tick < 4_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === firstCar)!;
      if (car.pitStatus === "PIT_STOP") {
        serviceSamples.push(car.pitTyreServiceElapsedSeconds ?? car.pitTimer);
      } else if (serviceSamples.length > 0) {
        break;
      }
    }

    expect(serviceSamples.length).toBeGreaterThan(1);
    expect(serviceSamples.at(-1)!).toBeGreaterThan(serviceSamples[0]);
  }, 40_000);
});
