import { describe, expect, it } from "vitest";

import type { RacePenalty, RaceSnapshot } from "@/domain/race";
import { createInitialSnapshot, PIT_BOX_DISTANCE, setCarPit, stepSnapshot } from "@/simulation/engine";

function timePenalty(snapshot: RaceSnapshot, carId: string, seconds: 5 | 10 = 5): RacePenalty {
  const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
  return {
    id: `${carId}:test-time-${seconds}`,
    incidentId: `${carId}:test-incident`,
    carId,
    teamId: car.teamId,
    driverId: car.driverId,
    infringement: "TRACK_LIMITS",
    type: seconds === 5 ? "TIME_5" : "TIME_10",
    status: "PENDING",
    seconds,
    classificationSeconds: seconds,
    reason: "TRACK LIMITS",
    evidence: "Test evidence",
    issuedAt: 10,
    lapNumber: 2,
    serviceDeadlineCrossings: null,
    lineCrossingsAfterIssue: 0,
    servedAt: null,
    serviceStartedAt: null,
  };
}

function stopGoPenalty(snapshot: RaceSnapshot, carId: string): RacePenalty {
  const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
  return {
    id: `${carId}:test-stop-go`,
    incidentId: `${carId}:test-stop-go-incident`,
    carId,
    teamId: car.teamId,
    driverId: car.driverId,
    infringement: "PIT_SPEEDING",
    type: "STOP_GO_10",
    status: "PENDING",
    seconds: 10,
    classificationSeconds: 30,
    reason: "PIT LANE SPEEDING",
    evidence: "Test evidence",
    issuedAt: 10,
    lapNumber: 2,
    serviceDeadlineCrossings: 2,
    lineCrossingsAfterIssue: 1,
    servedAt: null,
    serviceStartedAt: null,
  };
}

function atPitBox(snapshot: RaceSnapshot, carId: string): RaceSnapshot {
  return {
    ...snapshot,
    status: "RUNNING",
    elapsedTime: 20,
    cars: snapshot.cars.map((car) => car.carId === carId ? {
      ...car,
      currentLap: 2,
      totalDistance: PIT_BOX_DISTANCE + 1,
      lapDistance: PIT_BOX_DISTANCE + 1,
      currentSpeed: 120,
      reactionTime: 0,
    } : car),
  };
}

function scheduleAnyCar(snapshot: RaceSnapshot, carId: string, compound: "SOFT" | "MEDIUM" | "HARD"): RaceSnapshot {
  const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
  const replacement = car.tyreSets.find((set) => set.compound === compound && set.status === "AVAILABLE");
  if (!replacement) throw new Error(`No ${compound} set available for ${carId}`);
  return {
    ...snapshot,
    cars: snapshot.cars.map((candidate) => candidate.carId === carId ? {
      ...candidate,
      scheduledPitCompound: compound,
      scheduledPitTyreSetId: replacement.id,
      tyreSets: candidate.tyreSets.map((set) => set.id === replacement.id ? { ...set, status: "RESERVED" as const } : set),
    } : candidate),
  };
}

