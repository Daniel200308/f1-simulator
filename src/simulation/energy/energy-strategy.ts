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
      return { mode: "HARVEST", utility: 100, reason: rechargeLapWindow ? "Qualifying out/in lap recovery programme" : "Protect the flying-lap energy reserve" };
    }
    return {
      mode: context.currentSegmentType === "STRAIGHT" && state.stateOfCharge >= 0.3 ? "BOOST" : "ATTACK",
      utility: 100,
      reason: "Qualifying flying lap deployment map",
    };
  }

  const candidates: Candidate[] = [
    candidate("BALANCED", 50 + state.stateOfCharge * 6, "Maintain the automatic lap target", 3),
    candidate("CONSERVE", 38 + (belowTarget ? 35 : 0) + (hot ? 22 : 0), hot ? "Reduce electrical thermal load" : "Recover the lap-end target", 2),
    candidate("HARVEST", 26 + (lowSoc ? 70 : 0) + (neutralised ? 82 : 0) + (belowTarget ? 22 : 0), neutralised ? "Neutralised lap offers low-cost recovery" : "State of charge is below the usable reserve", 1),
    candidate("ATTACK", 25 + (attackWindow ? 43 : 0) + context.driverAttackIntent * 18 + (finalLap ? 24 : 0) - (belowTarget ? 28 : 0) - (hot ? 30 : 0), "Use high-value exits to close the gap", 4),
    candidate("BOOST", 18 + (defenceWindow && longStraight ? 55 : 0) + context.driverDefenceIntent * 16 + (finalLap ? 28 : 0) - (lowSoc ? 42 : 0) - (hot ? 35 : 0), defenceWindow ? "Protect position on the next straight" : "Release remaining energy", 5),
    candidate("OVERTAKE", 12 + (state.overtakeEligible && attackWindow && longStraight ? 76 : 0) + (finalLap ? 22 : 0) - (lowSoc ? 55 : 0) - (hot ? 42 : 0), "Commit stored energy to the passing window", 6),
  ];
  const selected = candidates.sort((left, right) => right.utility - left.utility || right.tieBreak - left.tieBreak)[0];
  return { mode: selected.mode, utility: selected.utility, reason: selected.reason };
}
