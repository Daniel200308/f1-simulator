import { describe, expect, it } from "vitest";

import type { SafetyCarCandidate } from "@/simulation/race-control";
import {
  SAFETY_CAR_DEPLOYMENT_SECONDS,
  advanceSafetyCarPosition,
  advanceSafetyCarProcedure,
  buildSafetyCarSchedule,
  buildSafetyCarFormation,
  createSafetyCarProcedureState,
  isOvertakePermitted,
  localYellowInstructionFor,
  pitLaneProcedureFor,
  raceControlPhaseMessage,
  selectHigherPriorityRaceControl,
  updateVscCompliance,
  vscTargetElapsedSeconds,
} from "@/simulation/race-control";

function candidate(
  carId: string,
  racePosition: number,
  totalDistance: number,
  overrides: Partial<SafetyCarCandidate> = {},
): SafetyCarCandidate {
  return {
    carId,
    racePosition,
    totalDistance,
    finished: false,
    incidentStatus: "RUNNING",
    pitStatus: "TRACK",
    ...overrides,
  };
}

describe("local yellow procedures", () => {
  it("limits only the affected sector", () => {
    const affected = localYellowInstructionFor(2, "YELLOW", 2);
    const clear = localYellowInstructionFor(1, "YELLOW", 2);

    expect(affected).toMatchObject({ applies: true, noOvertaking: true, maximumSpeedKph: 160 });
    expect(affected.speedFactor).toBeLessThan(1);
    expect(clear).toMatchObject({ applies: false, noOvertaking: false, speedFactor: 1, maximumSpeedKph: null });
    expect(isOvertakePermitted({ raceControl: "YELLOW", currentSector: 2, yellowSector: 2 })).toBe(false);
    expect(isOvertakePermitted({ raceControl: "YELLOW", currentSector: 3, yellowSector: 2 })).toBe(true);
  });

  it("gives a red flag highest priority and closes the pit exit", () => {
    expect(selectHigherPriorityRaceControl("SAFETY_CAR", "RED_FLAG")).toBe("RED_FLAG");
    expect(isOvertakePermitted({ raceControl: "RED_FLAG", currentSector: 1, yellowSector: null })).toBe(false);
    expect(pitLaneProcedureFor("RED_FLAG", "NONE", 0)).toMatchObject({ open: false, status: "CLOSED", reason: "RED_FLAG_SUSPENSION" });
    expect(raceControlPhaseMessage({ raceControl: "RED_FLAG" }).headline).toBe("RED FLAG");
  });
});

describe("VSC target and compliance", () => {
  it("builds a slower target and accepts a positive delta", () => {
    const target = vscTargetElapsedSeconds(10);
    const result = updateVscCompliance({
      actualElapsedSeconds: target + 0.12,
      targetElapsedSeconds: target,
      previousViolationSeconds: 0.7,
      stepSeconds: 0.1,
    });

    expect(target).toBeCloseTo(16.129, 3);
    expect(result.status).toBe("COMPLIANT");
    expect(result.deltaSeconds).toBeCloseTo(0.12, 5);
    expect(result.violationSeconds).toBe(0);
  });

  it("warns first and classifies only a sustained negative delta as a violation", () => {
    const warning = updateVscCompliance({
      actualElapsedSeconds: 9.7,
      targetElapsedSeconds: 10,
      previousViolationSeconds: 0.4,
      stepSeconds: 0.4,
    });
    const violation = updateVscCompliance({
      actualElapsedSeconds: 9.7,
      targetElapsedSeconds: 10,
      previousViolationSeconds: warning.violationSeconds,
      stepSeconds: 0.2,
    });

    expect(warning).toMatchObject({ status: "WARNING", violationSeconds: 0.8 });
    expect(violation.status).toBe("VIOLATION");
    expect(violation.violationSeconds).toBeCloseTo(1, 5);
    expect(violation.speedCorrectionFactor).toBeLessThan(warning.speedCorrectionFactor);
  });
});

