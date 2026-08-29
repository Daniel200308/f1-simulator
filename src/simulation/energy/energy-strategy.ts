import type { EnergyDeploymentMode, EnergyManagementContext, EnergySystemState } from "@/domain/energy";

export interface EnergyAiDecision {
  mode: EnergyDeploymentMode;
  utility: number;
  reason: string;
}

interface Candidate extends EnergyAiDecision {
  tieBreak: number;
}

function candidate(mode: EnergyDeploymentMode, utility: number, reason: string, tieBreak: number): Candidate {
  return { mode, utility, reason, tieBreak };
}

/** Deterministic utility controller shared by every non-player car. */
export function chooseAiEnergyMode(state: EnergySystemState, context: EnergyManagementContext): EnergyAiDecision {
  const finalLap = context.lapNumber >= context.totalLaps;
  const lowSoc = state.stateOfCharge < 0.2;
  const belowTarget = state.predictedSocAtLapEnd < state.targetSocAtLapEnd - 0.055;
  const hot = state.thermalBand === "HOT" || state.thermalBand === "CRITICAL";
  const longStraight = context.currentSegmentType === "STRAIGHT" && context.segmentLength >= 180;
  const attackWindow = context.gapAheadSeconds !== null && context.gapAheadSeconds > 0 && context.gapAheadSeconds <= 1.15;
  const defenceWindow = context.gapBehindSeconds !== null && context.gapBehindSeconds > 0 && context.gapBehindSeconds <= 1.05;
  const neutralised = context.safetyCarActive || context.virtualSafetyCarActive;

  if (context.sessionType === "QUALIFYING") {
    const rechargeLapWindow = context.lapProgress < 0.16 || context.lapProgress > 0.94;
    if (rechargeLapWindow || lowSoc || hot) {
      return { mode: "CONSERVE", utility: 100, reason: rechargeLapWindow ? "Qualifying out/in lap recovery programme" : "Protect the flying-lap energy reserve" };
    }
    // A flying lap always runs the tightest usage level; the automatic pattern
    // still decides where on the lap that energy actually goes.
    return { mode: "ATTACK", utility: 100, reason: "Qualifying flying lap deployment map" };
  }

  /*
   * Every car runs the same automatic pattern: deploy on the straights, harvest
   * through the corners. What the strategist picks is only how hard that pattern
   * leans on the battery, so the AI chooses from the same three usage levels the
   * player has. OVERTAKE remains separate because it is the discrete passing
   * boost rather than a usage level.
   */
  const candidates: Candidate[] = [
    // Balanced is the resting state: a car with charge in hand races rather than
    // banking energy it has no plan for.
    candidate("BALANCED", 52 + state.stateOfCharge * 12, "Match deployment to recovery lap by lap", 2),
    candidate(
      "CONSERVE",
      26 + (belowTarget ? 26 : 0) + (hot ? 22 : 0) + (lowSoc ? 70 : 0) + (neutralised ? 82 : 0),
      lowSoc ? "State of charge is below the usable reserve"
        : neutralised ? "Neutralised lap offers low-cost recovery"
          : hot ? "Reduce electrical thermal load" : "Rebuild the lap-end target",
      1,
    ),
    candidate(
      "ATTACK",
      25 + (attackWindow ? 43 : 0) + (defenceWindow && longStraight ? 38 : 0)
      + context.driverAttackIntent * 18 + context.driverDefenceIntent * 12 + (finalLap ? 28 : 0)
      - (belowTarget ? 28 : 0) - (hot ? 30 : 0) - (lowSoc ? 42 : 0),
      attackWindow ? "Use high-value exits to close the gap"
        : defenceWindow ? "Protect position on the next straight" : "Spend the reserve while it is worth time",
      3,
    ),
    candidate("OVERTAKE", 12 + (state.overtakeEligible && attackWindow && longStraight ? 76 : 0) + (finalLap ? 22 : 0) - (lowSoc ? 55 : 0) - (hot ? 42 : 0), "Commit stored energy to the passing window", 4),
  ];
  const selected = candidates.sort((left, right) => right.utility - left.utility || right.tieBreak - left.tieBreak)[0];
  return { mode: selected.mode, utility: selected.utility, reason: selected.reason };
}
