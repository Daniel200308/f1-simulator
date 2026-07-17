import { describe, expect, it } from "vitest";

import type { InfringementType, PenaltyType, RacePenalty } from "@/domain/race";
import { createInitialSnapshot } from "@/simulation/engine";
import {
  canServeMandatoryPenalty,
  classificationConversionSeconds,
  decidePenalty,
  isMandatoryPitPenalty,
  isTimePenalty,
  penaltyCrossingsRemaining,
  penaltyHoldSeconds,
  resultPenaltySeconds,
} from "@/simulation/fia-2026-rules";
import { advancePenaltyLifecycle } from "@/simulation/stewarding";

function penalty(type: PenaltyType, infringement: InfringementType = "SC_VSC_DELTA"): RacePenalty {
  const snapshot = createInitialSnapshot(9001);
  const car = snapshot.cars[0];
  return {
    id: `penalty:${type}`,
    incidentId: "incident:test",
    carId: car.carId,
    teamId: car.teamId,
    driverId: car.driverId,
    infringement,
    type,
    status: "PENDING",
    seconds: penaltyHoldSeconds(type),
    classificationSeconds: classificationConversionSeconds(type),
    reason: "TEST OFFENCE",
    evidence: "Telemetry evidence",
    issuedAt: 20,
    lapNumber: 2,
    serviceDeadlineCrossings: isMandatoryPitPenalty(type) ? 2 : null,
    lineCrossingsAfterIssue: 0,
    servedAt: null,
    serviceStartedAt: null,
  };
}

describe("FIA 2026 penalty decisions", () => {
  it("holds a 5-second penalty for five seconds", () => expect(penaltyHoldSeconds("TIME_5")).toBe(5));
  it("holds a 10-second penalty for ten seconds", () => expect(penaltyHoldSeconds("TIME_10")).toBe(10));
  it("converts a drive-through to 20 result seconds", () => expect(classificationConversionSeconds("DRIVE_THROUGH")).toBe(20));
  it("converts a stop-and-go to 30 result seconds", () => expect(classificationConversionSeconds("STOP_GO_10")).toBe(30));
  it("returns NFA when responsibility is below the balanced threshold", () => expect(decidePenalty("CAUSING_COLLISION", 0.8, 0.42).penaltyType).toBeNull());
  it("lets strict stewarding sanction marginal responsibility", () => expect(decidePenalty("CAUSING_COLLISION", 0.8, 0.45, "STRICT").penaltyType).toBe("TIME_10"));
  it("lets lenient stewarding dismiss marginal responsibility", () => expect(decidePenalty("CAUSING_COLLISION", 0.8, 0.55, "LENIENT").penaltyType).toBeNull());
  it("gives a first VSC breach five seconds", () => expect(decidePenalty("SC_VSC_DELTA", 0.5, 1, "BALANCED", 1).penaltyType).toBe("TIME_5"));
  it("gives a second VSC breach ten seconds", () => expect(decidePenalty("SC_VSC_DELTA", 0.6, 1, "BALANCED", 2).penaltyType).toBe("TIME_10"));
  it("gives a third VSC breach a drive-through", () => expect(decidePenalty("SC_VSC_DELTA", 0.7, 1, "BALANCED", 3).penaltyType).toBe("DRIVE_THROUGH"));
  it("gives a fourth VSC breach a stop-and-go", () => expect(decidePenalty("SC_VSC_DELTA", 0.8, 1, "BALANCED", 4).penaltyType).toBe("STOP_GO_10"));
  it("sanctions the fourth track-limit offence with five seconds", () => expect(decidePenalty("TRACK_LIMITS", 0.45, 1, "BALANCED", 4).penaltyType).toBe("TIME_5"));
  it("issues another five seconds for a fifth track-limit offence", () => expect(decidePenalty("TRACK_LIMITS", 0.6, 1, "BALANCED", 5).penaltyType).toBe("TIME_5"));
  it("escalates a sixth track-limit offence to ten seconds", () => expect(decidePenalty("TRACK_LIMITS", 0.7, 1, "BALANCED", 6).penaltyType).toBe("TIME_10"));
  it("uses ten seconds as the causing-a-collision baseline", () => expect(decidePenalty("CAUSING_COLLISION", 0.58, 0.78).penaltyType).toBe("TIME_10"));
  it("uses stop-and-go for a severe collision", () => expect(decidePenalty("CAUSING_COLLISION", 0.94, 0.95).penaltyType).toBe("STOP_GO_10"));
  it("uses ten seconds for a lasting sporting advantage", () => expect(decidePenalty("GAINING_LASTING_ADVANTAGE", 0.58, 0.96).penaltyType).toBe("TIME_10"));
  it("uses stop-and-go for a severe false start", () => expect(decidePenalty("JUMP_START", 0.95, 1).penaltyType).toBe("STOP_GO_10"));
  it("disqualifies a dry-race tyre-rule breach", () => expect(decidePenalty("TYRE_RULE", 1, 1).penaltyType).toBe("DISQUALIFICATION"));
});

