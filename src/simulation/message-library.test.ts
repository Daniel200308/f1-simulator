import { describe, expect, it } from "vitest";

import {
  buildRaceDriverRadio,
  buildSessionDriverMessage,
  RACE_DRIVER_RADIO_VARIANT_CAPACITY,
  SESSION_DEBRIEF_VARIANT_CAPACITY,
  type RaceRadioSituation,
} from "@/simulation/message-library";

describe("motorsport message library", () => {
  it("provides well over the requested debrief variation capacity", () => {
    expect(SESSION_DEBRIEF_VARIANT_CAPACITY).toBeGreaterThanOrEqual(100);
    const driverMessages = new Set<string>();
    for (let seed = 1; seed <= 160; seed += 1) {
      const context = {
        seed,
        carIndex: seed % 22,
        sessionIndex: seed % 6,
        session: seed % 2 ? "FP2" : "Q2",
        phase: seed % 2 ? "PRACTICE" as const : "QUALIFYING" as const,
        outcome: seed % 3 ? "COMPLETE" as const : "ADVANCED" as const,
        driverShortName: "DRV",
        position: seed % 22 + 1,
        laps: 16 + seed % 14,
        gapSeconds: (seed % 19) / 10,
        balanceIssue: seed % 2 ? "high-speed understeer" : "rear instability over kerbs",
        tyreConditionPercent: 45 + seed % 50,
        aeroBalancePercent: 55 + seed % 45,
        mechanicalBalancePercent: 52 + seed % 48,
        thermalMarginPercent: 58 + seed % 42,
        bestLapSeconds: 88 + (seed % 200) / 100,
      };
      driverMessages.add(buildSessionDriverMessage(context));
    }
    expect(driverMessages.size).toBeGreaterThanOrEqual(100);
    expect([...driverMessages].every((message) => message.length < 330)).toBe(true);
    expect([...driverMessages].join(" ")).not.toMatch(/Aero \d+%|mechanical \d+%|thermal margin \d+%/);
  });

  it("changes the setup conversation with the dominant vehicle state", () => {
    const base = {
      seed: 20260715,
      carIndex: 1,
      sessionIndex: 1,
      session: "FP2",
      phase: "PRACTICE" as const,
      outcome: "COMPLETE" as const,
      driverShortName: "DRV",
      position: 7,
      laps: 24,
      gapSeconds: 0.724,
      tyreConditionPercent: 71,
      aeroBalancePercent: 60,
      mechanicalBalancePercent: 70,
      thermalMarginPercent: 45,
      bestLapSeconds: 89.5,
    };
    const front = buildSessionDriverMessage({ ...base, balanceIssue: "high-speed understeer" });
    const cooling = buildSessionDriverMessage({ ...base, balanceIssue: "restricted cooling margin" });
    expect(front).not.toBe(cooling);
    expect(front).toMatch(/front|steering|rotation|corner/i);
    expect(cooling).toMatch(/thermal|temperature|heat|protection|hot/i);
  });

  it("gives qualifying drivers emotional, result-aware reactions without losing the car complaint", () => {
    const base = {
      seed: 20_260_729,
      carIndex: 3,
      sessionIndex: 4,
      session: "Q2",
      phase: "QUALIFYING" as const,
      driverShortName: "DRV",
      laps: 6,
      gapSeconds: 0.641,
      balanceIssue: "rear instability over kerbs",
      tyreConditionPercent: 82,
      aeroBalancePercent: 78,
      mechanicalBalancePercent: 64,
      thermalMarginPercent: 88,
      bestLapSeconds: 88.5,
    };
    const advanced = buildSessionDriverMessage({ ...base, outcome: "ADVANCED" as const, position: 8 });
    const eliminated = buildSessionDriverMessage({ ...base, outcome: "ELIMINATED" as const, position: 17 });
    const noTime = buildSessionDriverMessage({ ...base, outcome: "ELIMINATED" as const, position: null, bestLapSeconds: null, laps: 0 });

    expect(advanced).toMatch(/through|delivered|happy|proper|relieved|earned|satisfying|got it|come on/i);
    expect(eliminated).toMatch(/out|frustrat|angry|gutted|pain|hurt|rubbish|disappointed|hate|stings/i);
    expect(noTime).toMatch(/no time|no lap|never|disaster|furious|chaos/i);
    expect(`${advanced} ${eliminated} ${noTime}`).toMatch(/rear|kerb|rotation|traction|correction|instability/i);
    expect([advanced, eliminated, noTime].every((message) => message.length < 330)).toBe(true);
  });

  it("provides more than 100 distinct contextual driver-radio lines", () => {
    expect(RACE_DRIVER_RADIO_VARIANT_CAPACITY).toBeGreaterThanOrEqual(100);
    const situations: RaceRadioSituation[] = ["TYRE_WEAR", "TYRE_HOT", "TYRE_COLD", "ATTACK_ENERGY", "ATTACK_TYRE", "DIRTY_AIR", "BALANCE", "DEFENDING", "STABLE", "RAIN_STARTING", "RAIN_RUNNING", "WET_GRIP", "LOW_GRIP", "BRAKING_LOCKUP", "REAR_SNAP", "SPRAY_VISIBILITY", "SPIN_RECOVERY", "AQUAPLANING", "DRYING_LINE", "INTER_CROSSOVER"];
    const messages = new Set<string>();
    for (let tick = 1; tick <= 240; tick += 1) {
      messages.add(buildRaceDriverRadio({ seed: 20_260_715, tick, carIndex: tick % 22, situation: situations[tick % situations.length], metric: `sample ${tick % 37}` }));
    }
    expect(messages.size).toBeGreaterThanOrEqual(100);
  });

  it("provides more than 100 colloquial weather reports tied to changing track conditions", () => {
    const situations: RaceRadioSituation[] = ["RAIN_STARTING", "RAIN_RUNNING", "WET_GRIP", "LOW_GRIP", "BRAKING_LOCKUP", "REAR_SNAP", "SPRAY_VISIBILITY", "SPIN_RECOVERY", "AQUAPLANING", "DRYING_LINE", "INTER_CROSSOVER"];
    const messages = new Set<string>();
    for (let tick = 1; tick <= 220; tick += 1) {
      messages.add(buildRaceDriverRadio({
        seed: 20_260_715 + tick,
        tick,
        carIndex: tick % 22,
        situation: situations[tick % situations.length],
        metric: `sector ${tick % 3 + 1}`,
      }));
    }
    expect(messages.size).toBeGreaterThanOrEqual(100);
    expect([...messages].every((message) => message.length < 300)).toBe(true);
    expect([...messages].join(" ")).toMatch(/rain|water|wet|dry|grip|crossover/i);
  });
});
