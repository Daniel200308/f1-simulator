import { describe, expect, it } from "vitest";

import type { RaceSnapshot } from "@/domain/race";
import { cancelCarPit, checksumFor, createInitialSnapshot, estimatePitOutPosition, PIT_BOX_DISTANCE, PIT_ENTRY_START, setCarEnergyMode, setCarPace, setCarPit, setCarStartingTyre, setCarTyreMode, stepSnapshot } from "@/simulation/engine";
import { SILVERSTONE_REFERENCE_LAP_SECONDS, telemetryReferenceLapTime, telemetrySpeedAtDistance } from "@/simulation/silverstone-telemetry";
import { strategyRecommendation } from "@/simulation/strategy";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

function runTicks(seed: number, ticks: number) {
  let state: RaceSnapshot = { ...createInitialSnapshot(seed), status: "RUNNING" };
  for (let index = 0; index < ticks; index += 1) state = stepSnapshot(state);
  return state;
}

describe("race simulation", () => {
  it("starts the field on a staggered grid behind the timing line", () => {
    const state = createInitialSnapshot();
    expect(state.cars[0].totalDistance).toBe(0);
    expect(state.cars.every((car, index) => car.gridPosition === index + 1)).toBe(true);
    expect(state.cars.every((car, index) => index === 0 || car.totalDistance < state.cars[index - 1].totalDistance)).toBe(true);
    expect(state.cars.every((car) => car.trackLineOffset === 0 && car.currentSpeed === 0)).toBe(true);
    expect(state.raceControl).toBe("GREEN");
    expect(state.events).toEqual([]);
    expect(state.cars.every((car) => car.incidentStatus === "RUNNING" && car.damageLevel === 0)).toBe(true);
    expect(state.cars.every((car) => car.batteryPercent >= 70 && car.energyMode === "BALANCED" && car.battleStatus === "CLEAR")).toBe(true);
    expect(state.cars.every((car) => car.tyreSets.length === 12 && new Set(car.tyreSets.map((set) => set.id)).size === 12)).toBe(true);
    expect(state.cars.every((car) => car.tyreSets.filter((set) => set.status === "FITTED").length === 1)).toBe(true);
    expect(state.cars.every((car) => car.tyreSets.find((set) => set.id === car.activeTyreSetId)?.status === "FITTED")).toBe(true);
  });

  it("deploys race control and records a deterministic incident", () => {
    const state = runTicks(3_315, 10);
    expect(state.raceControl).toBe("VSC");
    expect(state.cars.some((car) => car.incidentStatus === "DAMAGED")).toBe(true);
    expect(state.events.some((event) => event.type === "INCIDENT" && event.message.includes("damage"))).toBe(true);
    expect(state.events.some((event) => event.type === "RACE_CONTROL" && event.message.includes("VSC"))).toBe(true);
    expect(state.activeIncident?.cornerNumber).toBeGreaterThanOrEqual(1);
    expect(state.activeIncident?.cornerNumber).toBeLessThanOrEqual(18);
    expect(state.yellowSector).toBeGreaterThanOrEqual(1);
    expect(state.radioMessages.some((message) => message.source === "RACE CONTROL")).toBe(true);
  });

  it("returns to green when a race-control period expires", () => {
    const initial = createInitialSnapshot(12);
    const state = stepSnapshot({ ...initial, status: "RUNNING", raceControl: "VSC", raceControlTimer: 0.05 });
    expect(state.raceControl).toBe("GREEN");
    expect(state.events[0].message).toContain("GREEN FLAG");
  });

  it("moves a safety-car period through bunching and restart phases", () => {
    const initial = createInitialSnapshot(88);
    const bunching = stepSnapshot({
      ...initial,
      status: "RUNNING",
      raceControl: "SAFETY_CAR",
      raceControlTimer: 70,
      safetyCarPhase: "DEPLOYED",
      safetyCarPhaseElapsedSeconds: 11.95,
      safetyCarDistance: 72,
      pitLaneOpen: false,
      pitLaneStatus: "CLOSED",
    });
    expect(bunching.safetyCarPhase).toBe("BUNCHING");
    expect(bunching.pitLaneOpen).toBe(true);
    const nextSafetyCarDistance = bunching.safetyCarDistance! + (125 / 3.6) * 0.1;
    const restart = stepSnapshot({
      ...bunching,
      safetyCarPhase: "BUNCHING",
      safetyCarPhaseElapsedSeconds: 17.95,
      cars: bunching.cars.map((car, index) => ({
        ...car,
        totalDistance: nextSafetyCarDistance - 28 - index * 14,
        currentSpeed: 125,
        reactionTime: 0,
        pitStatus: "TRACK" as const,
      })),
    });
    expect(restart.safetyCarPhase).toBe("RESTART");
    expect(restart.events.some((event) => event.message.includes("IN THIS LAP"))).toBe(true);
  });

  it("applies a local yellow limit only inside the affected sector", () => {
    const initial = createInitialSnapshot(4_212);
    const positionedCars = initial.cars.map((car, index) => {
      const totalDistance = index === 0 ? 700 : index === 1 ? 3_400 : -600 - index * 20;
      return {
        ...car,
        totalDistance,
        lapDistance: totalDistance < 0 ? 0 : totalDistance,
        currentSector: index === 0 ? 1 as const : index === 1 ? 2 as const : car.currentSector,
        currentSpeed: index < 2 ? 220 : 0,
        reactionTime: 0,
      };
    });
    const base = { ...initial, status: "RUNNING" as const, cars: positionedCars };
    const green = stepSnapshot(base);
    const yellow = stepSnapshot({ ...base, raceControl: "YELLOW", raceControlTimer: 10, yellowSector: 1 });

    expect(yellow.cars[0].currentSpeed).toBeLessThan(green.cars[0].currentSpeed);
    expect(Math.abs(yellow.cars[1].currentSpeed - green.cars[1].currentSpeed)).toBeLessThan(2);
  });

  it("tracks sustained VSC violations while leaving pit-lane cars outside the delta", () => {
    const initial = createInitialSnapshot(5_151);
    const targetId = initial.cars[0].carId;
    const pitId = initial.cars[1].carId;
    const state = stepSnapshot({
      ...initial,
      status: "RUNNING",
      raceControl: "VSC",
      raceControlTimer: 30,
      yellowSector: 1,
      cars: initial.cars.map((car) => car.carId === targetId
        ? { ...car, reactionTime: 0, currentSpeed: 320, vscDeltaSeconds: -0.25, vscViolationSeconds: 0.95, vscComplianceStatus: "WARNING" as const }
        : car.carId === pitId
          ? { ...car, reactionTime: 0, pitStatus: "PIT_LANE" as const, currentSpeed: 80, vscDeltaSeconds: 0.4 }
          : car),
    });
    const target = state.cars.find((car) => car.carId === targetId)!;
    const pitCar = state.cars.find((car) => car.carId === pitId)!;

    expect(target.vscComplianceStatus).toBe("VIOLATION");
    expect(target.vscDeltaSeconds).toBeLessThan(0);
    expect(target.vscViolationCount).toBe(1);
    expect(state.events.some((event) => event.message.includes("VSC DELTA VIOLATION"))).toBe(true);
    expect(pitCar.vscDeltaSeconds).toBe(0);
    expect(pitCar.currentSpeed).toBeLessThanOrEqual(80);
  });

  it("moves a physical safety car, assigns a unique on-track queue and closes the pit on deployment", () => {
    const initial = createInitialSnapshot(7_711);
    const state = stepSnapshot({
      ...initial,
      status: "RUNNING",
      raceControl: "SAFETY_CAR",
      raceControlTimer: 70,
      yellowSector: 3,
      safetyCarPhase: "DEPLOYED",
      safetyCarDistance: 72,
    });
    const activeCars = state.cars.filter((car) => !car.finished && car.pitStatus === "TRACK");
    const queue = activeCars.map((car) => car.safetyCarQueuePosition);
    const leader = activeCars.find((car) => car.racePosition === 1)!;

    expect(state.safetyCarDistance).toBeGreaterThan(72);
    expect(state.safetyCarSpeed).toBe(155);
    expect(state.pitLaneStatus).toBe("CLOSED");
    expect(state.pitLaneOpen).toBe(false);
    expect(queue.every((position) => position !== null)).toBe(true);
    expect(new Set(queue).size).toBe(queue.length);
    expect(leader.totalDistance).toBeLessThan(state.safetyCarDistance!);
  });

  it("releases the field to green only after the restart line", () => {
    const initial = createInitialSnapshot(9_991);
    const safetyCarDistance = 6_000;
    const nextSafetyCarDistance = safetyCarDistance + (185 / 3.6) * 0.1;
    const leaderDistance = nextSafetyCarDistance - 28;
    const restart = stepSnapshot({
      ...initial,
      status: "RUNNING",
      raceControl: "SAFETY_CAR",
      raceControlTimer: 1,
      yellowSector: 3,
      safetyCarPhase: "RESTART",
      safetyCarPhaseElapsedSeconds: 8,
      safetyCarDistance,
      safetyCarRestartLineDistance: leaderDistance - 1,
      cars: initial.cars.map((car, index) => ({
        ...car,
        totalDistance: leaderDistance - index * 12,
        currentSpeed: 150,
        reactionTime: 0,
        pitStatus: "TRACK" as const,
      })),
    });

    expect(restart.raceControl).toBe("GREEN");
    expect(restart.safetyCarPhase).toBe("NONE");
    expect(restart.safetyCarDistance).toBeNull();
    expect(restart.events.some((event) => event.message.includes("GREEN FLAG"))).toBe(true);
  });

  it("completes an injected safety-car procedure without deadlocking the field", () => {
    const initial = createInitialSnapshot(6_606);
    let state: RaceSnapshot = {
      ...initial,
      status: "RUNNING",
      raceControl: "SAFETY_CAR",
      raceControlTimer: 70,
      yellowSector: 1,
      safetyCarPhase: "DEPLOYED",
      cars: initial.cars.map((car) => ({ ...car, reactionTime: 0 })),
    };
    const phases = new Set<string>();
    for (let tick = 0; tick < 4_000 && state.raceControl === "SAFETY_CAR"; tick += 1) {
      phases.add(state.safetyCarPhase);
      state = stepSnapshot(state);
    }

    expect(phases).toContain("BUNCHING");
    expect(phases).toContain("RESTART");
    expect(state.raceControl).toBe("GREEN");
    expect(state.cars.every((car) => Number.isFinite(car.totalDistance))).toBe(true);
  });

  it("redeploys and resets the safety car when a new retirement occurs during restart", () => {
    const initial = createInitialSnapshot(37_040);
    const safetyCarDistance = 6_000;
    const nextSafetyCarDistance = safetyCarDistance + (185 / 3.6) * 0.1;
    const leaderDistance = nextSafetyCarDistance - 28;
    const state = stepSnapshot({
      ...initial,
      tick: 9,
      elapsedTime: 0.9,
      status: "RUNNING",
      raceControl: "SAFETY_CAR",
      raceControlTimer: 1,
      yellowSector: 2,
      safetyCarPhase: "RESTART",
      safetyCarPhaseElapsedSeconds: 8,
      safetyCarDistance,
      safetyCarInPitLane: true,
      safetyCarRestartLineDistance: leaderDistance - 1,
      cars: initial.cars.map((car, index) => {
        const totalDistance = index === 0 ? leaderDistance : index === 1 ? leaderDistance - 6 : leaderDistance - (index - 1) * 12;
        return {
          ...car,
          totalDistance,
          lapDistance: ((totalDistance % SILVERSTONE_CIRCUIT.lengthMeters) + SILVERSTONE_CIRCUIT.lengthMeters) % SILVERSTONE_CIRCUIT.lengthMeters,
          currentSpeed: 150,
          reactionTime: 0,
          pitStatus: "TRACK" as const,
        };
      }),
    });

    expect(state.activeIncident?.carId).toBe(initial.cars[1].carId);
    expect(state.activeIncident?.status).toBe("RETIRED");
    expect(state.raceControl).toBe("SAFETY_CAR");
    expect(state.safetyCarPhase).toBe("DEPLOYED");
    expect(state.safetyCarPhaseElapsedSeconds).toBeCloseTo(0.1, 5);
    expect(state.safetyCarRestartLineDistance).toBeNull();
    expect(state.pitLaneStatus).toBe("CLOSED");
    expect(state.events.some((event) => event.message.includes("SAFETY CAR REDEPLOYED"))).toBe(true);
  });

  it("does not retain a finish recorded before a safety-car queue correction", () => {
    const initial = createInitialSnapshot(12_340);
    const raceDistance = SILVERSTONE_CIRCUIT.lengthMeters * SILVERSTONE_CIRCUIT.totalLaps;
    const queuedCarId = initial.cars[1].carId;
    const state = stepSnapshot({
      ...initial,
      status: "RUNNING",
      raceControl: "SAFETY_CAR",
      raceControlTimer: 70,
      yellowSector: 3,
      safetyCarPhase: "DEPLOYED",
      safetyCarPhaseElapsedSeconds: 1,
      safetyCarDistance: raceDistance + 32,
      cars: initial.cars.map((car, index) => {
        const totalDistance = index === 0 ? raceDistance - 40 : index === 1 ? raceDistance - 0.05 : raceDistance - 100 - index * 20;
        return {
          ...car,
          totalDistance,
          lapDistance: ((totalDistance % SILVERSTONE_CIRCUIT.lengthMeters) + SILVERSTONE_CIRCUIT.lengthMeters) % SILVERSTONE_CIRCUIT.lengthMeters,
          currentLap: SILVERSTONE_CIRCUIT.totalLaps,
          currentSpeed: index === 1 ? 330 : 150,
          reactionTime: 0,
          pitStatus: "TRACK" as const,
        };
      }),
    });
    const queuedCar = state.cars.find((car) => car.carId === queuedCarId)!;

    expect(queuedCar.totalDistance).toBeLessThan(raceDistance);
    expect(queuedCar.finished).toBe(false);
    expect(queuedCar.finishTime).toBeNull();
    expect(queuedCar.lastLapTime).toBeNull();
  });

  it("uses the normalized real Silverstone telemetry speed profile", () => {
    expect(telemetrySpeedAtDistance(0)).toBeCloseTo(256.438, 2);
    expect(telemetrySpeedAtDistance(4_852)).toBeGreaterThan(300);
    expect(telemetryReferenceLapTime()).toBeGreaterThan(86);
    expect(telemetryReferenceLapTime()).toBeLessThan(93);
    expect(SILVERSTONE_REFERENCE_LAP_SECONDS).toBeCloseTo(89.438, 3);
  });

  it("builds a pit recommendation and logs box/stay-out radio calls", () => {
    const initial = createInitialSnapshot(91);
    const carId = "mercedes-1";
    const car = initial.cars.find((candidate) => candidate.carId === carId)!;
    const recommendation = strategyRecommendation(initial, { ...car, currentLap: 18, tyreAgeLaps: 12, tyreLife: 48 });
    expect(recommendation.pitWindowStart).toBeGreaterThanOrEqual(18);
    expect(recommendation.pitWindowEnd).toBeGreaterThanOrEqual(recommendation.pitWindowStart);
    const boxed = setCarPit(initial, carId, "HARD");
    expect(boxed.radioMessages.some((message) => message.message.includes("Box this lap") || message.message.includes("Boxing this lap"))).toBe(true);
    const boxedCar = boxed.cars.find((candidate) => candidate.carId === carId)!;
    expect(boxedCar.tyreSets.find((set) => set.id === boxedCar.scheduledPitTyreSetId)?.status).toBe("RESERVED");
    const stayingOut = cancelCarPit(boxed, carId);
    const stayingOutCar = stayingOut.cars.find((candidate) => candidate.carId === carId)!;
    expect(stayingOutCar.scheduledPitCompound).toBeNull();
    expect(stayingOutCar.scheduledPitTyreSetId).toBeNull();
    expect(stayingOutCar.tyreSets.some((set) => set.status === "RESERVED")).toBe(false);
    expect(stayingOut.radioMessages.some((message) => message.message.includes("Stay out") || message.message.includes("Staying out"))).toBe(true);
  });

  it("rejects a pit call when no fresh set of the requested compound remains", () => {
    const carId = "mercedes-1";
    const initial = createInitialSnapshot(92);
    const exhausted: RaceSnapshot = {
      ...initial,
      cars: initial.cars.map((car) => car.carId === carId ? { ...car, tyreSets: car.tyreSets.map((set) => set.compound === "SOFT" ? { ...set, status: "USED" as const } : set) } : car),
    };
    const result = setCarPit(exhausted, carId, "SOFT");
    const car = result.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.scheduledPitCompound).toBeNull();
    expect(car.scheduledPitTyreSetId).toBeNull();
    expect(result.radioMessages.some((message) => message.message.includes("No fresh SOFT set"))).toBe(true);
  });

  it("holds every car until its launch reaction time", () => {
    let state: RaceSnapshot = { ...createInitialSnapshot(99), status: "RUNNING" };
    const initialDistances = state.cars.map((car) => car.totalDistance);
    state = stepSnapshot(state);
    expect(state.cars.map((car) => car.totalDistance)).toEqual(initialDistances);
    state = stepSnapshot(state);
    state = stepSnapshot(state);
    expect(state.cars.some((car, index) => car.totalDistance > initialDistances[index])).toBe(true);
    expect(new Set(state.cars.map((car) => car.reactionTime)).size).toBeGreaterThan(1);
  });

  it("allows all five starting compounds before the race only", () => {
    const carId = "mercedes-1";
    const wetStart = setCarStartingTyre(createInitialSnapshot(), carId, "WET");
    const wetCar = wetStart.cars.find((car) => car.carId === carId)!;
    expect(wetCar.tyreCompound).toBe("WET");
    expect(wetCar.tyreSets.find((set) => set.id === wetCar.activeTyreSetId)?.compound).toBe("WET");
    expect(wetCar.tyreSets.filter((set) => set.status === "FITTED")).toHaveLength(1);
    const running: RaceSnapshot = { ...wetStart, status: "RUNNING", elapsedTime: 1 };
    expect(setCarStartingTyre(running, carId, "SOFT")).toBe(running);
  });

  it("is deterministic for the same seed and input sequence", () => {
    const first = runTicks(20260712, 5_000);
    const second = runTicks(20260712, 5_000);
    expect(first.checksum).toBe(second.checksum);
    expect(first.cars).toEqual(second.cars);
  });

  it("produces a distinct state for a different seed", () => {
    expect(runTicks(1, 500).checksum).not.toBe(runTicks(2, 500).checksum);
  });

  it("keeps positions unique and complete", () => {
    const state = runTicks(123, 1_000);
    const positions = state.cars.map((car) => car.racePosition).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 22 }, (_, index) => index + 1));
  });

  it("records sectors and a complete lap time", () => {
    const state = runTicks(123, 1_500);
    const leader = state.cars.find((car) => car.racePosition === 1)!;
    expect(leader.lastLapTime).not.toBeNull();
    expect(leader.bestLapTime).not.toBeNull();
    expect(leader.lastLapSectorTimes.every((sector) => sector !== null && sector > 0)).toBe(true);
    expect(leader.currentSector).toBeGreaterThanOrEqual(1);
    expect(leader.currentSector).toBeLessThanOrEqual(3);
    expect(Math.abs(leader.bestLapTime! - SILVERSTONE_REFERENCE_LAP_SECONDS)).toBeLessThan(3);
  });

  it("moves close-running cars onto tactical racing lines", () => {
    const state = runTicks(456, 250);
    expect(state.cars.some((car) => car.racingLineMode === "ATTACK" || car.racingLineMode === "DEFEND")).toBe(true);
    expect(state.cars.every((car) => car.trackLineOffset === 0)).toBe(true);
  });

  it("trades tyre life and fuel for distance under attack commands", () => {
    const carId = "mercedes-1";
    let attack: RaceSnapshot = { ...setCarTyreMode(setCarPace(createInitialSnapshot(77), carId, "ATTACK"), carId, "GRIP"), status: "RUNNING" };
    let conserve: RaceSnapshot = { ...setCarTyreMode(setCarPace(createInitialSnapshot(77), carId, "CONSERVE"), carId, "SAVE"), status: "RUNNING" };
    for (let index = 0; index < 2_000; index += 1) {
      attack = stepSnapshot(attack);
      conserve = stepSnapshot(conserve);
    }
    const attackingCar = attack.cars.find((car) => car.carId === carId)!;
    const conservingCar = conserve.cars.find((car) => car.carId === carId)!;
    expect(attackingCar.totalDistance).toBeGreaterThan(conservingCar.totalDistance);
    expect(attackingCar.tyreLife).toBeLessThan(conservingCar.tyreLife);
    expect(attackingCar.fuelRemainingKg).toBeLessThan(conservingCar.fuelRemainingKg);
  });

  it("activates 2026 overtake energy when a car is within one second in a straight-mode zone", () => {
    const initial = createInitialSnapshot(1_006);
    const segmentIndex = SILVERSTONE_CIRCUIT.segments.findIndex((segment) => segment.activeAeroAllowed);
    const segment = SILVERSTONE_CIRCUIT.segments[segmentIndex];
    const leaderDistance = segment.startDistance + Math.min(80, segment.length * 0.55);
    const attackerDistance = leaderDistance - 22;
    const positioned: RaceSnapshot = {
      ...initial,
      status: "RUNNING",
      cars: initial.cars.map((car) => {
        if (car.carId === "mercedes-1") return { ...car, totalDistance: attackerDistance, lapDistance: attackerDistance, currentSegment: segmentIndex, racePosition: 2, currentSpeed: 270, reactionTime: 0, gapToCarAhead: 0.3, energyMode: "ATTACK", batteryPercent: 80 };
        if (car.carId === "mercedes-2") return { ...car, totalDistance: leaderDistance, lapDistance: leaderDistance, currentSegment: segmentIndex, racePosition: 1, currentSpeed: 270, reactionTime: 0 };
        return { ...car, totalDistance: -500 - car.gridPosition * 15, currentSpeed: 0 };
      }),
    };
    const next = stepSnapshot(positioned);
    const attacker = next.cars.find((car) => car.carId === "mercedes-1")!;
    expect(attacker.activeAeroMode).toBe("STRAIGHT");
    expect(attacker.overtakeEligible).toBe(true);
    expect(attacker.overtakeActive).toBe(true);
    expect(attacker.energyState).toBe("OVERTAKE");
    expect(attacker.batteryPercent).toBeLessThan(80);
    expect(["ATTACKING", "SIDE_BY_SIDE"]).toContain(attacker.battleStatus);
  });

  it("records a completed on-track pass as an overtake battle event", () => {
    const initial = createInitialSnapshot(8_808);
    const segmentIndex = SILVERSTONE_CIRCUIT.segments.findIndex((segment) => segment.activeAeroAllowed);
    const segment = SILVERSTONE_CIRCUIT.segments[segmentIndex];
    const leaderDistance = segment.startDistance + Math.min(100, segment.length * 0.6);
    const attackingDistance = leaderDistance - 3;
    const duel: RaceSnapshot = {
      ...initial,
      status: "RUNNING",
      cars: initial.cars.map((car) => {
        if (car.carId === "mercedes-1") return { ...car, totalDistance: attackingDistance, lapDistance: attackingDistance, currentSegment: segmentIndex, racePosition: 2, currentSpeed: 330, reactionTime: 0, gapToCarAhead: 0.04, energyMode: "ATTACK", energyState: "OVERTAKE", batteryPercent: 80, overtakeEligible: true, overtakeActive: true, battleStatus: "SIDE_BY_SIDE", battleCarId: "mercedes-2" };
        if (car.carId === "mercedes-2") return { ...car, totalDistance: leaderDistance, lapDistance: leaderDistance, currentSegment: segmentIndex, racePosition: 1, currentSpeed: 120, reactionTime: 0, battleStatus: "DEFENDING", battleCarId: "mercedes-1" };
        return { ...car, totalDistance: -600 - car.gridPosition * 15, currentSpeed: 0 };
      }),
    };
    const next = stepSnapshot(duel);
    const winner = next.cars.find((car) => car.carId === "mercedes-1")!;
    expect(winner.racePosition).toBe(1);
    expect(winner.overtakes).toBe(1);
    expect(next.events.some((event) => event.type === "BATTLE" && event.message.includes("passed"))).toBe(true);
    expect(next.radioMessages.some((message) => message.message.includes("Great move"))).toBe(true);
  });

  it("makes attack mode faster but more energy intensive than recharge mode", () => {
    const carId = "mercedes-1";
    const initial = createInitialSnapshot(4_404);
    let attack: RaceSnapshot = { ...setCarEnergyMode(initial, carId, "ATTACK"), status: "RUNNING" };
    let recharge: RaceSnapshot = { ...setCarEnergyMode(initial, carId, "RECHARGE"), status: "RUNNING" };
    for (let index = 0; index < 800; index += 1) {
      attack = stepSnapshot(attack);
      recharge = stepSnapshot(recharge);
    }
    const attackingCar = attack.cars.find((car) => car.carId === carId)!;
    const rechargingCar = recharge.cars.find((car) => car.carId === carId)!;
    expect(attackingCar.totalDistance).toBeGreaterThan(rechargingCar.totalDistance);
    expect(attackingCar.batteryPercent).toBeLessThan(rechargingCar.batteryPercent);
    expect(recharge.radioMessages.some((message) => message.message.includes("Energy target confirmed"))).toBe(true);
  });

  it("gives soft tyres more pace and wear than hard tyres", () => {
    const carId = "mercedes-1";
    const initial = createInitialSnapshot(808);
    let soft: RaceSnapshot = { ...initial, status: "RUNNING", cars: initial.cars.map((car) => car.carId === carId ? { ...car, tyreCompound: "SOFT" } : car) };
    let hard: RaceSnapshot = { ...initial, status: "RUNNING", cars: initial.cars.map((car) => car.carId === carId ? { ...car, tyreCompound: "HARD" } : car) };
    for (let index = 0; index < 500; index += 1) {
      soft = stepSnapshot(soft);
      hard = stepSnapshot(hard);
    }
    const softCar = soft.cars.find((car) => car.carId === carId)!;
    const hardCar = hard.cars.find((car) => car.carId === carId)!;
    expect(softCar.totalDistance).toBeGreaterThan(hardCar.totalDistance);
    expect(softCar.tyreLife).toBeLessThan(hardCar.tyreLife);
  });

  it("builds rain and track wetness during the forecast weather window", () => {
    const state = runTicks(20260712, 5_000);
    expect(state.weather.radarCells).toHaveLength(24);
    expect(state.weather.surfaceZones).toHaveLength(48);
    expect(state.weather.sectors).toHaveLength(3);
    expect(state.weather.rainIntensity).toBeGreaterThan(0.1);
    expect(state.weather.trackWetness).toBeGreaterThan(0.1);
    expect(["LIGHT_RAIN", "HEAVY_RAIN"]).toContain(state.weather.condition);
  });

  it("slows a slick-shod car only when it reaches a wet surface zone", () => {
    const initial = createInitialSnapshot(6_161);
    const carId = "mercedes-1";
    const positionedCars = initial.cars.map((car) => car.carId === carId ? { ...car, reactionTime: 0, currentSpeed: 240, totalDistance: 60, lapDistance: 60 } : car);
    const dryWeather = {
      ...initial.weather,
      surfaceZones: initial.weather.surfaceZones!.map((zone) => ({ ...zone, rainIntensity: 0, wetness: 0, standingWater: 0, dryingLine: 1 })),
    };
    const wetWeather = {
      ...dryWeather,
      surfaceZones: dryWeather.surfaceZones.map((zone, index) => index === 0 ? { ...zone, rainIntensity: 0.7, wetness: 0.9, standingWater: 0.25, dryingLine: 0.05 } : zone),
    };
    const dry = stepSnapshot({ ...initial, status: "RUNNING", cars: positionedCars, weather: dryWeather });
    const wet = stepSnapshot({ ...initial, status: "RUNNING", cars: positionedCars, weather: wetWeather });
    expect(wet.cars.find((car) => car.carId === carId)!.currentSpeed).toBeLessThan(dry.cars.find((car) => car.carId === carId)!.currentSpeed);
    expect(checksumFor(1, positionedCars, wetWeather)).not.toBe(checksumFor(1, positionedCars, dryWeather));
  });

  it("executes a scheduled pit stop and fits the requested compound", () => {
    const carId = "mercedes-1";
    const scheduled = setCarPit(createInitialSnapshot(909), carId, "SOFT");
    let state: RaceSnapshot = {
      ...scheduled,
      status: "RUNNING",
      cars: scheduled.cars.map((car) => car.carId === carId ? { ...car, totalDistance: PIT_ENTRY_START - 5, currentSpeed: 180, reactionTime: 0, tyreLife: 28 } : car),
    };
    for (let index = 0; index < 700; index += 1) state = stepSnapshot(state);
    const car = state.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.pitStops).toBe(1);
    expect(car.tyreCompound).toBe("SOFT");
    expect(car.scheduledPitCompound).toBeNull();
    expect(car.scheduledPitTyreSetId).toBeNull();
    expect(car.pitStatus).toBe("TRACK");
    expect(car.tyreLife).toBeGreaterThan(90);
    expect(car.lastPitStopTime).toBeGreaterThanOrEqual(2.2);
    expect(car.lastPitStopTime).toBeLessThan(7);
    expect(car.tyreSets.filter((set) => set.status === "FITTED")).toHaveLength(1);
    expect(car.tyreSets.find((set) => set.id === car.activeTyreSetId)?.compound).toBe("SOFT");
    expect(car.tyreSets.some((set) => set.status === "USED" && set.compound === "MEDIUM")).toBe(true);
    expect(car.usedTyreCompounds).toContain("SOFT");
    expect(estimatePitOutPosition(state, carId)).toBeGreaterThanOrEqual(1);
  });

  it("adds a deterministic delay for a double-stacked teammate", () => {
    const firstId = "mercedes-1";
    const secondId = "mercedes-2";
    let scheduled = setCarPit(createInitialSnapshot(1_212), firstId, "HARD");
    scheduled = setCarPit(scheduled, secondId, "SOFT");
    const boxed: RaceSnapshot = {
      ...scheduled,
      status: "RUNNING",
      cars: scheduled.cars.map((car) => car.carId === firstId || car.carId === secondId ? { ...car, pitStatus: "PIT_LANE", totalDistance: PIT_BOX_DISTANCE, lapDistance: PIT_BOX_DISTANCE, currentSpeed: 80, reactionTime: 0 } : car),
    };
    const next = stepSnapshot(boxed);
    const first = next.cars.find((car) => car.carId === firstId)!;
    const second = next.cars.find((car) => car.carId === secondId)!;
    expect(first.pitStatus).toBe("PIT_STOP");
    expect(second.pitStatus).toBe("PIT_STOP");
    expect(second.pitStopIssue).toBe("DOUBLE_STACK");
    expect(second.pitStopTargetSeconds).toBeGreaterThan(first.pitStopTargetSeconds);
  });

  it("completes a full 52-lap race without invalid car state", () => {
    const state = runTicks(20260712, 65_000);
    expect(state.status).toBe("FINISHED");
    expect(state.cars.every((car) => Number.isFinite(car.totalDistance) && car.finished)).toBe(true);
  }, 15_000);
});
