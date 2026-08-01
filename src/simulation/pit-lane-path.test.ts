import { describe, expect, it } from "vitest";
import type { RaceSnapshot } from "@/domain/race";
import { playerCarIdsFor } from "@/fixtures/grid";
import { createInitialSnapshot, PIT_BOX_DISTANCE, PIT_ENTRY_START, PIT_EXIT_END, pitBoxDistanceForTeam, setCarPit, stepSnapshot } from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

describe("pit lane path", () => {
  it("walks a stopping car from pit entry to the box and out again", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(11_201), status: "RUNNING" };
    const [carId] = playerCarIdsFor(snapshot.playerTeamId);
    for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
    snapshot = setCarPit(snapshot, carId, "MEDIUM");

    const samples: { status: string; lapDistance: number }[] = [];
    for (let tick = 0; tick < 5_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      if (car.pitStatus !== "TRACK") samples.push({ status: car.pitStatus, lapDistance: car.lapDistance });
      else if (samples.length > 0) break;
    }

    expect(samples.length).toBeGreaterThan(10);
    // The whole pit sequence must be expressed on the pit route, which runs from
    // the entry line, past the box, to the exit on the following lap.
    const routeEnd = SILVERSTONE_CIRCUIT.lengthMeters + PIT_EXIT_END;
    for (const sample of samples) {
      const onRoute = sample.lapDistance >= PIT_ENTRY_START - 1
        || sample.lapDistance <= PIT_EXIT_END + 1;
      expect(onRoute, `${sample.status} at ${sample.lapDistance.toFixed(1)}m`).toBe(true);
      expect(sample.lapDistance).toBeLessThanOrEqual(routeEnd + 1);
    }

    // The car must actually be seen approaching the box, not only at the exit.
    const approach = samples.filter((sample) => sample.lapDistance >= PIT_ENTRY_START && sample.lapDistance < PIT_BOX_DISTANCE);
    expect(approach.length).toBeGreaterThan(0);
  }, 40_000);

  it("holds the car at the box while the tyres are changed", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(11_202), status: "RUNNING" };
    const [carId] = playerCarIdsFor(snapshot.playerTeamId);
    const boxDistance = pitBoxDistanceForTeam(snapshot.cars.find((car) => car.carId === carId)!.teamId);
    for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
    snapshot = setCarPit(snapshot, carId, "SOFT");

    const boxDistances: number[] = [];
    for (let tick = 0; tick < 5_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      if (car.pitStatus === "PIT_STOP") boxDistances.push(car.lapDistance);
      else if (boxDistances.length > 0) break;
    }

    expect(boxDistances.length).toBeGreaterThan(1);
    // Stationary means the position does not move while the crew works.
    const spread = Math.max(...boxDistances) - Math.min(...boxDistances);
    expect(spread).toBeLessThan(2);
    // And it happens at this team's own garage, not at the pit exit.
    expect(Math.abs(boxDistances[0] - boxDistance)).toBeLessThan(20);
  }, 40_000);

  it("produces a realistic total pit-lane time that tracks the tyre change", () => {
    const stops: { laneSeconds: number; tyreSeconds: number }[] = [];

    for (const seed of [11_203, 11_204, 11_205, 11_206]) {
      let snapshot: RaceSnapshot = { ...createInitialSnapshot(seed), status: "RUNNING" };
      const [carId] = playerCarIdsFor(snapshot.playerTeamId);
      for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
      snapshot = setCarPit(snapshot, carId, "MEDIUM");

      for (let tick = 0; tick < 6_000; tick += 1) {
        snapshot = stepSnapshot(snapshot);
        const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
        if (car.lastPitLaneTime !== null && car.lastPitStopTime !== null && car.pitStatus === "TRACK") {
          stops.push({ laneSeconds: car.lastPitLaneTime, tyreSeconds: car.lastPitStopTime });
          break;
        }
      }
    }

    expect(stops.length).toBe(4);
    for (const stop of stops) {
      /*
       * Silverstone's pit lane costs roughly 19-24s in total: entry road, the
       * 80 km/h limited lane, the stationary time and the exit.
       */
      expect(stop.laneSeconds).toBeGreaterThan(16);
      expect(stop.laneSeconds).toBeLessThan(30);
      // A modern stop is around two seconds stationary.
      expect(stop.tyreSeconds).toBeGreaterThan(1.8);
      expect(stop.tyreSeconds).toBeLessThan(6);
      // The stationary time is part of the total, never larger than it.
      expect(stop.laneSeconds).toBeGreaterThan(stop.tyreSeconds);
    }

    // A slower tyre change has to cost more total pit-lane time.
    const sorted = [...stops].sort((left, right) => left.tyreSeconds - right.tyreSeconds);
    const spread = sorted.at(-1)!.tyreSeconds - sorted[0].tyreSeconds;
    if (spread > 0.2) {
      expect(sorted.at(-1)!.laneSeconds).toBeGreaterThan(sorted[0].laneSeconds);
    }
  }, 60_000);
});
