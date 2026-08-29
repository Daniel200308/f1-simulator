import type { EnergyDeploymentMode, EnergyPlanSegment, EnergySystemState } from "@/domain/energy";
import type { TrackSegment } from "@/domain/race";
import { ENERGY_MODE_BALANCE, ENERGY_SYSTEM_CONFIG } from "@/simulation/energy/energy-config";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function predictEnergySoc(state: EnergySystemState, mode: EnergyDeploymentMode): readonly [number, number, number, number] {
  const modeDelta = mode === "HARVEST" ? 0.2 : mode === "CONSERVE" ? 0.075 : mode === "BALANCED" ? -0.012 : mode === "ATTACK" ? -0.14 : -0.24;
  const predictAtLap = (laps: number) => clamp(
    state.stateOfCharge + modeDelta * laps,
    ENERGY_SYSTEM_CONFIG.minimumUsableSoc,
    ENERGY_SYSTEM_CONFIG.maximumUsableSoc,
  );
  return [predictAtLap(0), predictAtLap(1), predictAtLap(3), predictAtLap(5)];
}

export function boostSecondsRemaining(state: EnergySystemState): number {
  const usableMJ = Math.max(0, state.storedEnergyMJ - ENERGY_SYSTEM_CONFIG.batteryCapacityMJ * ENERGY_SYSTEM_CONFIG.minimumUsableSoc);
  return usableMJ / (ENERGY_SYSTEM_CONFIG.maxDeployPowerKW / 1_000 / ENERGY_SYSTEM_CONFIG.deployEfficiency);
}

export function buildTrackEnergyPlan(segments: readonly TrackSegment[], mode: EnergyDeploymentMode, state: EnergySystemState): readonly EnergyPlanSegment[] {
  const balance = ENERGY_MODE_BALANCE[mode];
  const grouped = segments.slice(0, 12).map((segment, index) => {
    const deployWeight = segment.kind === "STRAIGHT" ? 1 : segment.kind === "FAST" ? 0.64 : 0.08;
    const harvestWeight = segment.kind === "SLOW" ? 0.9 : segment.kind === "MEDIUM" ? 0.55 : segment.kind === "FAST" ? 0.14 : mode === "HARVEST" ? 0.18 : 0.03;
    const expectedDeployMJ = ENERGY_SYSTEM_CONFIG.maxDeployPowerKW * balance.deployDemand * deployWeight * Math.min(3.8, segment.length / 85) / 1_000;
    const expectedHarvestMJ = ENERGY_SYSTEM_CONFIG.maxHarvestPowerKW * balance.harvestDemand * harvestWeight * Math.min(3.2, segment.length / 70) * ENERGY_SYSTEM_CONFIG.harvestEfficiency / 1_000;
    const clippingRisk = state.predictedSocAtLapEnd < state.targetSocAtLapEnd - 0.06 && segment.kind === "STRAIGHT" && index > segments.length * 0.55;
    const action: EnergyPlanSegment["action"] = clippingRisk ? "CLIPPING_RISK"
      : expectedDeployMJ > expectedHarvestMJ * 1.25 ? "DEPLOY"
        : expectedHarvestMJ > expectedDeployMJ * 1.1 ? "HARVEST"
          : mode === "HARVEST" && segment.kind === "STRAIGHT" ? "COAST" : "NEUTRAL";
    return {
      id: segment.id,
      label: `S${index + 1}`,
      action,
      expectedDeployMJ,
      expectedHarvestMJ,
      expectedSocDelta: (expectedHarvestMJ - expectedDeployMJ / ENERGY_SYSTEM_CONFIG.deployEfficiency) / ENERGY_SYSTEM_CONFIG.batteryCapacityMJ,
    } satisfies EnergyPlanSegment;
  });
  return grouped;
}
