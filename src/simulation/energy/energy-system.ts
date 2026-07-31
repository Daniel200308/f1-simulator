import type {
  EnergyDeploymentMode,
  EnergyManagementContext,
  EnergySystemConfig,
  EnergySystemState,
  EnergyThermalBand,
  EnergyUpdateInput,
  EnergyUpdateResult,
  PowerUnitEnergyProfile,
  RechargeMode,
} from "@/domain/energy";
import {
  DEFAULT_POWER_UNIT_ENERGY_PROFILE,
  ENERGY_MODE_BALANCE,
  ENERGY_SYSTEM_CONFIG,
  normalizeEnergyMode,
} from "@/simulation/energy/energy-config";

const MODE_LAP_SOC_DELTA: Readonly<Record<EnergyDeploymentMode, number>> = {
  HARVEST: 0.28,
  CONSERVE: 0.1,
  BALANCED: -0.015,
  ATTACK: -0.2,
  BOOST: -0.36,
  OVERTAKE: -0.4,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function isCurrentEnergySystemState(state: Partial<EnergySystemState> | null | undefined): state is EnergySystemState {
  return Boolean(
    state
    && Number.isFinite(state.stateOfCharge)
    && state.stateOfCharge! >= 0
    && state.stateOfCharge! <= 1
    && Number.isFinite(state.storedEnergyMJ)
    && state.storedEnergyMJ! >= 0
    && Number.isFinite(state.currentDeployPowerKW)
    && Number.isFinite(state.currentHarvestPowerKW)
    && Number.isFinite(state.deployedEnergyThisLapMJ)
    && Number.isFinite(state.harvestedEnergyThisLapMJ)
    && Number.isFinite(state.lastLapDeployedEnergyMJ)
    && Number.isFinite(state.lastLapHarvestedEnergyMJ)
    && Number.isFinite(state.totalDeployedEnergyMJ)
    && Number.isFinite(state.totalHarvestedEnergyMJ)
    && Number.isFinite(state.batteryTemperatureC)
    && Number.isFinite(state.batteryHealth)
    && state.batteryHealth! >= 0
    && state.batteryHealth! <= 1
    && Number.isFinite(state.predictedSocAtLapEnd)
    && Number.isFinite(state.targetSocAtLapEnd)
    && typeof state.modeReason === "string"
    && normalizeEnergyMode(state.deploymentMode) === state.deploymentMode
    && (state.rechargeMode === "AUTO" || state.rechargeMode === "LOW" || state.rechargeMode === "HIGH")
    && (state.thermalBand === "COLD" || state.thermalBand === "OPTIMAL" || state.thermalBand === "WARM" || state.thermalBand === "HOT" || state.thermalBand === "CRITICAL")
    && typeof state.clippingActive === "boolean"
    && typeof state.deratingActive === "boolean"
    && typeof state.boostActive === "boolean"
    && typeof state.overtakeEligible === "boolean"
    && (state.overtakeEntitlementLap === null || Number.isInteger(state.overtakeEntitlementLap))
    && typeof state.overtakeActive === "boolean"
  );
}

export function energyThermalBand(temperatureC: number, config = ENERGY_SYSTEM_CONFIG): EnergyThermalBand {
  if (temperatureC < config.optimalTemperatureC - 12) return "COLD";
  if (temperatureC <= config.optimalTemperatureC + 5) return "OPTIMAL";
  if (temperatureC < config.warningTemperatureC) return "WARM";
  if (temperatureC < config.criticalTemperatureC) return "HOT";
  return "CRITICAL";
}

export function createEnergySystemState(
  initialStateOfCharge = ENERGY_SYSTEM_CONFIG.initialStateOfCharge,
  temperatureC = ENERGY_SYSTEM_CONFIG.optimalTemperatureC,
  mode: EnergyDeploymentMode = "BALANCED",
  config = ENERGY_SYSTEM_CONFIG,
): EnergySystemState {
  const stateOfCharge = clamp(initialStateOfCharge, 0, 1);
  return {
    stateOfCharge,
    storedEnergyMJ: stateOfCharge * config.batteryCapacityMJ,
    currentDeployPowerKW: 0,
    currentHarvestPowerKW: 0,
    deployedEnergyThisLapMJ: 0,
    harvestedEnergyThisLapMJ: 0,
    lastLapDeployedEnergyMJ: 0,
    lastLapHarvestedEnergyMJ: 0,
    totalDeployedEnergyMJ: 0,
    totalHarvestedEnergyMJ: 0,
    batteryTemperatureC: temperatureC,
    batteryHealth: 1,
    deploymentMode: mode,
    rechargeMode: "AUTO",
    clippingActive: false,
    deratingActive: false,
    boostActive: false,
    overtakeEligible: false,
    overtakeEntitlementLap: null,
    overtakeActive: false,
    predictedSocAtLapEnd: stateOfCharge,
    targetSocAtLapEnd: ENERGY_MODE_BALANCE[mode].targetSoc,
    thermalBand: energyThermalBand(temperatureC, config),
    modeReason: "Automatic lap target",
  };
}

export function migrateEnergySystemState(
  state: Partial<EnergySystemState> | null | undefined,
  legacyBatteryPercent = ENERGY_SYSTEM_CONFIG.initialStateOfCharge * 100,
  legacyTemperatureC = ENERGY_SYSTEM_CONFIG.optimalTemperatureC,
  config = ENERGY_SYSTEM_CONFIG,
): EnergySystemState {
  if (isCurrentEnergySystemState(state)) return state;
  const mode = normalizeEnergyMode(state?.deploymentMode);
  const fallback = createEnergySystemState(legacyBatteryPercent / 100, legacyTemperatureC, mode, config);
  const stateOfCharge = clamp(finite(state?.stateOfCharge, fallback.stateOfCharge), 0, 1);
  const storedEnergyMJ = clamp(finite(state?.storedEnergyMJ, stateOfCharge * config.batteryCapacityMJ), 0, config.batteryCapacityMJ);
  const batteryTemperatureC = clamp(finite(state?.batteryTemperatureC, legacyTemperatureC), -20, 120);
  return {
    ...fallback,
    ...state,
    stateOfCharge: clamp(storedEnergyMJ / config.batteryCapacityMJ, 0, 1),
    storedEnergyMJ,
    currentDeployPowerKW: Math.max(0, finite(state?.currentDeployPowerKW, 0)),
    currentHarvestPowerKW: Math.max(0, finite(state?.currentHarvestPowerKW, 0)),
    deployedEnergyThisLapMJ: Math.max(0, finite(state?.deployedEnergyThisLapMJ, 0)),
    harvestedEnergyThisLapMJ: Math.max(0, finite(state?.harvestedEnergyThisLapMJ, 0)),
    lastLapDeployedEnergyMJ: Math.max(0, finite(state?.lastLapDeployedEnergyMJ, 0)),
    lastLapHarvestedEnergyMJ: Math.max(0, finite(state?.lastLapHarvestedEnergyMJ, 0)),
    totalDeployedEnergyMJ: Math.max(0, finite(state?.totalDeployedEnergyMJ, 0)),
    totalHarvestedEnergyMJ: Math.max(0, finite(state?.totalHarvestedEnergyMJ, 0)),
    batteryTemperatureC,
    batteryHealth: clamp(finite(state?.batteryHealth, 1), 0, 1),
    deploymentMode: mode,
    rechargeMode: state?.rechargeMode === "LOW" || state?.rechargeMode === "HIGH" ? state.rechargeMode : "AUTO",
    predictedSocAtLapEnd: clamp(finite(state?.predictedSocAtLapEnd, stateOfCharge), 0, 1),
    targetSocAtLapEnd: clamp(finite(state?.targetSocAtLapEnd, fallback.targetSocAtLapEnd), 0, 1),
    thermalBand: energyThermalBand(batteryTemperatureC, config),
  };
}

function lapTargetFor(mode: EnergyDeploymentMode, context: EnergyManagementContext): number {
  if (context.lapNumber >= context.totalLaps) return 0.09;
  if (context.safetyCarActive || context.virtualSafetyCarActive) return 0.82;
  if (context.sessionType === "QUALIFYING") return mode === "HARVEST" || mode === "CONSERVE" ? 0.88 : 0.1;
  if (context.sessionType === "PRACTICE") return Math.max(0.5, ENERGY_MODE_BALANCE[mode].targetSoc);
  return ENERGY_MODE_BALANCE[mode].targetSoc;
}

function predictionFor(mode: EnergyDeploymentMode, stateOfCharge: number, context: EnergyManagementContext): number {
  const remainingLap = clamp(1 - context.lapProgress, 0, 1);
  const neutralisedGain = context.safetyCarActive || context.virtualSafetyCarActive ? 0.22 * remainingLap : 0;
  return clamp(stateOfCharge + MODE_LAP_SOC_DELTA[mode] * remainingLap + neutralisedGain, 0, 1);
}

function deploymentWindow(context: EnergyManagementContext): number {
  if (context.currentSegmentType === "STRAIGHT") return 1;
  if (context.currentSegmentType === "FAST") return 0.72;
  if (context.currentSegmentType === "MEDIUM") return 0.27;
  return 0.12;
}

function brakingWindow(context: EnergyManagementContext): number {
  const deceleration = clamp((context.previousVehicleSpeed - context.vehicleSpeed) / 45, 0, 1);
  const segmentBrake = context.currentSegmentType === "SLOW" ? 0.92
    : context.currentSegmentType === "MEDIUM" ? 0.62
      : context.currentSegmentType === "FAST" ? 0.2 : 0.035;
  return Math.max(deceleration, segmentBrake);
}

function temperatureEfficiency(temperatureC: number, config: EnergySystemConfig): number {
  if (temperatureC < config.optimalTemperatureC - 12) {
    return clamp(0.7 + (temperatureC - (config.optimalTemperatureC - 30)) * 0.012, 0.62, 0.86);
  }
  if (temperatureC <= config.warningTemperatureC) return 1;
  return clamp(1 - (temperatureC - config.warningTemperatureC) / Math.max(1, config.criticalTemperatureC - config.warningTemperatureC) * 0.68, 0.2, 1);
}

function rechargeMultiplier(mode: RechargeMode): number {
  return mode === "HIGH" ? 1.18 : mode === "LOW" ? 0.72 : 1;
}

export function updateEnergySystem(input: EnergyUpdateInput): EnergyUpdateResult {
  const config = input.config ?? ENERGY_SYSTEM_CONFIG;
  const profile: PowerUnitEnergyProfile = input.profile ?? DEFAULT_POWER_UNIT_ENERGY_PROFILE;
  const deltaTimeSeconds = Math.max(0, finite(input.deltaTimeSeconds, 0));
  const context = input.context;
  const previous = input.state;
  const requestedMode = normalizeEnergyMode(input.requestedMode);
  const rechargeMode = input.rechargeMode ?? previous.rechargeMode;
  const greenTrack = !context.safetyCarActive && !context.virtualSafetyCarActive && !context.pitLaneActive;
  const straightWindow = context.currentSegmentType === "STRAIGHT" || context.currentSegmentType === "FAST";
  const overtakeEligible = greenTrack
    && context.overtakeEntitled
    && context.overtakeActivationZone
    && previous.stateOfCharge >= config.overtakeMinimumSoc;
  // Overtake deployment is a driver/PU automation, not a per-lap pit-wall
  // command. The selected mode remains the baseline tendency and is restored
  // as soon as the Silverstone activation zone ends.
  const mode: EnergyDeploymentMode = overtakeEligible
    ? "OVERTAKE"
    : requestedMode === "OVERTAKE" ? "BALANCED" : requestedMode;
  const modeBalance = ENERGY_MODE_BALANCE[mode];
  const targetSocAtLapEnd = lapTargetFor(mode, context);
  const predictedBefore = predictionFor(mode, previous.stateOfCharge, context);
  const overtakeActive = overtakeEligible;
  const boostActive = mode === "BOOST" && greenTrack && straightWindow;

  const grip = clamp(context.tyreGrip * context.weatherGrip, 0.35, 1.05);
  const speedTraction = context.vehicleSpeed < 20 ? 0 : clamp((context.vehicleSpeed - 20) / 165, 0.08, 1);
  const tractionLimit = clamp(speedTraction * Math.sqrt(grip) * profile.lowSpeedTorqueControl, 0, 1);
  const thermalEfficiency = temperatureEfficiency(previous.batteryTemperatureC, config);
  const usableSocFactor = clamp((previous.stateOfCharge - config.minimumUsableSoc) / 0.18, 0, 1);
  /*
   * The lap-end target still shapes deployment, but the tightest usage level is
   * meant to spend the battery. Holding ATTACK to the same reserve protection as
   * BALANCED made the three usage levels feel almost identical, so it keeps only
   * a light floor while OVERTAKE and BOOST ignore the target entirely.
   */
  const automaticTargetControl = mode !== "BOOST" && mode !== "OVERTAKE";
  const targetDeficit = automaticTargetControl ? Math.max(0, targetSocAtLapEnd - predictedBefore) : 0;
  const protectionStrength = mode === "ATTACK" ? 1.5 : 3.2;
  const protectionFloor = mode === "ATTACK" ? 0.55 : 0.12;
  const predictedProtection = targetDeficit > 0
    ? clamp(1 - targetDeficit * protectionStrength, protectionFloor, 1)
    : 1;
  const lapDeployLimit = config.deploymentLimitMJPerLap ?? Number.POSITIVE_INFINITY;
  const lapDeployFactor = clamp((lapDeployLimit - previous.deployedEnergyThisLapMJ) / Math.max(0.3, lapDeployLimit * 0.14), 0, 1);
  const requestedModeDemand = modeBalance.deployDemand;
  const deployPowerKW = greenTrack
    ? Math.max(0, Math.min(
      config.maxDeployPowerKW,
      config.maxDeployPowerKW
        * requestedModeDemand
        * deploymentWindow(context)
        * tractionLimit
        * usableSocFactor
        * thermalEfficiency
        * predictedProtection
        * lapDeployFactor
        * profile.deployEfficiency
        * (context.currentSegmentType === "STRAIGHT" ? profile.highSpeedDeploymentEfficiency : 1),
    ))
    : 0;

  const braking = brakingWindow(context);
  const liftAndCoast = context.currentSegmentType === "STRAIGHT" && (mode === "HARVEST" || mode === "CONSERVE")
    ? 0.26 * (mode === "HARVEST" ? 1 : 0.62)
    : 0;
  const partialThrottleRecovery = context.currentSegmentType === "MEDIUM" || context.currentSegmentType === "SLOW" ? 0.12 : 0;
  const neutralisedRecovery = context.safetyCarActive || context.virtualSafetyCarActive ? 0.42 : 0;
  // Brake energy recovery is an automatic driver/PU action in every strategy.
  // The selected mode biases its strength and adds lift-and-coast; it never
  // switches regeneration off, even in Attack, Boost or Overtake.
  const automaticBrakeRecovery = braking * (0.62 + modeBalance.harvestDemand * 0.38);
  const liftAndCoastRecovery = liftAndCoast * modeBalance.harvestDemand;
  const partialRecovery = partialThrottleRecovery * (0.35 + modeBalance.harvestDemand * 0.65);
  const recoveryDemand = Math.max(automaticBrakeRecovery, liftAndCoastRecovery, partialRecovery, neutralisedRecovery);
  const recoveryTargetBias = clamp(1 + targetDeficit * 2.1, 1, 1.65);
  const roomFactor = clamp((config.maximumUsableSoc - previous.stateOfCharge) / 0.16, 0, 1);
  const wetRearGripFactor = clamp(0.45 + grip * 0.55, 0.55, 1);
  const harvestLimit = context.sessionType === "QUALIFYING" ? config.qualifyingHarvestLimitMJ : config.raceHarvestLimitMJ;
  const lapHarvestFactor = harvestLimit === undefined
    ? 1
    : clamp((harvestLimit - previous.harvestedEnergyThisLapMJ) / Math.max(0.3, harvestLimit * 0.14), 0, 1);
  const harvestPowerKW = Math.max(0, Math.min(
    config.maxHarvestPowerKW,
    config.maxHarvestPowerKW
      * recoveryDemand
      * recoveryTargetBias
      * roomFactor
      * wetRearGripFactor
      * thermalEfficiency
      * rechargeMultiplier(rechargeMode)
      * lapHarvestFactor
      * profile.harvestEfficiency,
  ));

  const deployedEnergyMJ = deployPowerKW * deltaTimeSeconds / 1_000;
  const effectiveDeployEfficiency = clamp(config.deployEfficiency * profile.deployEfficiency * thermalEfficiency, 0.45, 0.99);
  const batteryEnergyConsumedMJ = deployedEnergyMJ / effectiveDeployEfficiency;
  const effectiveHarvestEfficiency = clamp(config.harvestEfficiency * profile.harvestEfficiency * thermalEfficiency, 0.35, 0.98);
  const harvestedEnergyMJ = harvestPowerKW * effectiveHarvestEfficiency * deltaTimeSeconds / 1_000;
  const storedEnergyMJ = clamp(previous.storedEnergyMJ - batteryEnergyConsumedMJ + harvestedEnergyMJ, 0, config.batteryCapacityMJ);
  const stateOfCharge = clamp(storedEnergyMJ / config.batteryCapacityMJ, 0, 1);
  const deployWasLimited = deployPowerKW < config.maxDeployPowerKW * requestedModeDemand * deploymentWindow(context) * 0.72;
  const clippingActive = greenTrack
    && context.currentSegmentType === "STRAIGHT"
    && context.segmentProgress >= 0.52
    && requestedModeDemand >= ENERGY_MODE_BALANCE.BALANCED.deployDemand
    && deployWasLimited
    && (stateOfCharge <= config.minimumUsableSoc + 0.08 || predictedBefore < targetSocAtLapEnd - 0.08 || lapDeployFactor < 0.5);
  const deratingActive = previous.batteryTemperatureC >= config.warningTemperatureC || previous.batteryHealth < 0.82;

  const powerHeat = (deployPowerKW + harvestPowerKW * 0.72) * config.heatingRatePerKW * modeBalance.thermalLoad;
  const airflow = clamp(context.vehicleSpeed / 280, 0, 1.25);
  const trafficFactor = clamp(1 - context.trafficCoolingLoss, 0.45, 1);
  const pitCooling = context.pitLaneActive ? 1.55 : 1;
  const ambientPull = Math.max(0, previous.batteryTemperatureC - context.airTemperatureC - 6) * 0.004;
  const cooling = (config.coolingRatePerSecond * (0.42 + airflow) * profile.coolingEfficiency * trafficFactor * pitCooling) + ambientPull;
  const batteryTemperatureC = clamp(previous.batteryTemperatureC + (powerHeat - cooling) * deltaTimeSeconds, context.airTemperatureC, 92);
  const overheat = Math.max(0, batteryTemperatureC - config.criticalTemperatureC * profile.thermalTolerance);
  const aggressiveWear = boostActive || overtakeActive ? 0.000000012 * deltaTimeSeconds : 0;
  const batteryHealth = clamp(previous.batteryHealth - overheat * 0.0000007 * deltaTimeSeconds / Math.max(0.8, profile.reliability) - aggressiveWear, 0, 1);
  const predictedSocAtLapEnd = predictionFor(mode, stateOfCharge, context);
  const modeReason = context.safetyCarActive || context.virtualSafetyCarActive
    ? "Neutralised lap · recover state of charge"
    : clippingActive
      ? "Straight-line deployment limited below target"
      : overtakeActive
        ? `Overtake window · ${context.gapAheadSeconds?.toFixed(3)}s to car ahead`
        : boostActive
          ? context.driverDefenceIntent > context.driverAttackIntent ? "Maximum power reserved for defence" : "Maximum driver-requested deployment"
          : predictedSocAtLapEnd < targetSocAtLapEnd - 0.04
            ? "Protecting lap-end energy target"
            : modeBalance.label;
  const state: EnergySystemState = {
    ...previous,
    stateOfCharge,
    storedEnergyMJ,
    currentDeployPowerKW: deployPowerKW,
    currentHarvestPowerKW: harvestPowerKW,
    deployedEnergyThisLapMJ: previous.deployedEnergyThisLapMJ + deployedEnergyMJ,
    harvestedEnergyThisLapMJ: previous.harvestedEnergyThisLapMJ + harvestedEnergyMJ,
    totalDeployedEnergyMJ: previous.totalDeployedEnergyMJ + deployedEnergyMJ,
    totalHarvestedEnergyMJ: previous.totalHarvestedEnergyMJ + harvestedEnergyMJ,
    batteryTemperatureC,
    batteryHealth,
    deploymentMode: mode,
    rechargeMode,
    clippingActive,
    deratingActive,
    boostActive,
    overtakeEligible,
    overtakeActive,
    predictedSocAtLapEnd,
    targetSocAtLapEnd,
    thermalBand: energyThermalBand(batteryTemperatureC, config),
    modeReason,
  };
  const deployContribution = deployPowerKW / config.maxDeployPowerKW * 0.0135;
  const recoveryDrag = harvestPowerKW / config.maxHarvestPowerKW * (0.0035 + liftAndCoast * 0.014);
  const propulsionFactor = clamp(1 + deployContribution - recoveryDrag - (clippingActive ? 0.008 : 0), 0.972, 1.016);
  const rearLockRisk = clamp(harvestPowerKW / config.maxHarvestPowerKW * (1 - grip) * 1.65, 0, 1);
  return { state, propulsionFactor, rearLockRisk, liftAndCoastLoss: liftAndCoast * 0.014 };
}

export function completeEnergyLap(state: EnergySystemState): EnergySystemState {
  return {
    ...state,
    lastLapDeployedEnergyMJ: state.deployedEnergyThisLapMJ,
    lastLapHarvestedEnergyMJ: state.harvestedEnergyThisLapMJ,
    deployedEnergyThisLapMJ: 0,
    harvestedEnergyThisLapMJ: 0,
    clippingActive: false,
  };
}