describe("safety car procedure", () => {
  it("transitions deterministically through deployment, bunching, restart, and green", () => {
    const deployed = createSafetyCarProcedureState();
    const stillDeployed = advanceSafetyCarProcedure({
      state: deployed,
      stepSeconds: SAFETY_CAR_DEPLOYMENT_SECONDS - 0.01,
    });
    expect(stillDeployed.phase).toBe("DEPLOYED");

    const bunching = advanceSafetyCarProcedure({ state: stillDeployed, stepSeconds: 0.01 });
    expect(bunching).toMatchObject({ phase: "BUNCHING", phaseElapsedSeconds: 0, changed: true });
    expect(bunching.message?.headline).toBe("FIELD BUNCHING");

    const waitingForEndingSector = advanceSafetyCarProcedure({
      state: { phase: "BUNCHING", phaseElapsedSeconds: 120 },
      stepSeconds: 4,
      fieldBunched: false,
    });
    expect(waitingForEndingSector.phase).toBe("BUNCHING");

    const restart = advanceSafetyCarProcedure({
      state: waitingForEndingSector,
      stepSeconds: 0,
      fieldBunched: false,
      endingSectorReached: true,
    });
    expect(restart).toMatchObject({ phase: "RESTART", phaseElapsedSeconds: 0, changed: true });

    const heldAtLine = advanceSafetyCarProcedure({
      state: { phase: "RESTART", phaseElapsedSeconds: 0 },
      stepSeconds: 1,
      fieldBunched: true,
      safetyCarInPitLane: true,
      leaderReachedRestartLine: false,
    });
    expect(heldAtLine.phase).toBe("RESTART");

    const green = advanceSafetyCarProcedure({
      state: heldAtLine,
      stepSeconds: 0,
      fieldBunched: true,
      safetyCarInPitLane: true,
      leaderReachedRestartLine: true,
    });
    expect(green).toMatchObject({ phase: "NONE", phaseElapsedSeconds: 0, changed: true, restartEligible: true });
    expect(green.message?.headline).toBe("GREEN FLAG");
  });

  it("keeps overtaking prohibited until the restart line", () => {
    expect(isOvertakePermitted({ raceControl: "VSC", currentSector: 1, yellowSector: null })).toBe(false);
    expect(isOvertakePermitted({ raceControl: "SAFETY_CAR", currentSector: 1, yellowSector: null, safetyCarPhase: "RESTART", crossedRestartLine: false })).toBe(false);
    expect(isOvertakePermitted({ raceControl: "SAFETY_CAR", currentSector: 3, yellowSector: null, safetyCarPhase: "BUNCHING", lappedCarMayOvertakeSafetyCar: true })).toBe(true);
    expect(isOvertakePermitted({ raceControl: "SAFETY_CAR", currentSector: 1, yellowSector: null, safetyCarPhase: "RESTART", crossedRestartLine: true })).toBe(true);
  });
});

