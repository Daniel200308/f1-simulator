import { describe, expect, it } from "vitest";

import { createInitialSnapshot } from "@/simulation/engine";
import {
  assessPitOperation,
  F1_2025_FASTEST_STOP_MEAN_SECONDS,
  F1_2025_FASTEST_STOP_RANGE_SECONDS,
  F1_2025_TYPICAL_CLEAN_STOP_SECONDS,
  resolvePitStopExecution,
} from "@/simulation/pit-operations";

describe("pit stop operations 2.0", () => {
  it("uses the official 2025 event-winning pit-stop benchmark", () => {
    expect(F1_2025_FASTEST_STOP_MEAN_SECONDS).toBe(2.082);
    expect(F1_2025_FASTEST_STOP_RANGE_SECONDS).toEqual([1.91, 2.32]);
    expect(F1_2025_TYPICAL_CLEAN_STOP_SECONDS).toBe(2.2);
  });

  it("returns deterministic service timing", () => {
    const snapshot = createInitialSnapshot(51);
    const context = { seed: snapshot.seed, tick: 100, elapsedTime: 10, pitLaneOpen: true, cars: snapshot.cars };
    expect(resolvePitStopExecution(context, snapshot.cars[0].carId)).toEqual(resolvePitStopExecution(context, snapshot.cars[0].carId));
  });

  it("separates wheel-change time from queue and release delays", () => {
    const snapshot = createInitialSnapshot(5_101);
    const context = { seed: snapshot.seed, tick: 100, elapsedTime: 10, pitLaneOpen: true, cars: snapshot.cars };
    const execution = resolvePitStopExecution(context, snapshot.cars[0].carId);

    expect(execution.tyreServiceSeconds).toBeCloseTo(execution.serviceSeconds + execution.serviceIssueDelaySeconds, 8);
    expect(execution.stationarySeconds).toBeCloseTo(
      execution.tyreServiceSeconds + execution.queueDelaySeconds + execution.releaseDelaySeconds,
      8,
    );
    expect(execution.tyreServiceSeconds).toBeGreaterThan(1.9);
  });

  it("keeps the same stop forecast while live ticks advance", () => {
    const snapshot = createInitialSnapshot(51);
    const base = { seed: snapshot.seed, elapsedTime: 10, pitLaneOpen: true, cars: snapshot.cars };
    const carId = snapshot.cars[0].carId;

    const forecasts = [12, 13, 14].map((tick) => assessPitOperation({ ...base, tick }, carId, "HARD"));

    expect(forecasts[1]).toEqual(forecasts[0]);
    expect(forecasts[2]).toEqual(forecasts[0]);
  });

  it("detects and prices a double-stack conflict", () => {
    const snapshot = createInitialSnapshot(52);
    const [first, second] = snapshot.cars;
    const cars = snapshot.cars.map((car) => car.carId === first.carId
      ? { ...car, pitStatus: "PIT_STOP" as const, gridPosition: 20 }
      : car.carId === second.carId ? { ...car, pitStatus: "PIT_LANE" as const, gridPosition: 1 } : car);
    const context = { seed: snapshot.seed, tick: 101, elapsedTime: 10.1, pitLaneOpen: true, cars };
    const result = resolvePitStopExecution(context, second.carId);
    expect(result.issue).toBe("DOUBLE_STACK");
    expect(result.queueDelaySeconds).toBeGreaterThan(1.5);
  });

  it("warns the trailing car when a close teammate is already booked this lap", () => {
    const snapshot = createInitialSnapshot(55);
    const [first, second] = snapshot.cars;
    const cars = snapshot.cars.map((car) => car.carId === first.carId
      ? { ...car, scheduledPitCompound: "HARD" as const, gapToLeader: 4.2, racePosition: 1 }
      : car.carId === second.carId ? { ...car, gapToLeader: 5.1, racePosition: 2 } : car);

    const result = assessPitOperation({ seed: snapshot.seed, tick: 30, elapsedTime: 3, pitLaneOpen: true, cars }, second.carId, "HARD");

    expect(result.doubleStackConflict).toBe(true);
    expect(result.readiness).toBe("WATCH");
    expect(result.predictedIssue).toBe("DOUBLE_STACK");
  });

  it("blocks a call when no selected tyre set is available", () => {
    const snapshot = createInitialSnapshot(53);
    const car = snapshot.cars[0];
    const cars = snapshot.cars.map((candidate) => candidate.carId === car.carId
      ? { ...candidate, tyreSets: candidate.tyreSets.map((set) => set.compound === "WET" ? { ...set, status: "USED" as const } : set) }
      : candidate);
    const result = assessPitOperation({ seed: snapshot.seed, tick: 1, elapsedTime: 0, pitLaneOpen: true, cars }, car.carId, "WET");
    expect(result.readiness).toBe("BLOCKED");
    expect(result.tyreSetReady).toBe(false);
  });

  it("blocks duplicate calls once a car has entered the pit sequence", () => {
    const snapshot = createInitialSnapshot(54);
    const car = snapshot.cars[0];
    const cars = snapshot.cars.map((candidate) => candidate.carId === car.carId
      ? { ...candidate, pitStatus: "PIT_LANE" as const }
      : candidate);
    const result = assessPitOperation({ seed: snapshot.seed, tick: 20, elapsedTime: 2, pitLaneOpen: true, cars }, car.carId, "HARD");

    expect(result.readiness).toBe("BLOCKED");
    expect(result.reasons[0]).toMatch(/already in progress/i);
  });
});
