import { describe, expect, it } from "vitest";

import { DRIVERS, PLAYER_CAR_IDS, playerCarIdsFor, TEAMS } from "@/fixtures/grid";
import {
  abortQualifyingLap,
  coolDownQualifyingCar,
  createWeekendState,
  holdQualifyingCar,
  liveQualifyingClassification,
  qualifyingAiRunPlan,
  qualifyingCarProgress,
  qualifyingDisplayStatus,
  qualifyingCutPosition,
  qualifyingReleaseForecast,
  qualifyingTrafficDecision,
  recallQualifyingCar,
  releaseQualifyingCar,
  runWeekendSession,
  setLiveQualifyingSpeed,
  setQualifyingCompound,
  setQualifyingAttackMode,
  setQualifyingFuelPlan,
  setQualifyingOutLapMode,
  setQualifyingTrafficResponse,
  setQualifyingTyreSet,
  setWeekendCarSetup,
  setupFeedbackFor,
  setupRecommendationFor,
  STANDARD_WEEKEND_RULES,
  startLiveQualifying,
  skipLiveQualifyingSession,
  tickLiveQualifying,
  toggleLiveQualifyingPause,
  waitForQualifyingGap,
  type WeekendState,
} from "@/simulation/weekend";

function selectFreshTyre<T extends ReturnType<typeof createWeekendState>>(state: T, carId: string, compound = "SOFT"): T {
  const set = state.tyreInventory[carId].find((candidate) => candidate.compound === compound && candidate.status === "NEW");
  if (!set) throw new Error(`No fresh ${compound} tyre for ${carId}`);
  return setQualifyingTyreSet(state, carId, set.id) as T;
}

function completeLiveQualifyingWithTimes(
  state: WeekendState,
  timedCarIds: readonly string[],
  invalidCarIds: readonly string[] = [],
  lapTimeOverrides: Readonly<Record<string, number>> = {},
): WeekendState {
  const live = state.qualifyingLive!;
  const timed = new Set(timedCarIds);
  const invalid = new Set(invalidCarIds);
  const cars = Object.fromEntries(Object.entries(live.cars).map(([carId, car], index) => {
    const hasTime = timed.has(carId);
    const hasInvalidLap = invalid.has(carId);
    const lap = hasTime ? lapTimeOverrides[carId] ?? 88 + index / 100 : null;
    return [carId, {
      ...car,
      phase: "GARAGE" as const,
      bestLapSeconds: lap,
      lastLapSeconds: lap ?? (hasInvalidLap ? 91 + index / 100 : null),
      completedRuns: hasTime || hasInvalidLap ? 1 : 0,
      lastRunNote: hasInvalidLap ? "TRACK LIMITS" as const : hasTime ? "CLEAN" as const : "NO TIME" as const,
    }];
  }));
  return tickLiveQualifying({
    ...state,
    qualifyingLive: { ...live, status: "CHECKERED", remainingSeconds: 0, cars },
  }, 1);
}