describe("FIA 2026 service lifecycle", () => {
  it("starts mandatory penalties with two line crossings remaining", () => expect(penaltyCrossingsRemaining(penalty("DRIVE_THROUGH"))).toBe(2));

  it("counts a green-flag line crossing", () => {
    const snapshot = createInitialSnapshot(9002);
    const subject = penalty("DRIVE_THROUGH");
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars: snapshot.cars, crossedLineCarIds: new Set([subject.carId]), raceControl: "GREEN", elapsedTime: 30 });
    expect(updated[0].lineCrossingsAfterIssue).toBe(1);
  });

  it("pauses the line-crossing deadline under VSC", () => {
    const snapshot = createInitialSnapshot(9003);
    const subject = penalty("DRIVE_THROUGH");
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars: snapshot.cars, crossedLineCarIds: new Set([subject.carId]), raceControl: "VSC", elapsedTime: 30 });
    expect(updated[0].lineCrossingsAfterIssue).toBe(0);
  });

  it("pauses the line-crossing deadline under Safety Car for a car on track", () => {
    const snapshot = createInitialSnapshot(9004);
    const subject = penalty("STOP_GO_10");
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars: snapshot.cars, crossedLineCarIds: new Set([subject.carId]), raceControl: "SAFETY_CAR", elapsedTime: 30 });
    expect(updated[0].lineCrossingsAfterIssue).toBe(0);
  });

  it("allows an already-entered car to serve under Safety Car", () => {
    expect(canServeMandatoryPenalty("SAFETY_CAR", true)).toBe(true);
    expect(canServeMandatoryPenalty("SAFETY_CAR", false)).toBe(false);
  });

  it("marks a penalty as serving at pit entry", () => {
    const snapshot = createInitialSnapshot(9005);
    const subject = penalty("TIME_5");
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars: snapshot.cars, crossedLineCarIds: new Set(), raceControl: "GREEN", elapsedTime: 31, servingPenaltyIds: new Set([subject.id]) });
    expect(updated[0]).toMatchObject({ status: "SERVING", serviceStartedAt: 31 });
  });

  it("clears service by marking the penalty served", () => {
    const snapshot = createInitialSnapshot(9006);
    const subject = penalty("TIME_10");
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars: snapshot.cars, crossedLineCarIds: new Set(), raceControl: "GREEN", elapsedTime: 41, servedPenaltyIds: new Set([subject.id]) });
    expect(updated[0]).toMatchObject({ status: "SERVED", servedAt: 41 });
  });

  it("converts an unserved time penalty when the car finishes", () => {
    const snapshot = createInitialSnapshot(9007);
    const subject = penalty("TIME_5");
    const cars = snapshot.cars.map((car) => car.carId === subject.carId ? { ...car, finished: true } : car);
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars, crossedLineCarIds: new Set(), raceControl: "GREEN", elapsedTime: 5_500 });
    expect(updated[0]).toMatchObject({ status: "CONVERTED_TO_RACE_TIME", classificationSeconds: 5 });
  });

  it("converts an unserved drive-through when the car finishes", () => {
    const snapshot = createInitialSnapshot(9008);
    const subject = penalty("DRIVE_THROUGH");
    const cars = snapshot.cars.map((car) => car.carId === subject.carId ? { ...car, finished: true } : car);
    const updated = advancePenaltyLifecycle({ penalties: [subject], cars, crossedLineCarIds: new Set(), raceControl: "GREEN", elapsedTime: 5_500 });
    expect(updated[0]).toMatchObject({ status: "CONVERTED_TO_RACE_TIME", classificationSeconds: 20 });
  });

  it("does not add a served penalty to the classification", () => expect(resultPenaltySeconds({ ...penalty("TIME_10"), status: "SERVED" })).toBe(0));
  it("adds a pending penalty to the classification", () => expect(resultPenaltySeconds(penalty("TIME_10"))).toBe(10));
  it("identifies only five and ten-second penalties as time penalties", () => {
    expect(isTimePenalty("TIME_5")).toBe(true);
    expect(isTimePenalty("TIME_10")).toBe(true);
    expect(isTimePenalty("DRIVE_THROUGH")).toBe(false);
  });
  it("identifies drive-through and stop-and-go as mandatory pit penalties", () => {
    expect(isMandatoryPitPenalty("DRIVE_THROUGH")).toBe(true);
    expect(isMandatoryPitPenalty("STOP_GO_10")).toBe(true);
    expect(isMandatoryPitPenalty("TIME_5")).toBe(false);
  });
});
