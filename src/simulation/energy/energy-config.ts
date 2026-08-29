import type { EnergyDeploymentMode, EnergySystemConfig, PowerUnitEnergyProfile } from "@/domain/energy";

/**
 * 350 kW is the public 2026 MGU-K maximum used by the game brief. Every other
 * pack, efficiency and thermal value below is a gameplay balance parameter,
 * not a claim about a team's private hardware.
 */
export const ENERGY_SYSTEM_CONFIG: EnergySystemConfig = {
  batteryCapacityMJ: 4,
  initialStateOfCharge: 0.76,
  maxDeployPowerKW: 350,
  maxHarvestPowerKW: 350,
  deployEfficiency: 0.94,
  harvestEfficiency: 0.86,
  minimumUsableSoc: 0.08,
  maximumUsableSoc: 0.98,
  optimalTemperatureC: 42,
  warningTemperatureC: 58,
  criticalTemperatureC: 66,
  coolingRatePerSecond: 0.032,
  heatingRatePerKW: 0.0009,
  raceHarvestLimitMJ: 9,
  qualifyingHarvestLimitMJ: 7.5,
  deploymentLimitMJPerLap: 8.5,
  overtakeMaximumGapSeconds: 1,
  overtakeMinimumSoc: 0.18,
  overtakeMinimumStraightMeters: 180,
};

export const DEFAULT_POWER_UNIT_ENERGY_PROFILE: PowerUnitEnergyProfile = {
  deployEfficiency: 1,
  harvestEfficiency: 1,
  coolingEfficiency: 1,
  thermalTolerance: 1,
  reliability: 1,
  controlSoftwareQuality: 1,
  lowSpeedTorqueControl: 1,
  highSpeedDeploymentEfficiency: 1,
};

const TEAM_ENERGY_PROFILE_CACHE = new Map<string, PowerUnitEnergyProfile>();

/**
 * Small deterministic offsets give the field technical variety without
 * asserting that any real manufacturer owns a specific private advantage.
 */
export function energyProfileForTeam(teamId: string): PowerUnitEnergyProfile {
  const cached = TEAM_ENERGY_PROFILE_CACHE.get(teamId);
  if (cached) return cached;
  let hash = 2_166_136_261;
  for (const character of teamId) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  const offset = (shift: number, range: number) => ((((hash >>> shift) & 0xff) / 255) * 2 - 1) * range;
  const profile = {
    deployEfficiency: 1 + offset(0, 0.006),
    harvestEfficiency: 1 + offset(4, 0.008),
    coolingEfficiency: 1 + offset(8, 0.012),
    thermalTolerance: 1 + offset(12, 0.008),
    reliability: 1 + offset(16, 0.004),
    controlSoftwareQuality: 1 + offset(20, 0.008),
    lowSpeedTorqueControl: 1 + offset(3, 0.01),
    highSpeedDeploymentEfficiency: 1 + offset(11, 0.008),
  };
  TEAM_ENERGY_PROFILE_CACHE.set(teamId, profile);
  return profile;
}

export const ENERGY_MODE_BALANCE: Readonly<Record<EnergyDeploymentMode, {
  deployDemand: number;
  harvestDemand: number;
  targetSoc: number;
  thermalLoad: number;
  label: string;
}>> = {
  HARVEST: { deployDemand: 0.28, harvestDemand: 1, targetSoc: 0.82, thermalLoad: 0.42, label: "Recovery-biased automatic map" },
  CONSERVE: { deployDemand: 0.46, harvestDemand: 0.72, targetSoc: 0.68, thermalLoad: 0.48, label: "Reserve-biased automatic map" },
  BALANCED: { deployDemand: 0.66, harvestDemand: 0.5, targetSoc: 0.55, thermalLoad: 0.62, label: "Automatic lap target" },
  ATTACK: { deployDemand: 0.86, harvestDemand: 0.28, targetSoc: 0.38, thermalLoad: 0.84, label: "Attack-biased automatic map" },
  BOOST: { deployDemand: 1, harvestDemand: 0.16, targetSoc: 0.28, thermalLoad: 1, label: "Maximum deployment tendency" },
  OVERTAKE: { deployDemand: 1, harvestDemand: 0.12, targetSoc: 0.22, thermalLoad: 1.05, label: "Overtake activation map" },
};

export function normalizeEnergyMode(mode: string | undefined): EnergyDeploymentMode {
  if (mode === "RECHARGE") return "HARVEST";
  if (mode === "DEFEND") return "BOOST";
  if (mode === "HARVEST" || mode === "CONSERVE" || mode === "BALANCED" || mode === "ATTACK" || mode === "BOOST" || mode === "OVERTAKE") return mode;
  return "BALANCED";
}
