import { describe, expect, it } from "vitest";

import { F1_2026_DRIVER_POWER, season2026PowerQualifyingPenaltySeconds, season2026RawQualifyingPenaltySeconds } from "@/fixtures/season-2026-performance";
import {
  createWeekendState,
  runWeekendSession,
  startLiveQualifying,
  tickLiveQualifying,
} from "@/simulation/weekend";

const TOP_TIER = new Set(F1_2026_DRIVER_POWER
  .filter(({ carId }) => season2026RawQualifyingPenaltySeconds(carId) <= 0.86)
  .map(({ carId }) => carId));
const LOWER_TIER = new Set(F1_2026_DRIVER_POWER
  .filter(({ carId, teamId }) => teamId !== "cadillac" && season2026PowerQualifyingPenaltySeconds(carId) >= 1.5)
  .map(({ carId }) => carId));

function runLiveQualifying(seed: number) {
  let weekend = createWeekendState(seed, "cadillac");
  weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
  for (const duration of [1_500, 1_250, 1_100]) {
    weekend = startLiveQualifying(weekend);
    weekend = tickLiveQualifying(weekend, duration);
  }
  return weekend;
}

describe("qualifying performance calibration", () => {
  it("caps live traffic loss and reports the obstruction on the completed lap", () => {
    let weekend = createWeekendState(20_260_712, "cadillac");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);
    let maximumTrafficLoss = 0;
    let trafficLapReported = false;
    for (let second = 0; second < 1_100 && weekend.currentSession === "Q1"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      for (const car of Object.values(weekend.qualifyingLive?.cars ?? {})) {
        maximumTrafficLoss = Math.max(maximumTrafficLoss, car.trafficPenaltySeconds);
        if (car.completedRuns > 0 && car.lastRunNote === "TRAFFIC") trafficLapReported = true;
      }
    }
    expect(maximumTrafficLoss).toBeGreaterThanOrEqual(0.12);
    expect(maximumTrafficLoss).toBeLessThanOrEqual(1.65);
    expect(trafficLapReported).toBe(true);
  });

  it("keeps lower-tier cars out of routine top positions across fixed live seeds", () => {
    const seeds = [20_260_712, ...Array.from({ length: 23 }, (_, index) => 20_261_001 + index * 37)];
    let topPositionTotal = 0;
    let topEntries = 0;
    let topEliminations = 0;
    let lowerPositionTotal = 0;
    let lowerEntries = 0;
    let lowerPoles = 0;
    let topPoles = 0;
    let lowerQ3Seats = 0;
    let audiPoles = 0;
    let audiQ3Seats = 0;
    let verstappenQ3 = 0;

    for (const seed of seeds) {
      const weekend = runLiveQualifying(seed);
      const q1 = weekend.results.find((result) => result.session === "Q1")!;
      const q3 = weekend.results.find((result) => result.session === "Q3")!;
      if (TOP_TIER.has(q3.entries[0].carId)) topPoles += 1;
      if (LOWER_TIER.has(q3.entries[0].carId)) lowerPoles += 1;
      if (q3.entries[0].carId.startsWith("audi-")) audiPoles += 1;
      audiQ3Seats += q3.entries.filter((entry) => entry.carId.startsWith("audi-")).length;
      if (q3.entries.some((entry) => entry.carId === "red-bull-1")) verstappenQ3 += 1;
      lowerQ3Seats += q3.entries.filter((entry) => LOWER_TIER.has(entry.carId)).length;
      for (const entry of q1.entries) {
        if (TOP_TIER.has(entry.carId)) {
          topPositionTotal += entry.position;
          topEntries += 1;
          if (entry.eliminated) topEliminations += 1;
        }
        if (LOWER_TIER.has(entry.carId)) {
          lowerPositionTotal += entry.position;
          lowerEntries += 1;
        }
      }
    }

    const topAveragePosition = topPositionTotal / topEntries;
    const lowerAveragePosition = lowerPositionTotal / lowerEntries;
    expect(topAveragePosition).toBeLessThan(7.5);
    expect(lowerAveragePosition).toBeGreaterThan(14.5);
    expect(lowerAveragePosition - topAveragePosition).toBeGreaterThan(8);
    expect(topEliminations / topEntries).toBeLessThanOrEqual(0.05);
    expect(topPoles / seeds.length).toBeGreaterThanOrEqual(0.8);
    expect(lowerPoles).toBe(0);
    expect(lowerQ3Seats / (seeds.length * 10)).toBeLessThanOrEqual(0.22);
    expect(audiPoles).toBe(0);
    expect(audiQ3Seats / (seeds.length * 2)).toBeLessThanOrEqual(0.4);
    expect(verstappenQ3 / seeds.length).toBeGreaterThanOrEqual(0.75);
    /*
     * 24 seeds of full live qualifying is genuinely heavy, and the budget has to
     * hold when the whole suite runs in parallel rather than this file alone.
     */
  }, 30_000);
});
