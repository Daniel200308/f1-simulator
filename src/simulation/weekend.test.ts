import { describe, expect, it } from "vitest";

import { DRIVERS, PLAYER_CAR_IDS, playerCarIdsFor, TEAMS } from "@/fixtures/grid";
import { createWeekendState, runWeekendSession, setWeekendCarSetup, setupFeedbackFor, setupRecommendationFor, STANDARD_WEEKEND_RULES } from "@/simulation/weekend";

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
    expect(weekend.tyreUsage[DRIVERS[0].id]).toMatchObject({ HARD: 1, MEDIUM: 1, SOFT: 2 });
  });

  it("is deterministic and clamps player setup ranges", () => {
    const carId = DRIVERS[0].id;
    const initial = createWeekendState(77);
    const configured = setWeekendCarSetup(initial, carId, { frontWing: 99, suspension: -3, cooling: 8 });
    expect(configured.setups[carId]).toEqual({ frontWing: 10, rearWing: 7, suspension: 1, rideHeight: 6, differential: 6, cooling: 5 });
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
    expect(afterFp1.maximum - afterFp1.minimum).toBeGreaterThan(afterFp2.maximum - afterFp2.minimum);
    expect(afterFp2.maximum - afterFp2.minimum).toBeGreaterThan(afterFp3.maximum - afterFp3.minimum);
    expect([afterFp1.sourceSession, afterFp2.sourceSession, afterFp3.sourceSession]).toEqual(["FP1", "FP2", "FP3"]);
  });

  it("does not gift both player cars the front row on the untouched baseline", () => {
    let weekend = createWeekendState(20_260_712);
    for (let index = 0; index < 6; index += 1) weekend = runWeekendSession(weekend);
    const playerGridPositions = PLAYER_CAR_IDS.map((carId) => weekend.gridOrder.indexOf(carId) + 1);
    expect(playerGridPositions.filter((position) => position <= 2)).toHaveLength(0);
  });

  it("creates a two-car driver and engineer debrief after every practice and qualifying session", () => {
    let weekend = createWeekendState(20_260_712, "ferrari");
    for (let index = 0; index < 6; index += 1) weekend = runWeekendSession(weekend);

    expect(weekend.sessionReports.map((report) => report.session)).toEqual(["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"]);
    for (const report of weekend.sessionReports) {
      expect(report.cars.map((car) => car.carId)).toEqual(playerCarIdsFor("ferrari"));
      expect(report.summary.length).toBeGreaterThan(20);
      for (const car of report.cars) {
        expect(car.driverMessage.length).toBeGreaterThan(30);
        expect(car.engineerMessage.length).toBeGreaterThan(30);
        expect(car.driverMessage.length).toBeLessThan(330);
        expect(car.engineerMessage.length).toBeLessThan(390);
        expect(car.engineerMessage).not.toMatch(/Aero \d+%|mechanical \d+%|thermal margin \d+%/);
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
    expect(weekend.setups["mclaren-1"]).toEqual({ frontWing: 5, rearWing: 6, suspension: 6, rideHeight: 5, differential: 5, cooling: 2 });
    expect(weekend.setups["mclaren-2"]).toEqual({ frontWing: 6, rearWing: 5, suspension: 4, rideHeight: 6, differential: 7, cooling: 4 });
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
});
