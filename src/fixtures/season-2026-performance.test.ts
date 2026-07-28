import { describe, expect, it } from "vitest";

import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import {
  F1_2026_DRIVER_POWER,
  F1_2026_DRIVER_STANDINGS,
  F1_2026_PERFORMANCE_SNAPSHOT,
  F1_2026_POWER_SCALING_SNAPSHOT,
  F1_2026_TEAM_POWER,
  F1_2026_TEAM_STANDINGS,
  season2026DriverConsistency,
  season2026DriverPace,
  season2026FormAdjustmentSeconds,
  season2026PowerQualifyingPenaltySeconds,
  season2026QualifyingPenaltySeconds,
  season2026RawQualifyingPenaltySeconds,
  season2026TeamPerformance,
} from "@/fixtures/season-2026-performance";

describe("2026 season performance snapshot", () => {
  it("contains the complete official field after the Belgian Grand Prix", () => {
    expect(F1_2026_PERFORMANCE_SNAPSHOT).toMatchObject({ asOf: "2026-07-20", completedRound: 10 });
    expect(F1_2026_DRIVER_STANDINGS).toHaveLength(22);
    expect(F1_2026_TEAM_STANDINGS).toHaveLength(11);
    expect(F1_2026_DRIVER_STANDINGS.slice(0, 4).map(({ shortName, points }) => [shortName, points])).toEqual([
      ["ANT", 204], ["HAM", 159], ["RUS", 154], ["LEC", 126],
    ]);
    expect(F1_2026_TEAM_STANDINGS.slice(0, 4).map(({ teamId, points }) => [teamId, points])).toEqual([
      ["mercedes", 358], ["ferrari", 285], ["mclaren", 195], ["red-bull", 151],
    ]);
  });

  it("captures the complete user-supplied power, speed and risk table", () => {
    expect(F1_2026_POWER_SCALING_SNAPSHOT.name).toContain("GenX V1.41");
    expect(F1_2026_TEAM_POWER.map(({ teamId, carPower }) => [teamId, carPower])).toEqual([
      ["mercedes", 10], ["ferrari", 10], ["mclaren", 10], ["red-bull", 9], ["williams", 8],
      ["alpine", 9], ["racing-bulls", 8], ["audi", 9], ["haas", 7], ["aston-martin", 6], ["cadillac", 6],
    ]);
    expect(F1_2026_DRIVER_POWER.map(({ shortName, speed, risk }) => [shortName, speed, risk])).toEqual([
      ["RUS", 10, 9], ["ANT", 10, 6], ["LEC", 9, 9], ["HAM", 8, 4], ["NOR", 10, 8], ["PIA", 10, 7],
      ["VER", 10, 9], ["HAD", 7, 7], ["GAS", 7, 6], ["COL", 6, 7], ["LAW", 8, 8], ["LIN", 6, 8],
      ["OCO", 8, 7], ["BEA", 8, 6], ["SAI", 7, 5], ["ALB", 7, 8], ["HUL", 8, 8], ["BOR", 9, 7],
      ["ALO", 6, 8], ["STR", 4, 4], ["PER", 10, 8], ["BOT", 5, 3],
    ]);
  });

  it("maps the table to bounded race pace without turning risk into speed", () => {
    const teamRatings = F1_2026_TEAM_POWER.map(({ teamId }) => season2026TeamPerformance(teamId));
    const driverRatings = F1_2026_DRIVER_POWER.map(({ shortName }) => season2026DriverPace(shortName));
    expect(Math.max(...teamRatings) - Math.min(...teamRatings)).toBeCloseTo(0.02, 6);
    expect(Math.max(...driverRatings) - Math.min(...driverRatings)).toBeCloseTo(0.012, 6);
    expect(TEAM_BY_ID.get("mercedes")!.performance).toBe(TEAM_BY_ID.get("ferrari")!.performance);
    expect(TEAM_BY_ID.get("ferrari")!.performance).toBe(TEAM_BY_ID.get("mclaren")!.performance);
    expect(DRIVER_BY_ID.get("mercedes-1")!.pace).toBe(DRIVER_BY_ID.get("mercedes-2")!.pace);
    expect(DRIVER_BY_ID.get("mercedes-1")!.risk).toBeGreaterThan(DRIVER_BY_ID.get("mercedes-2")!.risk);
    expect(season2026DriverConsistency("RUS")).toBeLessThan(season2026DriverConsistency("ANT"));
    expect(DRIVER_BY_ID.get("cadillac-1")!.pace).toBeGreaterThan(DRIVER_BY_ID.get("cadillac-2")!.pace);
  });

  it("creates meaningful qualifying tiers and compresses only the front bands", () => {
    const raw = Object.fromEntries(F1_2026_DRIVER_POWER.map(({ shortName, carId }) => [shortName, season2026PowerQualifyingPenaltySeconds(carId)]));
    const expected = {
      RUS: 0, ANT: 0, LEC: 0.18, HAM: 0.36, NOR: 0, PIA: 0, VER: 0.5, BOR: 0.68, HUL: 0.86,
      HAD: 1.04, GAS: 1.04, COL: 1.22, LAW: 1.36, LIN: 1.72, SAI: 1.54, ALB: 1.54,
      OCO: 1.86, BEA: 1.86, PER: 2, ALO: 2.72, BOT: 2.9, STR: 3.08,
    } as const;
    for (const [shortName, penalty] of Object.entries(expected)) {
      expect(raw[shortName], shortName).toBeCloseTo(penalty, 6);
    }

    const verstappen = season2026RawQualifyingPenaltySeconds("red-bull-1");
    const bortoleto = season2026RawQualifyingPenaltySeconds("audi-2");
    const hulkenberg = season2026RawQualifyingPenaltySeconds("audi-1");
    expect(season2026FormAdjustmentSeconds("mercedes-2")).toBeCloseTo(0, 6);
    expect(season2026FormAdjustmentSeconds("audi-2")).toBeGreaterThan(season2026FormAdjustmentSeconds("red-bull-1"));
    expect(bortoleto - verstappen).toBeGreaterThan(0.4);
    expect(hulkenberg - verstappen).toBeGreaterThan(0.6);
    expect(season2026QualifyingPenaltySeconds("red-bull-1", "Q3")).toBeCloseTo(verstappen * 0.92, 6);
    expect(season2026QualifyingPenaltySeconds("audi-2", "Q3")).toBeCloseTo(bortoleto, 6);
    expect(season2026QualifyingPenaltySeconds("audi-1", "Q3")).toBeCloseTo(hulkenberg, 6);
  });
});
