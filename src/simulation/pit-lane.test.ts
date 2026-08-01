import { describe, expect, it } from "vitest";
import type { RaceSnapshot } from "@/domain/race";
import { TEAMS } from "@/fixtures/grid";
import { playerCarIdsFor } from "@/fixtures/grid";
import { createInitialSnapshot, setCarPit, stepSnapshot } from "@/simulation/engine";
import {
  PIT_BOX_ORDER,
  PIT_ENTRY_START,
  PIT_EXIT_END,
  PIT_LANE_START,
  PIT_ROUTE_LENGTH_METERS,
  pitBoxDistanceForTeam,
  pitBoxRouteProgressForTeam,
  pitRouteDistanceFor,
  pitRouteProgressFor,
} from "@/simulation/pit-lane";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

describe("pit lane route", () => {
  it("measures the corridor from the entry line across the timing line", () => {
    expect(pitRouteDistanceFor(PIT_ENTRY_START)).toBeCloseTo(0, 6);
    expect(pitRouteDistanceFor(PIT_EXIT_END)).toBeCloseTo(PIT_ROUTE_LENGTH_METERS, 6);
    // The lap boundary must not restart the corridor coordinate.
    const beforeLine = pitRouteDistanceFor(SILVERSTONE_CIRCUIT.lengthMeters - 1);
    const afterLine = pitRouteDistanceFor(1);
    expect(afterLine).toBeGreaterThan(beforeLine);
  });

  it("keeps every stage of a stop inside the corridor instead of at the exit", () => {
    const stages = [PIT_ENTRY_START, PIT_LANE_START, SILVERSTONE_CIRCUIT.lengthMeters - 45];
    const progressions = stages.map((distance) => pitRouteProgressFor(distance));
    for (const progress of progressions) {
      expect(progress).toBeGreaterThanOrEqual(0);
      // The previous renderer collapsed the approach onto the exit (progress 1).
      expect(progress).toBeLessThan(1);
    }
    // And the sequence has to advance down the lane.
    expect(progressions).toEqual([...progressions].sort((left, right) => left - right));
    expect(new Set(progressions).size).toBe(stages.length);
  });

  it("gives every team its own box, ordered along the lane", () => {
    expect(PIT_BOX_ORDER).toHaveLength(TEAMS.length);
    const distances = PIT_BOX_ORDER.map((teamId) => pitBoxDistanceForTeam(teamId));
    expect(new Set(distances).size).toBe(TEAMS.length);
    for (const distance of distances) {
      // Boxes sit in the limited lane, after the limiter line and before the exit.
      expect(distance).toBeGreaterThan(PIT_LANE_START);
      expect(distance).toBeLessThan(SILVERSTONE_CIRCUIT.lengthMeters);
    }
    const progressions = PIT_BOX_ORDER.map((teamId) => pitBoxRouteProgressForTeam(teamId));
    for (const progress of progressions) {
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(1);
    }
  });

  it("advances a real stop monotonically along the corridor, box included", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(11_601), status: "RUNNING" };
    const [carId] = playerCarIdsFor(snapshot.playerTeamId);
    for (let tick = 0; tick < 900; tick += 1) snapshot = stepSnapshot(snapshot);
    snapshot = setCarPit(snapshot, carId, "MEDIUM");

    const samples: { status: string; progress: number }[] = [];
    for (let tick = 0; tick < 6_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      if (car.pitStatus !== "TRACK") samples.push({ status: car.pitStatus, progress: pitRouteProgressFor(car.lapDistance) });
      else if (samples.length > 0) break;
    }

    const stages = [...new Set(samples.map((sample) => sample.status))];
    expect(stages).toContain("PIT_ENTRY");
    expect(stages).toContain("PIT_LANE");
    expect(stages).toContain("PIT_STOP");
    expect(stages).toContain("PIT_EXIT");

    // Every stage is drawn somewhere inside the corridor, and the sequence only
    // moves forwards. The old renderer pinned the whole stop at progress 1.
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].progress).toBeGreaterThanOrEqual(samples[index - 1].progress - 1e-9);
    }
    const approach = samples.filter((sample) => sample.status === "PIT_ENTRY" || sample.status === "PIT_LANE");
    expect(approach.every((sample) => sample.progress < 1)).toBe(true);
    // The stationary phase happens partway down the lane, not at the exit.
    const box = samples.filter((sample) => sample.status === "PIT_STOP");
    expect(box.length).toBeGreaterThan(1);
    expect(new Set(box.map((sample) => sample.progress.toFixed(6))).size).toBe(1);
    expect(box[0].progress).toBeGreaterThan(0);
    expect(box[0].progress).toBeLessThan(1);
  }, 40_000);

  it("walks AI cars through the lane and stops them at their own boxes", () => {
    let snapshot: RaceSnapshot = { ...createInitialSnapshot(11_602), status: "RUNNING" };
    const seen = new Map<string, Set<string>>();
    const stopDistanceByTeam = new Map<string, number[]>();

    for (let tick = 0; tick < 40_000; tick += 1) {
      snapshot = stepSnapshot(snapshot);
      for (const car of snapshot.cars) {
        if (car.pitStatus === "TRACK" || car.teamId === snapshot.playerTeamId) continue;
        const stages = seen.get(car.carId) ?? new Set<string>();
        stages.add(car.pitStatus);
        seen.set(car.carId, stages);
        if (car.pitStatus === "PIT_STOP") {
          stopDistanceByTeam.set(car.teamId, [...(stopDistanceByTeam.get(car.teamId) ?? []), car.lapDistance]);
        }
      }
      if (stopDistanceByTeam.size >= 4) break;
    }

    // AI cars have to drive the lane themselves rather than reappear at the exit.
    const drivers = [...seen.values()];
    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers.some((stages) => stages.has("PIT_ENTRY") || stages.has("PIT_LANE"))).toBe(true);
    expect(stopDistanceByTeam.size).toBeGreaterThan(1);
    /*
     * Every stop happens at that team's own garage. A car commits to the box on
     * the tick it reaches it, so allow the one step of travel that implies.
     */
    for (const [teamId, distances] of stopDistanceByTeam) {
      const box = pitBoxDistanceForTeam(teamId);
      for (const distance of distances) expect(Math.abs(distance - box)).toBeLessThan(12);
    }
    // Different teams use different parts of the lane.
    const boxes = [...stopDistanceByTeam.keys()].map((teamId) => pitBoxDistanceForTeam(teamId));
    expect(new Set(boxes).size).toBe(boxes.length);
  }, 60_000);
});
