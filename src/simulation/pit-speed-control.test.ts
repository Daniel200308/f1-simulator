import { describe, expect, it } from "vitest";

import type { RaceInvestigation, RaceSnapshot } from "@/domain/race";
import {
  createInitialSnapshot,
  PIT_ENTRY_START,
  setCarPit,
  stepSnapshot,
} from "@/simulation/engine";
import { FIA_2026_PENALTY_RULES, pitSpeedingIncidentQuota } from "@/simulation/fia-2026-rules";

function completedPitSpeedingInvestigation(snapshot: RaceSnapshot, index: number): RaceInvestigation {
  const car = snapshot.cars[index];
  return {
    id: `test-pit-speed-${index}`,
    incidentId: `test-pit-speed-incident-${index}`,
    carId: car.carId,
    teamId: car.teamId,
    driverId: car.driverId,
    infringement: "PIT_SPEEDING",
    status: "DECIDED",
    reason: "PIT LANE SPEEDING",
    evidence: "81.2 km/h · limit 80 km/h",
    severity: 0.3,
    responsibility: 1,
    notedAt: 1,
    investigationAt: 4,
    decisionDueAt: 66,
    decidedAt: 66,
    outcomePenaltyId: null,
  };
}

describe("80 km/h pit-lane limiter", () => {
  it("creates only the seeded rare limiter mistakes during a mass pit entry", () => {
    let snapshot = createInitialSnapshot(421, "RUNNING");
    snapshot = {
      ...snapshot,
      status: "RUNNING",
      elapsedTime: 20,
      cars: snapshot.cars.map((car) => ({
        ...car,
        pitStatus: "PIT_ENTRY" as const,
        totalDistance: PIT_ENTRY_START + 52,
        lapDistance: PIT_ENTRY_START + 52,
        currentSpeed: 250,
        reactionTime: 0,
      })),
    };

    snapshot = stepSnapshot(snapshot);
    const limitedCars = snapshot.cars.filter((car) => car.pitStatus === "PIT_LANE");
    const speeders = limitedCars.filter((car) => car.currentSpeed > FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph);
    const normalCars = limitedCars.filter((car) => car.currentSpeed <= FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph);
    const quota = pitSpeedingIncidentQuota(snapshot.seed);

    expect(speeders).toHaveLength(quota);
    expect(speeders.every((car) => car.currentSpeed < 85)).toBe(true);
    expect(normalCars.every((car) => car.currentSpeed <= 80)).toBe(true);
    snapshot = stepSnapshot(stepSnapshot(snapshot));
    expect(snapshot.investigations.filter((investigation) => investigation.infringement === "PIT_SPEEDING")).toHaveLength(quota);

    for (let index = 0; index < 850; index += 1) snapshot = stepSnapshot(snapshot);
    const penalties = snapshot.penalties.filter((penalty) => penalty.infringement === "PIT_SPEEDING");
    expect(penalties).toHaveLength(quota);
    expect(penalties.every((penalty) => penalty.type === "TIME_5")).toBe(true);
    // Speeding is rare, so most seeds produce no incident and therefore no call.
    if (quota > 0) {
      expect(snapshot.radioMessages.some((message) => message.source === "RACE CONTROL" && message.message.includes("KM/H IN 80 KM/H ZONE"))).toBe(true);
    }
  });

  it("keeps a normal car at or below 80 km/h and derives a realistic full pit-lane time", () => {
    let snapshot = createInitialSnapshot(420, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId === snapshot.playerTeamId)!.carId;
    snapshot = {
      ...snapshot,
      status: "RUNNING",
      elapsedTime: 20,
      investigations: Array.from(
        { length: pitSpeedingIncidentQuota(snapshot.seed) },
        (_, index) => completedPitSpeedingInvestigation(snapshot, index),
      ),
      cars: snapshot.cars.map((car) => car.carId === carId ? {
        ...car,
        currentLap: 2,
        totalDistance: PIT_ENTRY_START + 1,
        lapDistance: PIT_ENTRY_START + 1,
        currentSpeed: 296,
        reactionTime: 0,
      } : car),
    };
    snapshot = setCarPit(snapshot, carId, "SOFT");

    let maximumLimitedSpeed = 0;
    let completed = false;
    for (let index = 0; index < 500; index += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      if (car.pitStatus === "PIT_LANE" || car.pitStatus === "PIT_EXIT") {
        maximumLimitedSpeed = Math.max(maximumLimitedSpeed, car.currentSpeed);
      }
      if (car.pitStops > 0 && car.pitStatus === "TRACK") {
        completed = true;
        break;
      }
    }

    const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(completed).toBe(true);
    expect(maximumLimitedSpeed).toBeLessThanOrEqual(FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph);
    expect(car.lastPitLaneTime).toBeGreaterThan(15);
    expect(car.lastPitLaneTime).toBeLessThan(20);
    expect(snapshot.investigations.filter((investigation) => investigation.carId === carId && investigation.infringement === "PIT_SPEEDING")).toHaveLength(0);
  });
});
