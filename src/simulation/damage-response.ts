import type { DamageScenario } from "@/domain/race";

/**
 * A damaged car does not have one universal outcome. The response is selected
 * once when the damage is created and then carried by the car through the
 * worker/save snapshots, so a fast simulation cannot reroll the decision.
 */
export function selectDamageScenario(roll: number, damageLevel: number): DamageScenario {
  const normalizedRoll = clamp(roll, 0, 0.999_999);
  const severityBias = clamp((damageLevel - 0.55) / 0.45, 0, 1);
  if (normalizedRoll < 0.18) return "STOP_AND_REJOIN";
  if (normalizedRoll < 0.36 + severityBias * 0.22) return "STOP_AND_RETIRE";
  if (normalizedRoll < 0.74 - severityBias * 0.08) return "CONTINUE_SLOW";
  return "PIT_AND_RETIRE";
}

/** Seconds before the selected response is executed. */
export function damageScenarioDurationSeconds(scenario: DamageScenario, roll: number): number {
  const normalizedRoll = clamp(roll, 0, 1);
  switch (scenario) {
    case "STOP_AND_REJOIN": return 3.2 + normalizedRoll * 2.8;
    case "STOP_AND_RETIRE": return 2.4 + normalizedRoll * 2.4;
    case "PIT_AND_RETIRE": return 14 + normalizedRoll * 18;
    case "CONTINUE_SLOW": return 0;
  }
}

export function damageScenarioLabel(scenario: DamageScenario): string {
  switch (scenario) {
    case "STOP_AND_REJOIN": return "STOPPED · REJOINING";
    case "STOP_AND_RETIRE": return "STOPPED · RETIREMENT";
    case "PIT_AND_RETIRE": return "BOX · RETIREMENT";
    case "CONTINUE_SLOW": return "CONTINUE · REDUCED PACE";
  }
}

export function damageScenarioEngineerCall(scenario: DamageScenario): string {
  switch (scenario) {
    case "STOP_AND_REJOIN": return "Stop safely off line. We will check the car, then rejoin only when the gap is clear.";
    case "STOP_AND_RETIRE": return "Stop the car safely. The damage is terminal; we are retiring the car.";
    case "PIT_AND_RETIRE": return "The damage is deteriorating. Box when the entry opens; we will retire the car in the garage.";
    case "CONTINUE_SLOW": return "Damage is manageable. Stay out at reduced pace and report if the car gets worse.";
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