describe("penalty pit-service integration", () => {
  it("does not force a 5-second penalty car to pit immediately", () => {
    let snapshot = createInitialSnapshot(9601, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId === snapshot.playerTeamId)!.carId;
    snapshot = atPitBox(snapshot, carId);
    snapshot = { ...snapshot, penalties: [timePenalty(snapshot, carId)] };
    const next = stepSnapshot(snapshot);
    expect(next.cars.find((car) => car.carId === carId)?.pitStatus).toBe("TRACK");
  });

  it("holds the car untouched before tyre work begins", () => {
    let snapshot = createInitialSnapshot(9602, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId === snapshot.playerTeamId)!.carId;
    snapshot = atPitBox(snapshot, carId);
    snapshot = { ...snapshot, penalties: [timePenalty(snapshot, carId)] };
    snapshot = setCarPit(snapshot, carId, "SOFT");
    snapshot = stepSnapshot(snapshot);
    for (let index = 0; index < 25; index += 1) snapshot = stepSnapshot(snapshot);
    const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.pitServicePhase).toBe("PENALTY_HOLD");
    expect(car.penaltyHoldElapsedSeconds).toBeGreaterThan(2);
    expect(car.pitTyreServiceElapsedSeconds).toBe(0);
    expect(snapshot.penalties[0].status).toBe("SERVING");
  });

  it("serves the penalty, changes tyres and removes the active sanction", () => {
    let snapshot = createInitialSnapshot(9603, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId === snapshot.playerTeamId)!.carId;
    snapshot = atPitBox(snapshot, carId);
    snapshot = { ...snapshot, penalties: [timePenalty(snapshot, carId)] };
    snapshot = setCarPit(snapshot, carId, "SOFT");
    snapshot = stepSnapshot(snapshot);
    for (let index = 0; index < 90; index += 1) snapshot = stepSnapshot(snapshot);
    const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(snapshot.penalties[0].status).toBe("SERVED");
    expect(car.tyreCompound).toBe("SOFT");
    expect(car.lastPenaltyHoldSeconds).toBe(5);
    expect(car.lastPitStopTime).toBeGreaterThan(1.8);
    expect(car.lastPitStopTime).toBeLessThan(5);
  });

  it("serves the complete ten-second hold before touching the tyres", () => {
    let snapshot = createInitialSnapshot(9604, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId === snapshot.playerTeamId)!.carId;
    snapshot = atPitBox(snapshot, carId);
    snapshot = { ...snapshot, penalties: [timePenalty(snapshot, carId, 10)] };
    snapshot = setCarPit(snapshot, carId, "SOFT");
    snapshot = stepSnapshot(snapshot);
    for (let index = 0; index < 80; index += 1) snapshot = stepSnapshot(snapshot);

    let car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.pitServicePhase).toBe("PENALTY_HOLD");
    expect(car.penaltyHoldSeconds).toBe(10);
    expect(car.penaltyHoldElapsedSeconds).toBeGreaterThan(8);
    expect(car.penaltyHoldElapsedSeconds).toBeLessThan(10);
    expect(car.pitTyreServiceElapsedSeconds).toBe(0);
    expect(snapshot.penalties[0].status).toBe("SERVING");

    for (let index = 0; index < 60; index += 1) snapshot = stepSnapshot(snapshot);
    car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(snapshot.penalties[0].status).toBe("SERVED");
    expect(car.lastPenaltyHoldSeconds).toBe(10);
  });

  it("combines every pending time penalty into one uninterrupted pit hold", () => {
    let snapshot = createInitialSnapshot(9605, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId === snapshot.playerTeamId)!.carId;
    snapshot = atPitBox(snapshot, carId);
    snapshot = {
      ...snapshot,
      penalties: [timePenalty(snapshot, carId, 5), timePenalty(snapshot, carId, 10)],
    };
    snapshot = setCarPit(snapshot, carId, "MEDIUM");
    snapshot = stepSnapshot(snapshot);
    for (let index = 0; index < 120; index += 1) snapshot = stepSnapshot(snapshot);

    let car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.pitServicePhase).toBe("PENALTY_HOLD");
    expect(car.penaltyHoldSeconds).toBe(15);
    expect(car.penaltyServiceIds).toHaveLength(2);
    expect(car.pitTyreServiceElapsedSeconds).toBe(0);
    expect(snapshot.penalties.every((penalty) => penalty.status === "SERVING")).toBe(true);

    for (let index = 0; index < 80; index += 1) snapshot = stepSnapshot(snapshot);
    car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(snapshot.penalties.every((penalty) => penalty.status === "SERVED")).toBe(true);
    expect(car.lastPenaltyHoldSeconds).toBe(15);
    expect(car.tyreCompound).toBe("MEDIUM");
  });

  it("holds and serves a rival AI car's complete penalty before its tyre change", () => {
    let snapshot = createInitialSnapshot(9_606, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId !== snapshot.playerTeamId)!.carId;
    snapshot = atPitBox(snapshot, carId);
    snapshot = { ...snapshot, penalties: [timePenalty(snapshot, carId, 10)] };
    snapshot = scheduleAnyCar(snapshot, carId, "HARD");

    let observedPenaltyHold = false;
    let observedTyreService = false;
    for (let index = 0; index < 180; index += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      observedPenaltyHold ||= car.pitServicePhase === "PENALTY_HOLD" && car.currentSpeed === 0;
      observedTyreService ||= car.pitServicePhase === "TYRE_SERVICE" && car.currentSpeed === 0;
      if (snapshot.penalties[0].status === "SERVED" && car.pitStatus === "PIT_EXIT") break;
    }

    const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(observedPenaltyHold).toBe(true);
    expect(observedTyreService).toBe(true);
    expect(snapshot.penalties[0].status).toBe("SERVED");
    expect(car.tyreCompound).toBe("HARD");
    expect(car.lastPenaltyHoldSeconds).toBe(10);
    expect(car.lastPitStopTime).toBeGreaterThan(1.9);
  });

  it("serves an AI stop-go without discarding its separately scheduled tyre stop", () => {
    let snapshot = createInitialSnapshot(9_607, "RUNNING");
    const carId = snapshot.cars.find((car) => car.teamId !== snapshot.playerTeamId)!.carId;
    const originalCompound = snapshot.cars.find((car) => car.carId === carId)!.tyreCompound;
    snapshot = atPitBox(snapshot, carId);
    snapshot = { ...snapshot, penalties: [stopGoPenalty(snapshot, carId)] };
    snapshot = scheduleAnyCar(snapshot, carId, "HARD");

    for (let index = 0; index < 150; index += 1) {
      snapshot = stepSnapshot(snapshot);
      const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
      if (snapshot.penalties[0].status === "SERVED" && car.pitStatus === "PIT_EXIT") break;
    }

    const car = snapshot.cars.find((candidate) => candidate.carId === carId)!;
    expect(snapshot.penalties[0].status).toBe("SERVED");
    expect(car.lastPenaltyHoldSeconds).toBe(10);
    expect(car.tyreCompound).toBe(originalCompound);
    expect(car.scheduledPitCompound).toBe("HARD");
    expect(car.scheduledPitTyreSetId).not.toBeNull();
  });
});
