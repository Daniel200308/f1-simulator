import { describe, expect, it } from "vitest";

import { damageScenarioDurationSeconds, damageScenarioEngineerCall, damageScenarioLabel, selectDamageScenario } from "@/simulation/damage-response";

describe("damage response scenarios", () => {
  it("selects every supported response from deterministic roll bands", () => {
    expect(selectDamageScenario(0.1, 0.7)).toBe("STOP_AND_REJOIN");
    expect(selectDamageScenario(0.3, 0.7)).toBe("STOP_AND_RETIRE");
    expect(selectDamageScenario(0.55, 0.7)).toBe("CONTINUE_SLOW");
    expect(selectDamageScenario(0.9, 0.7)).toBe("PIT_AND_RETIRE");
  });

  it("gives stop and pit responses finite deterministic action windows", () => {
    expect(damageScenarioDurationSeconds("STOP_AND_REJOIN", 0.5)).toBeCloseTo(4.6);
    expect(damageScenarioDurationSeconds("STOP_AND_RETIRE", 0.5)).toBeCloseTo(3.6);
    expect(damageScenarioDurationSeconds("PIT_AND_RETIRE", 0.5)).toBeCloseTo(23);
    expect(damageScenarioDurationSeconds("CONTINUE_SLOW", 0.5)).toBe(0);
  });

  it("exposes a clear radio response for each scenario", () => {
    for (const scenario of ["CONTINUE_SLOW", "STOP_AND_REJOIN", "STOP_AND_RETIRE", "PIT_AND_RETIRE"] as const) {
      expect(damageScenarioLabel(scenario)).toContain(scenario === "CONTINUE_SLOW" ? "CONTINUE" : scenario === "PIT_AND_RETIRE" ? "BOX" : "STOPPED");
      expect(damageScenarioEngineerCall(scenario).length).toBeGreaterThan(20);
    }
  });
});