describe("standard Formula 1 weekend", () => {
  it("uses the 2026 22-car qualifying format", () => {
    expect(STANDARD_WEEKEND_RULES.map((rule) => [rule.id, rule.durationMinutes, rule.entrants, rule.eliminated, rule.breakBeforeMinutes])).toEqual([
      ["FP1", 60, 22, 0, 0],
      ["FP2", 60, 22, 0, 0],
      ["FP3", 60, 22, 0, 0],
      ["Q1", 18, 22, 6, 0],
      ["Q2", 15, 16, 6, 7],
      ["Q3", 13, 10, 0, 7],
      ["RACE", null, 22, 0, 0],
    ]);
  });

  it("runs FP1 through Q3 and creates a complete race grid", () => {
    let weekend = createWeekendState(20_260_712);
    for (let index = 0; index < 6; index += 1) weekend = runWeekendSession(weekend);

    expect(weekend.currentSession).toBe("RACE");
    expect(weekend.completedSessions).toEqual(["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"]);
    expect(weekend.results.find((result) => result.session === "Q1")?.entries).toHaveLength(22);
    expect(weekend.results.find((result) => result.session === "Q1")?.entries.filter((entry) => entry.eliminated)).toHaveLength(6);
    expect(weekend.results.find((result) => result.session === "Q2")?.entries).toHaveLength(16);
    expect(weekend.results.find((result) => result.session === "Q2")?.entries.filter((entry) => entry.eliminated)).toHaveLength(6);
    expect(weekend.results.find((result) => result.session === "Q3")?.entries).toHaveLength(10);
    expect(weekend.gridOrder).toHaveLength(22);
    expect(new Set(weekend.gridOrder)).toEqual(new Set(DRIVERS.map((driver) => driver.id)));
    expect(weekend.qualifying.every((record) => record.finalPosition !== null)).toBe(true);
    expect(weekend.setupKnowledge).toBe(90);
    expect(weekend.tyreUsage[DRIVERS[0].id]).toMatchObject({ HARD: 0, MEDIUM: 0, SOFT: 3, INTERMEDIATE: 0, WET: 0 });
  });

  it("is deterministic and clamps player setup ranges", () => {
    const carId = DRIVERS[0].id;
    const initial = createWeekendState(77);
    const configured = setWeekendCarSetup(initial, carId, { frontWing: 99, suspension: -99, cooling: 8.4 });
    expect(configured.setups[carId]).toEqual({ ...initial.setups[carId], frontWing: 50, suspension: -50, cooling: 8 });
    expect(runWeekendSession(configured)).toEqual(runWeekendSession(configured));
  });

  it("turns FP1 running into narrative FP2 setup feedback without exposing target values", () => {
    const afterFp1 = runWeekendSession(createWeekendState(20_260_712));
    const feedback = setupFeedbackFor(afterFp1, PLAYER_CAR_IDS[0]);
    expect(afterFp1.currentSession).toBe("FP2");
    expect(feedback[0].message).toContain("FP1 debrief");
    expect(feedback.some((item) => item.area === "AERO" && item.message.includes("Copse"))).toBe(true);
    expect(feedback.map((item) => item.message).join(" ")).not.toContain("Wing 7");
  });

  it("narrows the recommended setup band after each practice session", () => {
    let weekend = createWeekendState(20_260_712);
    const carId = PLAYER_CAR_IDS[0];
    expect(setupRecommendationFor(weekend, carId, "frontWing")).toBeNull();
    weekend = runWeekendSession(weekend);
    const afterFp1 = setupRecommendationFor(weekend, carId, "frontWing")!;
    weekend = runWeekendSession(weekend);
    const afterFp2 = setupRecommendationFor(weekend, carId, "frontWing")!;
    weekend = runWeekendSession(weekend);
    const afterFp3 = setupRecommendationFor(weekend, carId, "frontWing")!;
    expect(afterFp1.maximum - afterFp1.minimum).toBe(40);
    expect(afterFp2.maximum - afterFp2.minimum).toBe(30);
    expect(afterFp3.maximum - afterFp3.minimum).toBe(22);
    expect([afterFp1.sourceSession, afterFp2.sourceSession, afterFp3.sourceSession]).toEqual(["FP1", "FP2", "FP3"]);
  });

  it("does not gift both player cars the front row on the untouched baseline", () => {
    let weekend = createWeekendState(20_260_712);
    for (let index = 0; index < 6; index += 1) weekend = runWeekendSession(weekend);
    const playerGridPositions = PLAYER_CAR_IDS.map((carId) => weekend.gridOrder.indexOf(carId) + 1);
    expect(playerGridPositions.filter((position) => position <= 2)).toHaveLength(0);
  });

  it("creates a two-car driver debrief after every practice and qualifying session", () => {
    let weekend = createWeekendState(20_260_712, "ferrari");
    for (let index = 0; index < 6; index += 1) weekend = runWeekendSession(weekend);

    expect(weekend.sessionReports.map((report) => report.session)).toEqual(["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"]);
    for (const report of weekend.sessionReports) {
      expect(report.cars.map((car) => car.carId)).toEqual(playerCarIdsFor("ferrari"));
      expect(report.summary.length).toBeGreaterThan(20);
      for (const car of report.cars) {
        expect(car.driverMessage.length).toBeGreaterThan(30);
        expect(car.driverMessage.length).toBeLessThan(330);
        // The debrief is the driver's own voice, never raw telemetry readouts.
        expect(car.driverMessage).not.toMatch(/Aero \d+%|mechanical \d+%|thermal margin \d+%/);
        expect(car.aeroBalancePercent).toBeGreaterThanOrEqual(0);
        expect(car.aeroBalancePercent).toBeLessThanOrEqual(100);
        expect(car.mechanicalBalancePercent).toBeGreaterThanOrEqual(0);
        expect(car.thermalMarginPercent).toBeGreaterThanOrEqual(0);
        expect(car.tyreConditionPercent).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("applies the selected constructor to both controlled race seats", () => {
    const weekend = createWeekendState(77, "mclaren");
    expect(weekend.playerTeamId).toBe("mclaren");
    expect(playerCarIdsFor(weekend.playerTeamId)).toEqual(["mclaren-1", "mclaren-2"]);
    expect(weekend.setups["mclaren-1"]).toEqual({ frontWing: -8, rearWing: 6, suspension: 5, rideHeight: -4, differential: -5, cooling: -18 });
    expect(weekend.setups["mclaren-2"]).toEqual({ frontWing: 6, rearWing: -4, suspension: -10, rideHeight: 7, differential: 15, cooling: 18 });
  });

  it("runs the complete weekend safely for every selectable constructor", () => {
    for (const team of TEAMS) {
      let weekend = createWeekendState(20_260_715, team.id);
      expect(playerCarIdsFor(team.id)).toHaveLength(2);
      for (let index = 0; index < 6; index += 1) weekend = runWeekendSession(weekend);
      expect(weekend.currentSession, team.id).toBe("RACE");
      expect(weekend.gridOrder, team.id).toHaveLength(22);
      expect(weekend.sessionReports.at(-1)?.cars.map((car) => car.carId), team.id).toEqual(playerCarIdsFor(team.id));
    }
  });

  it("runs Q1 as a live timed session with manual player releases and automatic field programmes", () => {
    let weekend = createWeekendState(20_260_712, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    expect(weekend.currentSession).toBe("Q1");
    expect(weekend.qualifyingLive?.status).toBe("READY");
    expect(qualifyingCutPosition(weekend)).toBe(16);

    weekend = setLiveQualifyingSpeed(weekend, 16);
    weekend = setQualifyingCompound(weekend, "ferrari-1", "MEDIUM");
    weekend = startLiveQualifying(weekend);
    weekend = setQualifyingOutLapMode(weekend, "ferrari-1", "FAST");
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].phase).toBe("OUT_LAP");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].selectedCompound).toBe("MEDIUM");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].outLapMode).toBe("FAST");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].energyMode).toBe("CHARGE");
    expect(weekend.tyreUsage["ferrari-1"].MEDIUM).toBe(1);

    weekend = tickLiveQualifying(weekend, 210);
    expect(weekend.qualifyingLive?.cars["ferrari-1"].completedRuns).toBe(1);
    expect(weekend.qualifyingLive?.cars["ferrari-1"].tyreConditionPercent).toBeLessThan(100);
    expect(weekend.qualifyingLive?.cars["ferrari-1"].energyPercent).toBeLessThan(100);
    expect(liveQualifyingClassification(weekend).find((entry) => entry.carId === "ferrari-1")?.bestLapSeconds).not.toBeNull();
    expect(weekend.qualifyingLive?.cars["ferrari-1"].phase).toBe("IN_LAP");

    weekend = tickLiveQualifying(weekend, 1_200);
    expect(weekend.currentSession).toBe("Q2");
    expect(weekend.results.find((result) => result.session === "Q1")?.entries).toHaveLength(22);
    expect(weekend.results.find((result) => result.session === "Q1")?.entries.filter((entry) => entry.eliminated)).toHaveLength(6);
    expect(weekend.qualifyingLive?.status).toBe("READY");
    expect(weekend.qualifyingLive && Object.keys(weekend.qualifyingLive.cars)).toHaveLength(16);
    expect(weekend.qualifyingLive?.timing.bestSectorTimes).toEqual([null, null, null]);
  });

  it("runs 1x in real-time scale and pauses without accumulating simulation time", () => {
    let weekend = createWeekendState(20_260_804, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    expect(weekend.qualifyingLive?.speed).toBe(1);
    weekend = startLiveQualifying(weekend);
    const before = weekend.qualifyingLive!.remainingSeconds;
    weekend = toggleLiveQualifyingPause(weekend);
    expect(weekend.qualifyingLive?.paused).toBe(true);
    weekend = tickLiveQualifying(weekend, 5);
    expect(weekend.qualifyingLive?.remainingSeconds).toBe(before);
    weekend = toggleLiveQualifyingPause(weekend);
    weekend = tickLiveQualifying(weekend, 1);
    expect(weekend.qualifyingLive?.remainingSeconds).toBe(before - 1);
  });

  it("resets live sector records from Q1 to Q2 and from Q2 to Q3", () => {
    let weekend = createWeekendState(20_260_805, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = tickLiveQualifying(weekend, 1_300);
    expect(weekend.currentSession).toBe("Q2");
    expect(weekend.results.find((result) => result.session === "Q1")?.entries.some((entry) => entry.bestLapSeconds > 0)).toBe(true);
    expect(weekend.qualifyingLive?.timing.bestSectorTimes).toEqual([null, null, null]);

    weekend = startLiveQualifying(weekend);
    weekend = tickLiveQualifying(weekend, 1_200);
    expect(weekend.currentSession).toBe("Q3");
    expect(weekend.results.find((result) => result.session === "Q2")?.entries.some((entry) => entry.bestLapSeconds > 0)).toBe(true);
    expect(weekend.qualifyingLive?.timing.bestSectorTimes).toEqual([null, null, null]);
  });

  it("advances only valid timed drivers from Q1 and permanently eliminates no-time or invalid-lap cars", () => {
    let weekend = createWeekendState(20_260_831, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const q1Entrants = Object.keys(weekend.qualifyingLive!.cars);
    const timedDrivers = q1Entrants.slice(0, 15);
    const invalidDriver = q1Entrants[15];
    const noTimeDriver = q1Entrants[16];

    weekend = completeLiveQualifyingWithTimes(weekend, timedDrivers, [invalidDriver]);

    expect(weekend.currentSession).toBe("Q2");
    expect(Object.keys(weekend.qualifyingLive!.cars)).toEqual(timedDrivers);
    expect(weekend.qualifyingLive!.cars[invalidDriver]).toBeUndefined();
    expect(weekend.qualifyingLive!.cars[noTimeDriver]).toBeUndefined();
    const q1 = weekend.results.find((result) => result.session === "Q1")!;
    expect(q1.entries.find((entry) => entry.carId === invalidDriver)).toMatchObject({ eliminated: true, timedLap: false });
    expect(q1.entries.find((entry) => entry.carId === noTimeDriver)).toMatchObject({ eliminated: true, timedLap: false });
    expect(q1.entries.filter((entry) => !entry.eliminated)).toHaveLength(15);
    expect(weekend.qualifying.find((record) => record.carId === invalidDriver)).toMatchObject({ q1: null, eliminatedIn: "Q1" });
    expect(weekend.qualifyingLive!.timing.bestSectorTimes).toEqual([null, null, null]);
  });

  it("builds Q3 strictly from Q2 qualifiers and keeps Q1/Q2 elimination state persistent", () => {
    let weekend = createWeekendState(20_260_832, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const q1Entrants = Object.keys(weekend.qualifyingLive!.cars);
    const q1Qualifiers = q1Entrants.slice(0, 16);
    const tiedTime = 88.02;
    weekend = completeLiveQualifyingWithTimes(weekend, q1Qualifiers, [], {
      [q1Qualifiers[0]]: tiedTime,
      [q1Qualifiers[1]]: tiedTime,
    });
    expect(Object.keys(weekend.qualifyingLive!.cars)).toEqual(q1Qualifiers);
    expect(weekend.results.find((result) => result.session === "Q1")!.entries.slice(0, 2).map((entry) => entry.carId)).toEqual(q1Qualifiers.slice(0, 2));

    const q2Entrants = Object.keys(weekend.qualifyingLive!.cars);
    const q2Qualifiers = q2Entrants.slice(0, 9);
    const q2Invalid = q2Entrants[9];
    weekend = completeLiveQualifyingWithTimes(weekend, q2Qualifiers, [q2Invalid]);

    expect(weekend.currentSession).toBe("Q3");
    expect(Object.keys(weekend.qualifyingLive!.cars)).toEqual(q2Qualifiers);
    expect(weekend.qualifyingLive!.cars[q2Invalid]).toBeUndefined();
    const q2 = weekend.results.find((result) => result.session === "Q2")!;
    expect(q2.entries.find((entry) => entry.carId === q2Invalid)).toMatchObject({ eliminated: true, timedLap: false });
    expect(q2.entries.filter((entry) => !entry.eliminated)).toHaveLength(9);
    expect(weekend.qualifying.find((record) => record.carId === q1Entrants[20])?.eliminatedIn).toBe("Q1");
    expect(weekend.qualifying.find((record) => record.carId === q2Invalid)?.eliminatedIn).toBe("Q2");
    for (const car of Object.values(weekend.qualifyingLive!.cars)) {
      expect(car.bestLapSeconds).toBeNull();
      expect(car.completedRuns).toBe(0);
      expect(car.timing.personalBestSectorTimes).toEqual([null, null, null]);
    }
  });

  it("locks setup changes in parc ferme and physically recalls an out-lap car through pit entry", () => {
    let weekend = createWeekendState(91, "mclaren");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const setupBeforeQualifying = weekend.setups["mclaren-1"];
    weekend = setWeekendCarSetup(weekend, "mclaren-1", { frontWing: 50 });
    expect(weekend.setups["mclaren-1"]).toEqual(setupBeforeQualifying);

    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "mclaren-1");
    weekend = releaseQualifyingCar(weekend, "mclaren-1");
    weekend = recallQualifyingCar(weekend, "mclaren-1");
    expect(weekend.qualifyingLive?.cars["mclaren-1"].phase).toBe("IN_LAP");
    expect(weekend.qualifyingLive?.cars["mclaren-1"].energyMode).toBe("CHARGE");
    const returnDuration = weekend.qualifyingLive!.cars["mclaren-1"].phaseDurationSeconds;
    weekend = tickLiveQualifying(weekend, returnDuration);
    expect(weekend.qualifyingLive?.cars["mclaren-1"].phase).toBe("PIT_ENTRY");
    expect(weekend.qualifyingLive?.cars["mclaren-1"].currentSpeedKph).toBe(80);
    weekend = tickLiveQualifying(weekend, 7);
    expect(weekend.qualifyingLive?.cars["mclaren-1"].phase).toBe("GARAGE");
  });

  it("forecasts release timing, can wait for a gap and physically returns an aborted flying lap", () => {
    let weekend = createWeekendState(20_260_801, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const carId = "ferrari-1";
    const readyForecast = qualifyingReleaseForecast(weekend, carId)!;
    expect(readyForecast.trackCars).toBe(0);
    expect(readyForecast.canFinishBeforeChequered).toBe(true);
    expect(readyForecast.flyingLapStartsInSeconds).toBeGreaterThan(70);
    expect(readyForecast.targetGapSeconds).toBeGreaterThanOrEqual(3.8);

    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, carId);
    weekend = setQualifyingOutLapMode(weekend, carId, "FAST");
    weekend = setQualifyingAttackMode(weekend, carId, "MAXIMUM");
    weekend = waitForQualifyingGap(weekend, carId);
    expect(weekend.qualifyingLive?.cars[carId].releaseRequest).toBe("WAIT_FOR_GAP");
    weekend = tickLiveQualifying(weekend, 1);
    expect(weekend.qualifyingLive?.cars[carId].phase).toBe("OUT_LAP");
    expect(weekend.qualifyingLive?.cars[carId].outLapMode).toBe("FAST");
    expect(weekend.qualifyingLive?.cars[carId].attackMode).toBe("MAXIMUM");

    const outLapDuration = weekend.qualifyingLive!.cars[carId].phaseDurationSeconds;
    weekend = tickLiveQualifying(weekend, outLapDuration + 1);
    expect(weekend.qualifyingLive?.cars[carId].phase).toBe("PUSH_LAP");
    weekend = tickLiveQualifying(weekend, 12);
    weekend = abortQualifyingLap(weekend, carId);
    expect(weekend.qualifyingLive?.cars[carId].phase).toBe("ABORTED_LAP");
    expect(weekend.qualifyingLive?.cars[carId].energyMode).toBe("CHARGE");
    expect(qualifyingDisplayStatus(weekend.qualifyingLive!.cars[carId])).toBe("ABORTED LAP");
    expect(weekend.qualifyingLive!.cars[carId].phaseStartProgress).toBeGreaterThan(0);
    const energyBeforeRecovery = weekend.qualifyingLive!.cars[carId].energyPercent;
    weekend = tickLiveQualifying(weekend, 5);
    expect(weekend.qualifyingLive!.cars[carId].energyPercent).toBeGreaterThan(energyBeforeRecovery);
  });

  it("runs a one-attempt car through out, flying, one in lap, pit entry and garage", () => {
    let weekend = createWeekendState(20_260_824, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const carId = "ferrari-1";
    weekend = selectFreshTyre(weekend, carId);
    weekend = setQualifyingFuelPlan(weekend, carId, "ONE_LAP");
    expect(weekend.qualifyingLive!.cars[carId].energyMode).toBe("CHARGE");
    weekend = releaseQualifyingCar(weekend, carId);
    const phases = [weekend.qualifyingLive!.cars[carId].phase];
    const energyByPhase = new Map([[weekend.qualifyingLive!.cars[carId].phase, weekend.qualifyingLive!.cars[carId].energyMode]]);
    for (let second = 0; second < 360; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      const phase = weekend.qualifyingLive!.cars[carId].phase;
      if (phase !== phases.at(-1)) {
        phases.push(phase);
        energyByPhase.set(phase, weekend.qualifyingLive!.cars[carId].energyMode);
      }
      if (phase === "GARAGE") break;
    }
    expect(phases).toEqual(["OUT_LAP", "PUSH_LAP", "IN_LAP", "PIT_ENTRY", "GARAGE"]);
    expect([...energyByPhase.entries()]).toEqual([
      ["OUT_LAP", "CHARGE"],
      ["PUSH_LAP", "QUALI"],
      ["IN_LAP", "CHARGE"],
      ["PIT_ENTRY", "CHARGE"],
      ["GARAGE", "CHARGE"],
    ]);
  });

  it("supports hold, traffic response and a two-flying-lap fuel plan", () => {
    let weekend = createWeekendState(20_260_819, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const carId = "ferrari-1";
    weekend = selectFreshTyre(weekend, carId);

    weekend = waitForQualifyingGap(weekend, carId);
    weekend = holdQualifyingCar(weekend, carId);
    expect(weekend.qualifyingLive?.cars[carId].releaseRequest).toBe("HOLD");
    weekend = setQualifyingTrafficResponse(weekend, carId, "CREATE_GAP");
    weekend = setQualifyingFuelPlan(weekend, carId, "TWO_LAPS");
    expect(weekend.qualifyingLive?.cars[carId]).toMatchObject({
      trafficResponse: "CREATE_GAP",
      fuelPlan: "TWO_LAPS",
      flyingLapsRemaining: 0,
    });

    weekend = releaseQualifyingCar(weekend, carId);
    expect(weekend.qualifyingLive?.cars[carId].flyingLapsRemaining).toBe(2);
    expect(weekend.qualifyingLive?.cars[carId].fuelLoadKg).toBeGreaterThan(3);
    while (weekend.qualifyingLive!.cars[carId].phase === "OUT_LAP") weekend = tickLiveQualifying(weekend, 1);
    expect(weekend.qualifyingLive!.cars[carId]).toMatchObject({ phase: "PUSH_LAP", energyMode: "QUALI" });
    while (weekend.qualifyingLive!.cars[carId].phase === "PUSH_LAP") weekend = tickLiveQualifying(weekend, 1);
    // A car with a flying lap left recovers on an in lap rather than pitting.
    expect(weekend.qualifyingLive!.cars[carId]).toMatchObject({ phase: "IN_LAP", energyMode: "CHARGE" });
    expect(weekend.qualifyingLive!.cars[carId].flyingLapsRemaining).toBeGreaterThan(0);
    /*
     * The recovery in-lap is stretched to keep clear of other traffic, so the
     * second attempt lands later than the old fixed-length cool-down. Run to the
     * end of the segment rather than a fixed budget.
     */
    while (weekend.currentSession === "Q1" && weekend.qualifyingLive!.cars[carId].completedRuns < 2) {
      weekend = tickLiveQualifying(weekend, 1);
    }
    expect(weekend.qualifyingLive?.cars[carId].completedRuns).toBe(2);
    expect(weekend.qualifyingLive?.cars[carId].fuelLoadKg).toBeLessThan(1.5);
  });

  it("lets the player switch an out lap directly to a recovery in lap", () => {
    let weekend = createWeekendState(20_260_820, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    weekend = tickLiveQualifying(weekend, 8);
    weekend = coolDownQualifyingCar(weekend, "ferrari-1");
    expect(weekend.qualifyingLive?.cars["ferrari-1"]).toMatchObject({ phase: "IN_LAP", lastRunNote: "ABORTED" });
    expect(weekend.qualifyingLive!.cars["ferrari-1"].flyingLapsRemaining).toBeGreaterThan(0);
  });

  it("uses the race telemetry speed profile and a blanket-to-push-to-cool tyre cycle", () => {
    let weekend = createWeekendState(20_260_803, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    weekend = setQualifyingOutLapMode(weekend, "ferrari-1", "FAST");
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend.qualifyingLive!.cars["ferrari-1"].tyreTemperatureC).toBe(82);

    const pushSpeeds: number[] = [];
    const outLapTemperatures: number[] = [];
    const pushTemperatures: number[] = [];
    const coolTemperatures: number[] = [];
    for (let second = 0; second < 245; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      const car = weekend.qualifyingLive!.cars["ferrari-1"];
      if (car.phase === "OUT_LAP") outLapTemperatures.push(car.tyreTemperatureC);
      if (car.phase === "PUSH_LAP") {
        pushSpeeds.push(car.currentSpeedKph);
        pushTemperatures.push(car.tyreTemperatureC);
      }
      if (car.phase === "IN_LAP" || car.phase === "PIT_ENTRY") coolTemperatures.push(car.tyreTemperatureC);
    }

    expect(Math.min(...pushSpeeds)).toBeLessThan(135);
    expect(Math.max(...pushSpeeds)).toBeGreaterThan(285);
    expect(Math.max(...outLapTemperatures)).toBeGreaterThan(88);
    expect(Math.max(...pushTemperatures)).toBeGreaterThan(Math.max(...outLapTemperatures) - 1);
    expect(coolTemperatures.at(-1)).toBeLessThan(Math.max(...pushTemperatures));
    expect(new Set(Object.values(weekend.qualifyingLive!.cars["ferrari-1"].tyreTemperatures).map((value) => Math.round(value)) ).size).toBeGreaterThan(1);
    expect(weekend.qualifyingLive!.cars["ferrari-1"].timing.currentSectorTones).toHaveLength(3);
    expect(weekend.qualifyingLive!.cars["ferrari-1"].timing.currentSectorTones.filter((tone) => tone !== "NEUTRAL")).toHaveLength(3);
  });

  it("shows slower driver-specific out-lap sectors without changing competitive records", () => {
    let weekend = createWeekendState(20_260_823, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    weekend = selectFreshTyre(weekend, "ferrari-2");
    weekend = setQualifyingOutLapMode(weekend, "ferrari-1", "FAST");
    weekend = setQualifyingOutLapMode(weekend, "ferrari-2", "FAST");
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    weekend = waitForQualifyingGap(weekend, "ferrari-2");
    for (let second = 0; second < 30 && weekend.qualifyingLive!.cars["ferrari-2"].phase === "GARAGE"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
    }
    expect(weekend.qualifyingLive!.cars["ferrari-2"].phase).toBe("OUT_LAP");

    const firstTargets = weekend.qualifyingLive!.cars["ferrari-1"].provisionalSectorTargets!;
    const secondTargets = weekend.qualifyingLive!.cars["ferrari-2"].provisionalSectorTargets!;
    expect(firstTargets).not.toEqual(secondTargets);
    expect(firstTargets.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(96);
    expect(secondTargets.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(96);

    const firstDuration = weekend.qualifyingLive!.cars["ferrari-1"].phaseDurationSeconds;
    weekend = tickLiveQualifying(weekend, Math.ceil(firstDuration * 0.34));
    const partial = weekend.qualifyingLive!.cars["ferrari-1"];
    expect(partial.phase).toBe("OUT_LAP");
    expect(partial.timing.currentSectorTimes[0]).not.toBeNull();
    expect(partial.timing.currentSectorTimes[1]).toBeNull();
    expect(partial.timing.currentSectorTones[0]).toBe("NEUTRAL");
    expect(partial.timing.currentLapCompetitive).toBe(false);
    expect(partial.timing.personalBestSectorTimes).toEqual([null, null, null]);
    expect(weekend.qualifyingLive!.timing.bestSectorTimes).toEqual([null, null, null]);

    while (weekend.qualifyingLive!.cars["ferrari-1"].phase === "OUT_LAP"
      && weekend.qualifyingLive!.cars["ferrari-1"].timing.currentSectorTimes.some((time) => time === null)) {
      weekend = tickLiveQualifying(weekend, 1);
    }
    const completeOutLap = weekend.qualifyingLive!.cars["ferrari-1"];
    expect(completeOutLap.phase).toBe("OUT_LAP");
    expect(completeOutLap.timing.currentSectorTimes.every((time) => time !== null)).toBe(true);
    expect(completeOutLap.timing.currentSectorTones).toEqual(["NEUTRAL", "NEUTRAL", "NEUTRAL"]);
    expect(weekend.qualifyingLive!.timing.bestSectorTimes).toEqual([null, null, null]);

    while (weekend.qualifyingLive!.cars["ferrari-1"].phase === "OUT_LAP") weekend = tickLiveQualifying(weekend, 1);
    const pushing = weekend.qualifyingLive!.cars["ferrari-1"];
    expect(pushing.phase).toBe("PUSH_LAP");
    expect(pushing.timing.currentLapCompetitive).toBe(true);
    expect(pushing.timing.currentSectorTimes).toEqual([null, null, null]);
  });

  it("staggers AI release windows instead of sending the field on one schedule", () => {
    let weekend = createWeekendState(20_260_804, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const playerCars = new Set(playerCarIdsFor("ferrari"));
    const firstReleaseAt = new Map<string, number>();
    for (let second = 1; second <= 260; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      for (const car of Object.values(weekend.qualifyingLive!.cars)) {
        if (!playerCars.has(car.carId) && car.phase !== "GARAGE" && !firstReleaseAt.has(car.carId)) firstReleaseAt.set(car.carId, second);
      }
    }
    const releases = [...firstReleaseAt.values()];
    expect(releases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(releases).size).toBe(releases.length);
    expect(Math.max(...releases) - Math.min(...releases)).toBeGreaterThan(100);
    const denseTenSecondWindows = releases.filter((releaseAt) => releases.filter((candidate) => Math.abs(candidate - releaseAt) <= 5).length > 2);
    expect(denseTenSecondWindows).toHaveLength(0);
  });

  it("changes AI run priority from banker to tyre-saving build or final attack around the cut", () => {
    let weekend = createWeekendState(20_260_835, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const live = weekend.qualifyingLive!;
    const targetId = "mercedes-1";

    expect(qualifyingAiRunPlan(weekend, targetId)).toMatchObject({
      priority: "BANKER",
      preferFreshTyre: true,
      cutPosition: 16,
    });

    const safeCars = Object.fromEntries(Object.entries(live.cars).map(([carId, car], index) => [carId, {
      ...car,
      phase: "GARAGE" as const,
      completedRuns: 1,
      bestLapSeconds: carId === targetId ? 87.9 : 88.25 + index * 0.09,
    }]));
    weekend = { ...weekend, qualifyingLive: { ...live, elapsedSeconds: 480, remainingSeconds: 600, cars: safeCars } };
    const safePlan = qualifyingAiRunPlan(weekend, targetId)!;
    expect(safePlan).toMatchObject({ priority: "BUILD", preferFreshTyre: false, targetRuns: 2 });
    expect(safePlan.marginToCutSeconds).toBeGreaterThan(0.58);

    const cutCars = Object.fromEntries(Object.entries(safeCars).map(([carId, car], index) => [carId, {
      ...car,
      bestLapSeconds: carId === targetId ? 91.4 : 88.2 + index * 0.08,
    }]));
    weekend = { ...weekend, qualifyingLive: { ...weekend.qualifyingLive!, elapsedSeconds: 850, remainingSeconds: 230, cars: cutCars } };
    const attackPlan = qualifyingAiRunPlan(weekend, targetId)!;
    expect(attackPlan.priority).toBe("FINAL_ATTACK");
    expect(attackPlan.preferFreshTyre).toBe(true);
    expect(attackPlan.position).toBeGreaterThan(attackPlan.cutPosition!);
    expect(attackPlan.minimumReleaseGapSeconds).toBeLessThan(qualifyingReleaseForecast(weekend, targetId)!.targetGapSeconds);
  });

  it("releases a no-time AI car for its last viable attempt on a fresh set", () => {
    let weekend = createWeekendState(20_260_836, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const live = weekend.qualifyingLive!;
    const targetId = "mercedes-1";
    const cars = Object.fromEntries(Object.entries(live.cars).map(([carId, car], index) => [carId, {
      ...car,
      phase: "GARAGE" as const,
      completedRuns: 1,
      bestLapSeconds: carId === targetId ? null : 88.1 + index * 0.08,
    }]));
    weekend = { ...weekend, qualifyingLive: { ...live, elapsedSeconds: 850, remainingSeconds: 230, cars } };

    expect(qualifyingAiRunPlan(weekend, targetId)?.priority).toBe("FINAL_ATTACK");
    weekend = tickLiveQualifying(weekend, 1);

    const target = weekend.qualifyingLive!.cars[targetId];
    expect(target.phase).toBe("OUT_LAP");
    expect(["ATTACK", "MAXIMUM"]).toContain(target.attackMode);
    expect(target.selectedTyreSetId).not.toBeNull();
    expect(weekend.tyreInventory[targetId].find((set) => set.id === target.selectedTyreSetId)?.status).toBe("FITTED");
  });

  it("reduces the target release gap as the final Q1 traffic rush approaches", () => {
    let weekend = createWeekendState(20_260_824, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const earlyTarget = qualifyingReleaseForecast(weekend, "ferrari-1")!.targetGapSeconds;
    weekend = tickLiveQualifying(weekend, 900);
    expect(weekend.currentSession).toBe("Q1");
    const lateTarget = qualifyingReleaseForecast(weekend, "ferrari-1")!.targetGapSeconds;
    expect(lateTarget).toBeLessThan(earlyTarget);
    expect(lateTarget).toBeLessThanOrEqual(2.75);
  });

  it("queues AI cars at pit exit rather than releasing overlapping cars in one tick", () => {
    let weekend = createWeekendState(20_260_821, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    for (let second = 0; second < 950; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      if (weekend.currentSession !== "Q1") break;
      const pitExitCars = Object.values(weekend.qualifyingLive!.cars).filter((car) => (
        car.phase === "OUT_LAP" && qualifyingCarProgress(car) < 0.09
      ));
      expect(pitExitCars.length, `second ${second + 1}: ${pitExitCars.map((car) => car.carId).join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  it("gives a nearby flying car persistent priority until it passes and restores a safe gap", () => {
    let weekend = createWeekendState(20_260_825, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const live = weekend.qualifyingLive!;
    const yieldingCar = {
      ...live.cars["ferrari-1"],
      phase: "IN_LAP" as const,
      flyingLapsRemaining: 1,
      phaseStartProgress: 0,
      phaseDurationSeconds: 100,
      phaseRemainingSeconds: 50,
      currentSpeedKph: 165,
    };
    const flyingCar = {
      ...live.cars["ferrari-2"],
      phase: "PUSH_LAP" as const,
      phaseDurationSeconds: 100,
      phaseRemainingSeconds: 55,
      currentSpeedKph: 300,
    };
    const trafficLive = { ...live, cars: { "ferrari-1": yieldingCar, "ferrari-2": flyingCar } };
    const approach = qualifyingTrafficDecision(trafficLive, yieldingCar);
    expect(approach.yielding).toBe(true);
    expect(approach.yieldingToCarId).toBe("ferrari-2");
    expect(approach.approachingFlyingGapSeconds).toBeGreaterThan(3);
    expect(approach.approachingFlyingGapSeconds).toBeLessThan(5);

    const activelyYielding = {
      ...yieldingCar,
      yielding: true,
      yieldingToCarId: "ferrari-2",
      yieldingDurationSeconds: 6,
    };
    const justPassed = { ...flyingCar, phaseRemainingSeconds: 48.5 };
    const afterPass = qualifyingTrafficDecision({ ...trafficLive, cars: { "ferrari-1": activelyYielding, "ferrari-2": justPassed } }, activelyYielding);
    expect(afterPass.yieldingToCarId).toBe("ferrari-2");

    const safelyAhead = { ...flyingCar, phaseRemainingSeconds: 44 };
    const recovered = qualifyingTrafficDecision({ ...trafficLive, cars: { "ferrari-1": activelyYielding, "ferrari-2": safelyAhead } }, activelyYielding);
    expect(recovered.yielding).toBe(false);
    expect(recovered.yieldingToCarId).toBeNull();
    expect(recovered.yieldCooldownSeconds).toBe(5);

    const exhaustedYield = { ...activelyYielding, yieldingDurationSeconds: 22 };
    const guarded = qualifyingTrafficDecision({ ...trafficLive, cars: { "ferrari-1": exhaustedYield, "ferrari-2": flyingCar } }, exhaustedYield);
    expect(guarded.yielding).toBe(false);
    expect(guarded.yieldCooldownSeconds).toBe(5);
  });

  it("warns about an approaching flying car but lets the player make the manual release", () => {
    let weekend = createWeekendState(20_260_826, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    const live = weekend.qualifyingLive!;
    const flyingCar = {
      ...live.cars["ferrari-2"],
      phase: "PUSH_LAP" as const,
      phaseDurationSeconds: 100,
      phaseRemainingSeconds: 15.5,
      currentSpeedKph: 300,
    };
    weekend = { ...weekend, qualifyingLive: { ...live, cars: { ...live.cars, "ferrari-2": flyingCar } } };
    const forecast = qualifyingReleaseForecast(weekend, "ferrari-1")!;
    expect(forecast.nearestFlyingGapSeconds).not.toBeNull();
    expect(forecast.nearestFlyingGapSeconds!).toBeLessThan(3);
    expect(forecast.mergeSafe).toBe(false);
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].phase).toBe("OUT_LAP");
  });

  it("prevents a non-flying car from overtaking a flying car even when its stale speed is too high", () => {
    let weekend = createWeekendState(20_260_827, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const live = startLiveQualifying(weekend).qualifyingLive!;
    const outLapCar = {
      ...live.cars["ferrari-1"],
      phase: "OUT_LAP" as const,
      phaseDurationSeconds: 100,
      phaseRemainingSeconds: 49,
      currentSpeedKph: 330,
    };
    const flyingCar = {
      ...live.cars["ferrari-2"],
      phase: "PUSH_LAP" as const,
      phaseDurationSeconds: 100,
      phaseRemainingSeconds: 52.8,
      currentSpeedKph: 295,
    };
    const decision = qualifyingTrafficDecision({ ...live, cars: { "ferrari-1": outLapCar, "ferrari-2": flyingCar } }, outLapCar);
    expect(decision.gapAheadSeconds).toBeLessThan(1);
    expect(decision.spacingFactor).toBe(0.35);
  });

  it("keeps both flying cars running in a sub-one-second conflict and penalises the following lap", () => {
    let weekend = createWeekendState(20_260_828, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const live = weekend.qualifyingLive!;
    const following = {
      ...live.cars["ferrari-1"],
      phase: "PUSH_LAP" as const,
      phaseDurationSeconds: 90,
      phaseRemainingSeconds: 45,
      currentSpeedKph: 305,
      flyingConflictSeconds: 2,
      selectedTyreSetId: weekend.tyreInventory["ferrari-1"][0].id,
      timing: { ...live.cars["ferrari-1"].timing, currentLapCompetitive: true },
    };
    const ahead = {
      ...live.cars["ferrari-2"],
      phase: "PUSH_LAP" as const,
      phaseDurationSeconds: 90,
      phaseRemainingSeconds: 44.4,
      currentSpeedKph: 302,
      timing: { ...live.cars["ferrari-2"].timing, currentLapCompetitive: true, currentLapValid: true },
    };
    weekend = { ...weekend, qualifyingLive: { ...live, cars: { "ferrari-1": following, "ferrari-2": ahead } } };
    weekend = tickLiveQualifying(weekend, 1);
    expect(weekend.qualifyingLive!.cars["ferrari-1"]).toMatchObject({
      phase: "PUSH_LAP",
      trafficDecisionState: "TRAFFIC",
      trafficConflictCarId: "ferrari-2",
    });
    expect(weekend.qualifyingLive!.cars["ferrari-1"].trafficPenaltySeconds).toBeGreaterThanOrEqual(0.07);
    expect(weekend.qualifyingLive!.cars["ferrari-1"].flyingConflictSeconds).toBe(3);
    expect(weekend.qualifyingLive!.cars["ferrari-1"].bestLapSeconds).toBeNull();
    expect(weekend.qualifyingLive!.cars["ferrari-1"].lastRunNote).not.toBe("ABORTED");
  });

  it("warns when out-lap programmes converge but preserves the player's manual release", () => {
    let weekend = createWeekendState(20_260_838, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    const live = weekend.qualifyingLive!;
    const candidateStart = qualifyingReleaseForecast(weekend, "ferrari-1")!.flyingLapStartsInSeconds;
    const convergingOutLap = {
      ...live.cars["ferrari-2"],
      phase: "OUT_LAP" as const,
      phaseDurationSeconds: 200,
      phaseRemainingSeconds: candidateStart + 0.7,
      currentSpeedKph: 205,
    };
    weekend = { ...weekend, qualifyingLive: { ...live, cars: { ...live.cars, "ferrari-2": convergingOutLap } } };

    const forecast = qualifyingReleaseForecast(weekend, "ferrari-1")!;
    expect(forecast.nearestFlyingGapSeconds).toBeCloseTo(0.7, 3);
    expect(forecast.mergeSafe).toBe(false);
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].phase).toBe("OUT_LAP");
  });

  it("requires an exact tyre set, fits it once and preserves its wear into later qualifying", () => {
    let weekend = createWeekendState(20_260_829, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    const beforeRelease = weekend;
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend).toEqual(beforeRelease);

    const setId = weekend.tyreInventory["ferrari-1"].find((set) => set.compound === "SOFT" && set.status === "NEW")!.id;
    weekend = setQualifyingTyreSet(weekend, "ferrari-1", setId);
    expect(setQualifyingTyreSet(weekend, "ferrari-2", setId)).toEqual(weekend);
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend.tyreInventory["ferrari-1"].find((set) => set.id === setId)?.status).toBe("FITTED");
    for (let second = 0; second < 360 && weekend.qualifyingLive!.cars["ferrari-1"].phase !== "GARAGE"; second += 1) weekend = tickLiveQualifying(weekend, 1);
    const used = weekend.tyreInventory["ferrari-1"].find((set) => set.id === setId)!;
    expect(used.status).toBe("USED");
    expect(used.wearPercent).toBeGreaterThan(0);
    expect(used.lapsCompleted).toBe(1);
    expect(used.sessionHistory).toContain("Q1");
    expect(weekend.tyreInventory["ferrari-1"].filter((set) => set.compound === "WET" && set.status === "NEW")).toHaveLength(2);
  });

  it("does not consume a player tyre or invent a lap when qualifying is skipped from the garage", () => {
    let weekend = createWeekendState(20_260_830, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const firstSoftId = weekend.tyreInventory["ferrari-1"].find((set) => set.compound === "SOFT")!.id;
    weekend = skipLiveQualifyingSession(weekend);
    expect(weekend.currentSession).toBe("Q2");
    expect(weekend.tyreInventory["ferrari-1"].find((set) => set.id === firstSoftId)?.status).toBe("NEW");
    expect(weekend.tyreUsage["ferrari-1"].SOFT ?? 0).toBe(0);
    expect(weekend.results.find((result) => result.session === "Q1")?.entries.find((entry) => entry.carId === "ferrari-1")).toMatchObject({
      timedLap: false,
      eliminated: true,
    });
    expect(weekend.qualifying.find((record) => record.carId === "ferrari-1")).toMatchObject({ q1: null, eliminatedIn: "Q1" });
    expect(weekend.qualifyingLive?.cars["ferrari-1"]).toBeUndefined();
    weekend = skipLiveQualifyingSession(weekend);
    weekend = skipLiveQualifyingSession(weekend);
    expect(weekend.currentSession).toBe("RACE");
    const persisted = weekend.tyreInventory["ferrari-1"].find((set) => set.id === firstSoftId)!;
    expect(persisted.status).toBe("NEW");
    expect(persisted.sessionHistory).toEqual([]);
    expect(weekend.tyreUsage["ferrari-1"].SOFT ?? 0).toBe(0);
  });

  it("keeps a skipped player car alive only when it already set a valid segment time", () => {
    let weekend = createWeekendState(20_260_833, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    for (let second = 0; second < 360 && weekend.qualifyingLive?.cars["ferrari-1"].bestLapSeconds === null; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
    }
    expect(weekend.qualifyingLive?.cars["ferrari-1"].bestLapSeconds).not.toBeNull();

    weekend = skipLiveQualifyingSession(weekend);

    const q1Entry = weekend.results.find((result) => result.session === "Q1")?.entries.find((entry) => entry.carId === "ferrari-1");
    expect(q1Entry).toMatchObject({ timedLap: true, eliminated: false });
    expect(weekend.qualifyingLive?.cars["ferrari-1"]).toBeDefined();
    expect(weekend.qualifying.find((record) => record.carId === "ferrari-1")?.eliminatedIn).toBeNull();
  });

  it("reconciles a stale Q2 ready field and removes every Q1 non-qualifier before starting", () => {
    let weekend = createWeekendState(20_260_834, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    const staleQ1Cars = weekend.qualifyingLive!.cars;
    const q1Entrants = Object.keys(staleQ1Cars);
    const q1Qualifiers = q1Entrants.slice(0, 16);
    weekend = completeLiveQualifyingWithTimes(weekend, q1Qualifiers);
    expect(Object.keys(weekend.qualifyingLive!.cars)).toEqual(q1Qualifiers);

    weekend = {
      ...weekend,
      qualifyingLive: { ...weekend.qualifyingLive!, cars: staleQ1Cars },
    };
    expect(Object.keys(weekend.qualifyingLive!.cars)).toHaveLength(22);

    weekend = startLiveQualifying(weekend);

    expect(weekend.qualifyingLive?.status).toBe("RUNNING");
    expect(Object.keys(weekend.qualifyingLive!.cars)).toEqual(q1Qualifiers);
    for (const eliminatedId of q1Entrants.slice(16)) {
      expect(weekend.qualifyingLive?.cars[eliminatedId]).toBeUndefined();
      expect(weekend.qualifying.find((record) => record.carId === eliminatedId)?.eliminatedIn).toBe("Q1");
    }
  });

  it("can skip each qualifying segment and preserves its classification", () => {
    let weekend = createWeekendState(20_260_822, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    for (const session of ["Q1", "Q2", "Q3"] as const) {
      expect(weekend.currentSession).toBe(session);
      weekend = skipLiveQualifyingSession(weekend);
      expect(weekend.results.find((result) => result.session === session)).toBeDefined();
    }
    expect(weekend.currentSession).toBe("RACE");
    expect(weekend.gridOrder).toHaveLength(22);
    for (const carId of playerCarIdsFor("ferrari")) {
      expect(weekend.qualifying.find((record) => record.carId === carId)?.eliminatedIn).toBe("Q1");
    }
  });

  it("allows a late pit-wall gamble but does not start a flying lap after the chequered flag", () => {
    let weekend = createWeekendState(20_260_802, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    weekend = selectFreshTyre(weekend, "ferrari-1");
    const live = weekend.qualifyingLive!;
    weekend = { ...weekend, qualifyingLive: { ...live, remainingSeconds: 90 } };
    const forecast = qualifyingReleaseForecast(weekend, "ferrari-1")!;
    expect(forecast.canFinishBeforeChequered).toBe(false);
    weekend = releaseQualifyingCar(weekend, "ferrari-1");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].phase).toBe("OUT_LAP");
    weekend = tickLiveQualifying(weekend, 90);
    expect(weekend.qualifyingLive?.status).toBe("CHECKERED");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].bestLapSeconds).toBeNull();
    weekend = tickLiveQualifying(weekend, 30);
    expect(weekend.qualifyingLive?.cars["ferrari-1"].phase).not.toBe("PUSH_LAP");
    expect(weekend.qualifyingLive?.cars["ferrari-1"].bestLapSeconds).toBeNull();
    const deleted = {
      ...weekend.qualifyingLive!.cars["ferrari-1"],
      phase: "IN_LAP" as const,
      lastRunNote: "TRACK LIMITS" as const,
    };
    expect(qualifyingDisplayStatus(deleted)).toBe("LAP DELETED");
  });

  it("can complete Q1, Q2 and Q3 through the live engine and build the full race grid", () => {
    let weekend = createWeekendState(20_260_721, "williams");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    for (const expectedSession of ["Q1", "Q2", "Q3"] as const) {
      expect(weekend.currentSession).toBe(expectedSession);
      weekend = startLiveQualifying(weekend);
      weekend = tickLiveQualifying(weekend, 1_500);
    }
    expect(weekend.currentSession).toBe("RACE");
    expect(weekend.results.find((result) => result.session === "Q1")?.entries).toHaveLength(22);
    expect(weekend.results.find((result) => result.session === "Q2")?.entries).toHaveLength(16);
    expect(weekend.results.find((result) => result.session === "Q3")?.entries).toHaveLength(10);
    expect(weekend.gridOrder).toHaveLength(22);
    expect(new Set(weekend.gridOrder)).toEqual(new Set(DRIVERS.map((driver) => driver.id)));
  });
});
