import { describe, expect, it } from "vitest";

import type { RaceEvent } from "@/domain/race";
import { createInitialSnapshot, stepSnapshot } from "@/simulation/engine";
import { pitSpeedingIncidentQuota } from "@/simulation/fia-2026-rules";
import { reviewStewarding } from "@/simulation/stewarding";

function adjudicate(snapshot: ReturnType<typeof createInitialSnapshot>, cars: typeof snapshot.cars, incidentEvents: readonly RaceEvent[], start = 1) {
  let state = snapshot;
  let result = reviewStewarding({ snapshot: state, cars, incidentEvents, tick: 10, elapsedTime: start });
  state = { ...state, cars, investigations: result.investigations, penalties: result.penalties };
  result = reviewStewarding({ snapshot: state, cars, incidentEvents: [], tick: 40, elapsedTime: start + 4 });
  state = { ...state, investigations: result.investigations, penalties: result.penalties };
  result = reviewStewarding({ snapshot: state, cars, incidentEvents: [], tick: 800, elapsedTime: start + 80 });
  state = { ...state, investigations: result.investigations, penalties: result.penalties };
  return reviewStewarding({ snapshot: state, cars, incidentEvents: [], tick: 820, elapsedTime: start + 82 });
}

describe("reviewStewarding", () => {
  it("starts a normal grid with no false-start investigations or penalties", () => {
    let snapshot = createInitialSnapshot(309, "RUNNING");
    for (let index = 0; index < 20; index += 1) snapshot = stepSnapshot(snapshot);
    expect(snapshot.investigations).toHaveLength(0);
    expect(snapshot.penalties).toHaveLength(0);
  });

  it("keeps the driver under yellow investigation for at least one minute before a verdict", () => {
    const initial = createInitialSnapshot(310);
    const car = initial.cars[0];
    const cars = initial.cars.map((candidate) => candidate.carId === car.carId ? { ...candidate, vscViolationCount: 1, vscDeltaSeconds: -0.42 } : candidate);
    const noted = reviewStewarding({ snapshot: initial, cars, incidentEvents: [], tick: 100, elapsedTime: 10 });
    const underSnapshot = { ...initial, cars, investigations: noted.investigations, penalties: noted.penalties };
    const under = reviewStewarding({ snapshot: underSnapshot, cars, incidentEvents: [], tick: 140, elapsedTime: 14 });
    const beforeDecisionSnapshot = { ...underSnapshot, investigations: under.investigations, penalties: under.penalties };
    const beforeDecision = reviewStewarding({ snapshot: beforeDecisionSnapshot, cars, incidentEvents: [], tick: 690, elapsedTime: 69 });

    expect(beforeDecision.penalties).toHaveLength(0);
    expect(beforeDecision.investigations[0].status).toBe("UNDER_INVESTIGATION");
    expect(beforeDecision.investigations[0].decisionDueAt - beforeDecision.investigations[0].notedAt).toBeGreaterThanOrEqual(65);
  });

  it("does not treat high speed on the entry road before the limiter line as pit speeding", () => {
    const initial = createInitialSnapshot(314);
    const entryCar = { ...initial.cars[0], pitStatus: "PIT_ENTRY" as const, currentSpeed: 246 };
    const cars = initial.cars.map((car) => car.carId === entryCar.carId ? entryCar : car);
    const result = reviewStewarding({ snapshot: initial, cars, incidentEvents: [], tick: 10, elapsedTime: 1 });

    expect(result.investigations.filter((investigation) => investigation.infringement === "PIT_SPEEDING")).toHaveLength(0);
  });

  it.each([314, 315])("caps pit-lane speeding at the seeded two-or-three incident quota (%i)", (seed) => {
    const initial = createInitialSnapshot(seed);
    const cars = initial.cars.map((car) => ({
      ...car,
      pitStatus: "PIT_LANE" as const,
      currentSpeed: 120,
      pitSpeedingEvidence: {
        active: true,
        confirmed: true,
        startedAt: 0.7,
        entrySpeedKph: 120,
        maximumSpeedKph: 120,
        excessSpeedSumKph: 120,
        sampleCount: 3,
        durationSeconds: 0.3,
        distanceMetres: 10,
        limiterActive: false,
      },
    }));
    const result = reviewStewarding({ snapshot: initial, cars, incidentEvents: [], tick: 10, elapsedTime: 1 });
    const pitSpeeding = result.investigations.filter((investigation) => investigation.infringement === "PIT_SPEEDING");

    expect(pitSpeeding).toHaveLength(pitSpeedingIncidentQuota(seed));
    expect(pitSpeeding.length).toBeGreaterThanOrEqual(2);
    expect(pitSpeeding.length).toBeLessThanOrEqual(3);
  });

  it("does not turn a bunched pit train into mass unsafe-release investigations", () => {
    const initial = createInitialSnapshot(3_160);
    const previous = {
      ...initial,
      cars: initial.cars.map((car) => ({ ...car, pitStatus: "PIT_STOP" as const, totalDistance: 5_700, currentSpeed: 0 })),
    };
    const releasedCars = previous.cars.map((car) => ({ ...car, pitStatus: "PIT_EXIT" as const, currentSpeed: 80 }));
    const result = reviewStewarding({ snapshot: previous, cars: releasedCars, incidentEvents: [], tick: 10, elapsedTime: 1 });

    expect(result.investigations.filter((investigation) => investigation.infringement === "UNSAFE_RELEASE")).toHaveLength(1);
  });

  it("does not classify a car already ahead in the pit lane as approaching release traffic", () => {
    const initial = createInitialSnapshot(3_161);
    const target = initial.cars[0];
    const ahead = initial.cars[1];
    const previous = {
      ...initial,
      cars: initial.cars.map((car) => car.carId === target.carId
        ? { ...car, pitStatus: "PIT_STOP" as const, totalDistance: 5_700, currentSpeed: 0 }
        : car.carId === ahead.carId
          ? { ...car, pitStatus: "PIT_EXIT" as const, totalDistance: 5_708, currentSpeed: 80 }
          : car),
    };
    const cars = previous.cars.map((car) => car.carId === target.carId ? { ...car, pitStatus: "PIT_EXIT" as const, currentSpeed: 40 } : car);
    const result = reviewStewarding({ snapshot: previous, cars, incidentEvents: [], tick: 10, elapsedTime: 1 });

    expect(result.investigations.filter((investigation) => investigation.infringement === "UNSAFE_RELEASE")).toHaveLength(0);
  });

  it("escalates repeat VSC minimum-time breaches and never duplicates a decision", () => {
    const initial = createInitialSnapshot(310);
    const car = initial.cars[0];
    const firstCars = initial.cars.map((candidate) => candidate.carId === car.carId ? {
      ...candidate,
      vscViolationCount: 1,
      vscDeltaSeconds: -0.42,
    } : candidate);
    const first = adjudicate(initial, firstCars, [], 1);

    expect(first.penalties[0]).toMatchObject({ carId: car.carId, type: "TIME_5", seconds: 5, status: "PENDING" });
    expect(first.investigations[0]).toMatchObject({ status: "DECIDED", infringement: "SC_VSC_DELTA" });

    const afterFirst = { ...initial, cars: firstCars, investigations: first.investigations, penalties: first.penalties };
    const repeated = reviewStewarding({ snapshot: afterFirst, cars: firstCars, incidentEvents: [], tick: 11, elapsedTime: 1.1 });
    expect(repeated.penalties).toHaveLength(1);

    const secondCars = firstCars.map((candidate) => candidate.carId === car.carId ? { ...candidate, vscViolationCount: 2 } : candidate);
    const second = adjudicate(afterFirst, secondCars, [], 20);
    expect(second.penalties.at(-1)).toMatchObject({ type: "TIME_10", seconds: 10 });
  });

  it("penalises attributed attacking contact but not a passive car", () => {
    const initial = createInitialSnapshot(311);
    const car = initial.cars[0];
    const event: RaceEvent = {
      id: "contact-1",
      elapsedTime: 20,
      type: "INCIDENT",
      carId: car.carId,
      message: "CONTACT AND DEBRIS at T6",
    };
    const attacking = {
      ...initial,
      cars: initial.cars.map((candidate) => candidate.carId === car.carId ? { ...candidate, battleStatus: "ATTACKING" as const } : candidate),
    };

    const decision = adjudicate(attacking, attacking.cars, [event], 20);
    expect(decision.penalties[0]).toMatchObject({ type: "TIME_10", reason: "CAUSING A COLLISION" });

    const passive = adjudicate(initial, initial.cars, [event], 20);
    expect(passive.penalties).toHaveLength(0);
  });

  it("sanctions a fourth track-limit offence and repeated ignored blue flags", () => {
    const initial = createInitialSnapshot(312);
    const limitsCar = { ...initial.cars[0], trackLimitsWarnings: 4 };
    const blueCar = { ...initial.cars[1], blueFlagWarnings: 3 };
    const cars = initial.cars.map((car) => car.carId === limitsCar.carId ? limitsCar : car.carId === blueCar.carId ? blueCar : car);
    const decision = adjudicate(initial, cars, [], 4);

    expect(decision.penalties).toEqual(expect.arrayContaining([
      expect.objectContaining({ carId: limitsCar.carId, type: "BLACK_AND_WHITE_FLAG", status: "SERVED" }),
      expect.objectContaining({ carId: limitsCar.carId, type: "TIME_5", reason: "TRACK LIMITS" }),
      expect.objectContaining({ carId: blueCar.carId, type: "TIME_5", reason: "IGNORING BLUE FLAGS" }),
    ]));
  });
});
