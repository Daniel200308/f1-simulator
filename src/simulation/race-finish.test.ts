import { describe, expect, it } from "vitest";

import { createInitialSnapshot } from "@/simulation/engine";
import { classifiedFieldHasFinished, shouldShowDriverMarkers } from "@/simulation/race-finish";

describe("race finish classification", () => {
  it("waits for the last non-retired driver but excludes retirements", () => {
    const initial = createInitialSnapshot(20_260_744);
    const lastRunnerId = initial.cars[0].carId;
    const cars = initial.cars.map((car) => car.carId === lastRunnerId
      ? { ...car, finished: false, finishTime: null }
      : { ...car, incidentStatus: "RETIRED" as const, finished: true, finishTime: null });

    expect(classifiedFieldHasFinished(cars)).toBe(false);
    expect(classifiedFieldHasFinished(cars.map((car) => car.carId === lastRunnerId
      ? { ...car, finished: true, finishTime: 5_100 }
      : car))).toBe(true);
  });

  it("clears every driver marker only in the finished state", () => {
    expect(shouldShowDriverMarkers("RUNNING")).toBe(true);
    expect(shouldShowDriverMarkers("PAUSED")).toBe(true);
    expect(shouldShowDriverMarkers("FINISHED")).toBe(false);
  });
});