describe("safety car position and queue", () => {
  it("schedules a late-sector-three withdrawal on the first or second tour only", () => {
    const oneLap = buildSafetyCarSchedule({
      deploymentDistance: 1_500,
      targetLaps: 1,
      circuitLengthMeters: 5_891,
      sectorThreeStartDistance: 3_900,
      pitEntryLapDistance: 5_706,
    });
    const twoLaps = buildSafetyCarSchedule({
      deploymentDistance: 1_500,
      targetLaps: 2,
      circuitLengthMeters: 5_891,
      sectorThreeStartDistance: 3_900,
      pitEntryLapDistance: 5_706,
    });

    expect(oneLap.endingStartDistance).toBeGreaterThanOrEqual(1_500 + 5_891);
    expect(oneLap.endingStartDistance).toBeLessThan(1_500 + 5_891 * 2);
    expect(oneLap.endingStartDistance % 5_891).toBe(3_900);
    expect(oneLap.pitEntryDistance - oneLap.endingStartDistance).toBe(1_806);
    expect(oneLap.restartLineDistance).toBe(oneLap.pitEntryDistance + 185);
    expect(twoLaps.endingStartDistance).toBeGreaterThanOrEqual(1_500 + 5_891 * 2);
    expect(twoLaps.endingStartDistance).toBeLessThan(1_500 + 5_891 * 3);
    expect(twoLaps.endingStartDistance).toBe(oneLap.endingStartDistance + 5_891);
    expect(twoLaps.unlappingStartDistance).toBe(oneLap.endingStartDistance);
    expect(twoLaps.pitEntryDistance).toBe(oneLap.pitEntryDistance + 5_891);
  });

  it("holds the physical safety car at pit exit before joining the circuit", () => {
    const initial = advanceSafetyCarPosition({
      previousTotalDistance: null,
      leaderTotalDistance: 5_880,
      circuitLengthMeters: 5_891,
      phase: "DEPLOYED",
      stepSeconds: 0.1,
      phaseElapsedSeconds: 0.1,
      pitExitDistance: 155,
      firstCarDistance: 5_880,
    });
    const held = advanceSafetyCarPosition({
      previousTotalDistance: initial.totalDistance,
      leaderTotalDistance: 5_885,
      circuitLengthMeters: 5_891,
      phase: "DEPLOYED",
      stepSeconds: 1,
      phaseElapsedSeconds: 1.5,
      pitExitDistance: 155,
      firstCarDistance: 5_885,
    });
    const joined = advanceSafetyCarPosition({
      previousTotalDistance: held.totalDistance,
      leaderTotalDistance: 6_030,
      circuitLengthMeters: 5_891,
      phase: "DEPLOYED",
      stepSeconds: 1,
      phaseElapsedSeconds: 3.2,
      pitExitDistance: 155,
      firstCarDistance: 6_030,
    });

    expect(initial.totalDistance).toBe(6_046);
    expect(initial.lapDistance).toBe(155);
    expect(initial.speedKph).toBeLessThan(100);
    expect(held.totalDistance).toBe(initial.totalDistance);
    expect(joined.totalDistance).toBeGreaterThan(held.totalDistance);
    expect(joined.speedKph).toBe(155);
  });

  it("creates unique compressed targets in frozen race order", () => {
    const safetyCar = { totalDistance: 1_000, lapDistance: 1_000, speedKph: 125 };
    const cars = [
      candidate("p3", 3, 944),
      candidate("p1", 1, 972),
      candidate("pit", 4, 940, { pitStatus: "PIT_LANE" }),
      candidate("p2", 2, 958),
      candidate("out", 5, 930, { incidentStatus: "RETIRED", finished: true }),
    ];
    const formation = buildSafetyCarFormation(cars, safetyCar, "BUNCHING");

    expect(formation.queue.map((entry) => entry.carId)).toEqual(["p1", "p2", "p3"]);
    expect(formation.queue.map((entry) => entry.queuePosition)).toEqual([1, 2, 3]);
    expect(new Set(formation.queue.map((entry) => entry.targetTotalDistance)).size).toBe(3);
    expect(formation.queue.map((entry) => entry.targetTotalDistance)).toEqual([972, 958, 944]);
    expect(formation.fieldBunched).toBe(true);

    const spreadOut = buildSafetyCarFormation(
      [candidate("p1", 1, 950), candidate("p2", 2, 800)],
      safetyCar,
      "BUNCHING",
    );
    expect(spreadOut.fieldBunched).toBe(false);
    expect(spreadOut.maximumActualGapMeters).toBe(150);
  });
});

describe("pit-lane and phase messaging", () => {
  it("keeps the pit lane closed while deployed, then reopens it for bunching", () => {
    const closed = pitLaneProcedureFor("SAFETY_CAR", "DEPLOYED", 0);
    const stillClosed = pitLaneProcedureFor("SAFETY_CAR", "DEPLOYED", 120);
    const open = pitLaneProcedureFor("SAFETY_CAR", "BUNCHING", 0);
    const green = pitLaneProcedureFor("GREEN", "NONE", 0);

    expect(closed).toMatchObject({ status: "CLOSED", open: false, reason: "INITIAL_SAFETY_CAR_DEPLOYMENT" });
    expect(stillClosed.open).toBe(false);
    expect(open).toMatchObject({ status: "OPEN", open: true });
    expect(green.open).toBe(true);
  });

  it("allows escalation but prevents a lower-priority incident from downgrading control", () => {
    expect(selectHigherPriorityRaceControl("YELLOW", "VSC")).toBe("VSC");
    expect(selectHigherPriorityRaceControl("SAFETY_CAR", "VSC")).toBe("SAFETY_CAR");
    expect(selectHigherPriorityRaceControl("VSC", "YELLOW")).toBe("VSC");
  });

  it("provides direct operational messages for each phase", () => {
    expect(raceControlPhaseMessage({ raceControl: "YELLOW", yellowSector: 2 }).headline).toContain("SECTOR 2");
    expect(raceControlPhaseMessage({ raceControl: "VSC" }).detail).toContain("positive delta");
    expect(raceControlPhaseMessage({ raceControl: "SAFETY_CAR", safetyCarPhase: "RESTART" }).headline).toBe("SC ENDING");
    expect(raceControlPhaseMessage({ raceControl: "SAFETY_CAR", safetyCarPhase: "BUNCHING", lappedCarsMayOvertake: true, waveByCarCount: 2 }).headline).toContain("MAY NOW OVERTAKE");
  });
});
