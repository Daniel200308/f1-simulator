import { describe, expect, it } from "vitest";

import type { RaceSnapshot } from "@/domain/race";
import { criticalRaceControlTransition } from "@/simulation/race-control-transitions";

type ControlView = Pick<RaceSnapshot, "raceControl" | "yellowSector" | "safetyCarPhase">;

const green: ControlView = { raceControl: "GREEN", yellowSector: null, safetyCarPhase: "NONE" };

describe("criticalRaceControlTransition", () => {
  it("stops for local yellow, VSC and safety car deployment", () => {
    expect(criticalRaceControlTransition(green, { raceControl: "YELLOW", yellowSector: 2, safetyCarPhase: "NONE" }))
      .toBe("LOCAL YELLOW · SECTOR 2");
    expect(criticalRaceControlTransition(green, { raceControl: "VSC", yellowSector: 1, safetyCarPhase: "NONE" }))
      .toBe("VIRTUAL SAFETY CAR DEPLOYED");
    expect(criticalRaceControlTransition(green, { raceControl: "SAFETY_CAR", yellowSector: 3, safetyCarPhase: "DEPLOYED" }))
      .toBe("SAFETY CAR DEPLOYED");
  });

  it("stops when the safety car enters its restart phase", () => {
    const bunching: ControlView = { raceControl: "SAFETY_CAR", yellowSector: 3, safetyCarPhase: "BUNCHING" };
    const restart: ControlView = { ...bunching, safetyCarPhase: "RESTART" };
    expect(criticalRaceControlTransition(bunching, restart)).toBe("SC ENDING · LEADER CONTROLS RESTART");
  });

  it("stops when a new incident redeploys an active safety car", () => {
    expect(criticalRaceControlTransition(
      { raceControl: "SAFETY_CAR", yellowSector: 2, safetyCarPhase: "RESTART" },
      { raceControl: "SAFETY_CAR", yellowSector: 3, safetyCarPhase: "DEPLOYED" },
    )).toBe("SAFETY CAR REDEPLOYED");
  });

  it("does not interrupt steady control or the return to green", () => {
    expect(criticalRaceControlTransition(green, green)).toBeNull();
    expect(criticalRaceControlTransition(
      { raceControl: "VSC", yellowSector: 1, safetyCarPhase: "NONE" },
      green,
    )).toBeNull();
  });
});
