export type EnergyDeploymentMode = "HARVEST" | "CONSERVE" | "BALANCED" | "ATTACK" | "BOOST" | "OVERTAKE";

/** Legacy commands are accepted only so older saves and replay commands migrate cleanly. */
export type EnergyMode = EnergyDeploymentMode | "DEFEND" | "RECHARGE";
export type RechargeMode = "AUTO" | "LOW" | "HIGH";
export type EnergyThermalBand = "COLD" | "OPTIMAL" | "WARM" | "HOT" | "CRITICAL";
export type EnergyFlowState = "NEUTRAL" | "HARVESTING" | "DEPLOYING" | "OVERTAKE" | "DEFENDING" | "CLIPPING";
export type EnergySessionType = "PRACTICE" | "QUALIFYING" | "RACE";

export interface EnergySystemConfig {
  batteryCapacityMJ: number;
  initialStateOfCharge: number;
  maxDeployPowerKW: number;
  maxHarvestPowerKW: number;
  deployEfficiency: number;
  harvestEfficiency: number;
  minimumUsableSoc: number;
  maximumUsableSoc: number;
  optimalTemperatureC: number;
  warningTemperatureC: number;
  criticalTemperatureC: number;
  coolingRatePerSecond: number;
  heatingRatePerKW: number;
  raceHarvestLimitMJ?: number;
  qualifyingHarvestLimitMJ?: number;
  deploymentLimitMJPerLap?: number;
  overtakeMaximumGapSeconds: number;
  overtakeMinimumSoc: number;
  overtakeMinimumStraightMeters: number;
}

export interface PowerUnitEnergyProfile {
  deployEfficiency: number;
  harvestEfficiency: number;
  coolingEfficiency: number;
  thermalTolerance: number;
  reliability: number;
  controlSoftwareQuality: number;
  lowSpeedTorqueControl: number;
  highSpeedDeploymentEfficiency: number;
}

export interface EnergySystemState {
  stateOfCharge: number;
  storedEnergyMJ: number;
  currentDeployPowerKW: number;
  currentHarvestPowerKW: number;
  deployedEnergyThisLapMJ: number;
  harvestedEnergyThisLapMJ: number;
  lastLapDeployedEnergyMJ: number;
  lastLapHarvestedEnergyMJ: number;
  totalDeployedEnergyMJ: number;
  totalHarvestedEnergyMJ: number;
  batteryTemperatureC: number;
  batteryHealth: number;
  deploymentMode: EnergyDeploymentMode;
  rechargeMode: RechargeMode;
  clippingActive: boolean;
  deratingActive: boolean;
  boostActive: boolean;
  overtakeEligible: boolean;
  /** Lap on which the T17 detection result may be used at the T18 activation line. */
  overtakeEntitlementLap: number | null;
  overtakeActive: boolean;
  predictedSocAtLapEnd: number;
  targetSocAtLapEnd: number;
  thermalBand: EnergyThermalBand;
  modeReason: string;
}

export interface EnergyManagementContext {
  sessionType: EnergySessionType;
  lapNumber: number;
  totalLaps: number;
  lapProgress: number;
  currentSoc: number;
  targetLapEndSoc: number;
  predictedLapEndSoc: number;
  trackPosition: number;
  gapAheadSeconds: number | null;
  gapBehindSeconds: number | null;
  currentSegmentType: "STRAIGHT" | "FAST" | "MEDIUM" | "SLOW";
  segmentLength: number;
  segmentProgress: number;
  vehicleSpeed: number;
  previousVehicleSpeed: number;
  tyreGrip: number;
  weatherGrip: number;
  airTemperatureC: number;
  trafficCoolingLoss: number;
  safetyCarActive: boolean;
  virtualSafetyCarActive: boolean;
  pitLaneActive: boolean;
  overtakeEntitled: boolean;
  overtakeActivationZone: boolean;
  driverAttackIntent: number;
  driverDefenceIntent: number;
}

export interface EnergyUpdateInput {
  state: EnergySystemState;
  requestedMode: EnergyMode;
  rechargeMode?: RechargeMode;
  context: EnergyManagementContext;
  config?: EnergySystemConfig;
  profile?: PowerUnitEnergyProfile;
  deltaTimeSeconds: number;
}

export interface EnergyUpdateResult {
  state: EnergySystemState;
  propulsionFactor: number;
  rearLockRisk: number;
  liftAndCoastLoss: number;
}

export interface EnergyPlanSegment {
  id: string;
  label: string;
  action: "DEPLOY" | "HARVEST" | "COAST" | "NEUTRAL" | "CLIPPING_RISK";
  expectedDeployMJ: number;
  expectedHarvestMJ: number;
  expectedSocDelta: number;
}
