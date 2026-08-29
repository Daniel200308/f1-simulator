import { describe, expect, it } from "vitest";
import { buildRaceDriverRadio, type RaceRadioSituation } from "@/simulation/message-library";

const SITUATIONS: readonly RaceRadioSituation[] = [
  "TYRE_WEAR", "TYRE_HOT", "TYRE_COLD", "ATTACK_ENERGY", "ATTACK_TYRE", "DIRTY_AIR",
  "BALANCE", "DEFENDING", "STABLE", "RAIN_STARTING", "RAIN_INTENSIFYING", "RAIN_EASING",
  "LOCAL_SHOWER", "RAIN_RUNNING", "WET_GRIP", "AQUAPLANING", "DRYING_LINE", "INTER_CROSSOVER",
  "SLOW_CAR_AHEAD", "BLOCKED_ANGRY", "STRATEGY_DOUBT", "STRATEGY_APPROVAL", "PIT_CALL_LATE",
  "TRAFFIC_FRUSTRATION", "FIRST_DROPS", "CAR_HAPPY", "PACE_COMPLAINT", "POSITION_LOST",
  "POSITION_GAINED", "FINAL_LAPS_PUSH",
];

describe("driver radio situations", () => {
  it("produces a considered line and a short outburst for every situation", () => {
    for (const situation of SITUATIONS) {
      const measured = buildRaceDriverRadio({ seed: 5_001, tick: 12, carIndex: 3, situation, metric: "test metric" });
      const urgent = buildRaceDriverRadio({ seed: 5_001, tick: 12, carIndex: 3, situation, intensity: "HIGH" });

      expect(measured.length, situation).toBeGreaterThan(20);
      expect(measured, situation).toContain("test metric");
      // An outburst is a clipped reaction, not a paragraph.
      expect(urgent.length, situation).toBeGreaterThan(3);
      expect(urgent.length, situation).toBeLessThan(45);
      expect(urgent, situation).not.toContain("test metric");
    }
  });

  it("varies the wording across drivers and time", () => {
    for (const situation of SITUATIONS) {
      const variants = new Set<string>();
      for (let carIndex = 0; carIndex < 6; carIndex += 1) {
        for (let tick = 0; tick < 8; tick += 1) {
          variants.add(buildRaceDriverRadio({ seed: 77, tick, carIndex, situation, intensity: "HIGH" }));
        }
      }
      // Every situation must have several distinct calls so it does not repeat.
      expect(variants.size, situation).toBeGreaterThanOrEqual(3);
    }
  });

  it("covers frustration, approval and weather-feel situations", () => {
    const frustration = buildRaceDriverRadio({ seed: 9, tick: 1, carIndex: 0, situation: "SLOW_CAR_AHEAD", intensity: "HIGH" });
    const approval = buildRaceDriverRadio({ seed: 9, tick: 1, carIndex: 0, situation: "STRATEGY_APPROVAL", intensity: "HIGH" });
    const drops = buildRaceDriverRadio({ seed: 9, tick: 1, carIndex: 0, situation: "FIRST_DROPS", intensity: "HIGH" });

    expect(frustration).toBeTruthy();
    expect(approval).toBeTruthy();
    expect(drops).toBeTruthy();
    expect(new Set([frustration, approval, drops]).size).toBe(3);
  });
});
