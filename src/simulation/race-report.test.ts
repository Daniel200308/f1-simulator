import { describe, expect, it } from "vitest";

import type { RaceSnapshot } from "@/domain/race";
import { PLAYER_CAR_IDS } from "@/fixtures/grid";
import { createInitialSnapshot } from "@/simulation/engine";
import { buildRaceReport } from "@/simulation/race-report";
import { RaceReplayRecorder } from "@/simulation/race-replay";

function completedSnapshot(): RaceSnapshot {
  const initial = createInitialSnapshot(204);
  const first = initial.cars[0];
  const second = initial.cars[1];
  return {
    ...initial,
    status: "FINISHED",
    elapsedTime: 5_400,
    cars: initial.cars.map((car) => car.carId === first.carId ? {
      ...car,
      racePosition: 2,
      finished: true,
      finishTime: 5_402,
      totalRaceTime: 5_402,
      bestLapTime: 89.4,
      pitStops: 2,
      overtakes: 3,
      lastPitStopTime: 2.5,
      pitStopIssue: "WHEEL_GUN" as const,
      usedTyreCompounds: ["MEDIUM", "HARD", "MEDIUM"] as const,
      tyreCompound: "SOFT" as const,
    } : car.carId === second.carId ? {
      ...car,
      racePosition: 1,
      gridPosition: 4,
      finished: true,
      finishTime: 5_400,
      totalRaceTime: 5_400,
      bestLapTime: 88.8,
      pitStops: 1,
      overtakes: 4,
      usedTyreCompounds: ["SOFT", "MEDIUM"] as const,
      tyreCompound: "MEDIUM" as const,
    } : car.carId === initial.cars[2].carId ? {
      ...car,
      racePosition: 22,
      incidentStatus: "RETIRED" as const,
      retiredReason: "Power unit",
      finished: true,
    } : {
      ...car,
      finished: true,
      finishTime: 5_400 + car.racePosition * 2,
    }),
  };
}

describe("buildRaceReport", () => {
  it("builds an ordered classification and fastest lap", () => {
    const snapshot = completedSnapshot();
    const report = buildRaceReport(snapshot);

    expect(report.completed).toBe(true);
    expect(report.classification[0]).toMatchObject({ carId: snapshot.cars[1].carId, position: 1, gridPosition: 4, positionsGained: 3 });
    expect(report.fastestLap).toMatchObject({ carId: snapshot.cars[1].carId, lapTimeSeconds: 88.8 });
    expect(report.classification.find((entry) => entry.carId === snapshot.cars[2].carId)?.status).toBe("RETIRED");
  });

  it("uses winner finish time and final timing gaps for a completed race", () => {
    const snapshot = completedSnapshot();
    const delayedFinishSnapshot = {
      ...snapshot,
      elapsedTime: 5_880,
      cars: snapshot.cars.map((car) => car.racePosition === 2 ? { ...car, gapToLeader: 99 } : car),
    };

    const report = buildRaceReport(delayedFinishSnapshot);

    expect(report.elapsedTimeSeconds).toBe(5_400);
    expect(report.classification.find((entry) => entry.position === 2)?.gapToWinnerSeconds).toBe(2);
  });

  it("summarises pit issues and complete tyre sequences", () => {
    const snapshot = completedSnapshot();
    const report = buildRaceReport(snapshot);
    const playerOnePit = report.pitStops.find((stop) => stop.carId === snapshot.cars[0].carId);
    const playerOneTyres = report.tyreStrategies.find((strategy) => strategy.carId === snapshot.cars[0].carId);

    expect(playerOnePit).toMatchObject({ stopCount: 2, lastStopTimeSeconds: 2.5, bestStopTimeSeconds: 2.5, issueCount: 1 });
    expect(playerOnePit?.issues).toContain("WHEEL_GUN");
    expect(playerOneTyres?.compounds).toEqual(["MEDIUM", "HARD", "MEDIUM", "SOFT"]);
    expect(playerOneTyres?.strategyLabel).toBe("MEDIUM → HARD → MEDIUM → SOFT");
  });

  it("uses replay events for player strategy and thermal review", () => {
    const initial = createInitialSnapshot(205);
    const carId = PLAYER_CAR_IDS[0];
    const recorder = new RaceReplayRecorder({ watchedCarIds: [carId] });
    recorder.record(initial);
    recorder.record({
      ...initial,
      elapsedTime: 1,
      tick: 10,
      cars: initial.cars.map((car) => car.carId === carId ? { ...car, powerUnitTemperature: 126 } : car),
    }, [{ kind: "STRATEGY", carId, message: "BOX NOW for hard tyres", severity: "WARNING" }]);

    const report = buildRaceReport(completedSnapshot(), { recording: recorder.toRecording(), playerCarIds: [carId] });
    expect(report.playerReports).toHaveLength(1);
    expect(report.playerReports[0].strategyEvents[0].message).toContain("BOX NOW");
    expect(report.playerReports[0].criticalThermalWarningCount).toBe(1);
    expect(report.totals).toMatchObject({ strategyCalls: 1, thermalWarnings: 1 });
  });

  it("adds a final incident when no historical recorder is available", () => {
    const snapshot = completedSnapshot();
    const report = buildRaceReport({ ...snapshot, events: [], radioMessages: [] });
    const retiredCar = snapshot.cars[2];

    expect(report.incidents).toContainEqual(expect.objectContaining({
      carId: retiredCar.carId,
      message: "Power unit",
      finalStatus: "RETIRED",
    }));
    expect(report.totals.retirements).toBe(1);
  });

  it("does not declare a winner while classification is provisional", () => {
    const report = buildRaceReport(createInitialSnapshot(206));

    expect(report.completed).toBe(false);
    expect(report.winnerCarId).toBeNull();
  });
});
