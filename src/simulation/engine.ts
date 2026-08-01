import type { EnergyDeploymentMode, EnergyManagementContext, EnergySystemState } from "@/domain/energy";
import type { ActiveAeroMode, ActiveIncident, BattleStatus, CoolingMode, EnergyMode, EnergyState, PaceMode, PitStopIssue, RaceCarState, RaceControlStatus, RaceEvent, RaceSnapshot, RaceStatus, RacingLineMode, RadioMessage, TeamOrderType, TyreCompound, TyreMode, TyreSetState, TyreTemperatureState, WeatherState, WeekendTyreInventory, WeekendTyreUsage } from "@/domain/race";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, DRIVERS, TEAM_BY_ID } from "@/fixtures/grid";
import { buildAiStrategyDecision } from "@/simulation/ai-strategy";
import { pitMistakeRiskBias, raceIncidentRiskMultiplier } from "@/simulation/driver-risk";
import { ENERGY_SYSTEM_CONFIG, energyProfileForTeam, normalizeEnergyMode } from "@/simulation/energy/energy-config";
import { buildEnergyRadioMessages } from "@/simulation/energy/energy-messages";
import { chooseAiEnergyMode } from "@/simulation/energy/energy-strategy";
import { completeEnergyLap, createEnergySystemState, migrateEnergySystemState, updateEnergySystem } from "@/simulation/energy/energy-system";
import { buildRaceDriverRadio } from "@/simulation/message-library";
import { resolvePitStopExecution } from "@/simulation/pit-operations";
import { PIT_ENTRY_START, PIT_EXIT_END, PIT_LANE_START, pitBoxDistanceForTeam } from "@/simulation/pit-lane";
import { signedNoise } from "@/simulation/random";
import { calculateFieldRacecraft } from "@/simulation/racecraft";
import { classifiedFieldHasFinished } from "@/simulation/race-finish";
import { buildRaceStartingTyrePlan } from "@/simulation/starting-tyre-strategy";
import { advancePenaltyLifecycle, reviewStewarding } from "@/simulation/stewarding";
import { FIA_2026_PENALTY_RULES, isMandatoryPitPenalty, isTimePenalty, penaltyCrossingsRemaining, pitSpeedingIncidentQuota } from "@/simulation/fia-2026-rules";
import {
  VSC_SPEED_FACTOR,
  advanceSafetyCarPosition,
  advanceSafetyCarProcedure,
  buildSafetyCarSchedule,
  buildSafetyCarFormation,
  localYellowInstructionFor,
  pitLaneProcedureFor,
  raceControlPhaseMessage,
  selectHigherPriorityRaceControl,
  safetyCarTargetLapsFor,
  updateVscCompliance,
  vscTargetElapsedSeconds,
  type SafetyCarFormation,
} from "@/simulation/race-control";
import { telemetrySpeedAtDistance } from "@/simulation/silverstone-telemetry";
import { advanceBrakeTemperatures, advanceThermalStress, assessVehicleThermals, averageCornerTemperature, thermalPerformanceFactor, thermalSeverityRank, THERMAL_THRESHOLDS } from "@/simulation/thermal-management";
import { raceStartTyreInventory, raceStartTyreSetsFor } from "@/simulation/tyre-allocation";
import {
  normalizeLapDistance,
  pointAtDistance,
  sectorAtDistance,
  segmentIndexAtDistance,
  SILVERSTONE_CIRCUIT,
  SILVERSTONE_CORNERS,
  SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE,
  SILVERSTONE_OVERTAKE_DETECTION_DISTANCE,
  SILVERSTONE_OVERTAKE_ZONE_END_DISTANCE,
  SILVERSTONE_SECTOR_ENDS,
} from "@/simulation/track";
import { createSpatialWeather, effectiveWaterAtDistance, updateSpatialWeather, WEATHER_SURFACE_ZONE_COUNT } from "@/simulation/weather";
import type { EnergyDebugAction } from "@/simulation/protocol";

export const FIXED_STEP_SECONDS = 0.1;
export const DEFAULT_SEED = 20_260_712;
export const INCIDENT_BASE_PROBABILITY_PER_CAR_SECOND = 0.000018;
export const INCIDENT_FIELD_COOLDOWN_SECONDS = 180;
export const INCIDENT_DRIVER_COOLDOWN_SECONDS = 1_200;
export const SAFETY_CAR_RANDOM_MIN_LAP = 8;
export const SAFETY_CAR_RANDOM_MAX_LAP = 38;
export const MIN_RETIREMENTS_PER_RACE = 2;
export const MAX_RETIREMENTS_PER_RACE = 6;

/**
 * A seed-stable but player-unpredictable point between laps 8 and 38. Natural
 * severe incidents may use the race's single SC allocation before this point;
 * otherwise the scheduled recovery incident guarantees one deployment.
 */
export function scheduledSafetyCarTriggerDistance(seed: number): number {
  const lapNoise = (signedNoise(seed, 71_001, 0) + 1) / 2;
  const distanceNoise = (signedNoise(seed, 71_002, 0) + 1) / 2;
  const lap = SAFETY_CAR_RANDOM_MIN_LAP
    + Math.floor(lapNoise * (SAFETY_CAR_RANDOM_MAX_LAP - SAFETY_CAR_RANDOM_MIN_LAP + 1));
  const lapRatio = 0.14 + distanceNoise * 0.72;
  return ((lap - 1) + lapRatio) * SILVERSTONE_CIRCUIT.lengthMeters;
}

/** Seed-stable retirement target. Every race finishes with two to six classified retirements. */
export function plannedRetirementCount(seed: number): number {
  const roll = clamp((signedNoise(seed, 72_001, 0) + 1) / 2, 0, 0.999_999);
  return MIN_RETIREMENTS_PER_RACE + Math.floor(roll * (MAX_RETIREMENTS_PER_RACE - MIN_RETIREMENTS_PER_RACE + 1));
}

/** Spreads the guaranteed retirements between roughly laps 9 and 45. */
export function plannedRetirementTriggerDistance(seed: number, ordinal: number, targetCount = plannedRetirementCount(seed)): number {
  const safeTarget = clamp(Math.round(targetCount), MIN_RETIREMENTS_PER_RACE, MAX_RETIREMENTS_PER_RACE);
  const safeOrdinal = clamp(Math.round(ordinal), 0, safeTarget - 1);
  const progress = safeTarget === 1 ? 0.5 : safeOrdinal / (safeTarget - 1);
  const jitter = signedNoise(seed, 72_100 + safeOrdinal, safeTarget) * 2.2;
  const lap = clamp(9 + progress * 35 + jitter, 8, 46);
  const lapRatio = 0.18 + ((signedNoise(seed, 72_200 + safeOrdinal, safeTarget) + 1) / 2) * 0.58;
  return ((lap - 1) + lapRatio) * SILVERSTONE_CIRCUIT.lengthMeters;
}

const PACE_SPEED: Record<PaceMode, number> = { ATTACK: 1.012, PUSH: 1.007, STANDARD: 1, CONSERVE: 0.985, COOL: 0.958 };
const PACE_WEAR: Record<PaceMode, number> = { ATTACK: 1.42, PUSH: 1.18, STANDARD: 1, CONSERVE: 0.78, COOL: 0.62 };
const PACE_FUEL: Record<PaceMode, number> = { ATTACK: 1.10, PUSH: 1.05, STANDARD: 1, CONSERVE: 0.92, COOL: 0.86 };
const PACE_TEMPERATURE: Record<PaceMode, number> = { ATTACK: 110, PUSH: 105, STANDARD: 100, CONSERVE: 94, COOL: 86 };
const TYRE_SPEED: Record<TyreMode, number> = { GRIP: 1.006, BALANCED: 1, SAVE: 0.991, TEMPERATURE: 0.986 };
const TYRE_WEAR: Record<TyreMode, number> = { GRIP: 1.16, BALANCED: 1, SAVE: 0.74, TEMPERATURE: 0.84 };
const COMPOUND_SPEED: Record<TyreCompound, number> = { SOFT: 1.012, MEDIUM: 1, HARD: 0.992, INTERMEDIATE: 0.91, WET: 0.85 };
const COMPOUND_WEAR: Record<TyreCompound, number> = { SOFT: 1.34, MEDIUM: 1, HARD: 0.76, INTERMEDIATE: 1.12, WET: 0.92 };
const COMPOUND_TEMPERATURE: Record<TyreCompound, number> = { SOFT: 2, MEDIUM: 0, HARD: -3, INTERMEDIATE: -8, WET: -12 };
const TYRE_MODE_TEMPERATURE: Record<TyreMode, number> = { GRIP: 4, BALANCED: 0, SAVE: -4, TEMPERATURE: -9 };
const COMPOUND_THERMAL_RESPONSE: Record<TyreCompound, number> = { SOFT: 1.16, MEDIUM: 1, HARD: 0.86, INTERMEDIATE: 1.08, WET: 1.14 };
const TYRE_TEMPERATURE_MIN = 45;
const TYRE_TEMPERATURE_MAX = 145;
const POWER_UNIT_TEMPERATURE_MIN = 68;
const POWER_UNIT_TEMPERATURE_MAX = 140;
const GEARBOX_TEMPERATURE_MIN = 50;
const GEARBOX_TEMPERATURE_MAX = 150;
const ENERGY_STORE_TEMPERATURE_MIN = 18;
const ENERGY_STORE_TEMPERATURE_MAX = 85;
const DRY_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD"];
const ENERGY_MODE_SPEED: Readonly<Record<EnergyDeploymentMode, number>> = {
  HARVEST: 0.9948,
  CONSERVE: 0.997,
  BALANCED: 1,
  ATTACK: 1.0015,
  BOOST: 1.002,
  OVERTAKE: 1.002,
};
const COOLING_SPEED: Record<CoolingMode, number> = { NORMAL: 1, LIFT_AND_COAST: 0.982, MAX_COOLING: 0.958 };
const COOLING_FUEL: Record<CoolingMode, number> = { NORMAL: 1, LIFT_AND_COAST: 0.92, MAX_COOLING: 0.84 };

export {
  PIT_BOX_DISTANCE,
  PIT_ENTRY_START,
  PIT_EXIT_END,
  PIT_LANE_START,
  pitBoxDistanceForTeam,
} from "@/simulation/pit-lane";
export const PIT_STOP_DURATION = 2.5;
export const ESTIMATED_PIT_LOSS_SECONDS = 20;
export const PIT_RELEASE_SAFE_GAP_METERS = 22;
export const UNSAFE_RELEASE_MISTAKE_PROBABILITY_PER_RACE = 0.03;
export const UNSAFE_REJOIN_MISTAKE_PROBABILITY_PER_RACE = 0.05;

function uniformTyreTemperatures(temperature: number): TyreTemperatureState {
  return { frontLeft: temperature, frontRight: temperature, rearLeft: temperature, rearRight: temperature };
}

export function averageTyreTemperature(temperatures: TyreTemperatureState): number {
  return (temperatures.frontLeft + temperatures.frontRight + temperatures.rearLeft + temperatures.rearRight) / 4;
}

function createTyreSets(carId: string, fittedCompound: TyreCompound, usedCounts: Partial<Record<TyreCompound, number>> = {}, inventory?: WeekendTyreInventory): TyreSetState[] {
  const source = inventory ?? { [carId]: usedCounts };
  const compoundSets = raceStartTyreSetsFor(carId, fittedCompound, source);
  const fitted = compoundSets.find((set) => set.status === "RESERVED") ?? compoundSets[0];
  return raceStartTyreInventory(carId, source).map((set) => ({
    id: set.id,
    compound: set.compound,
    status: set.id === fitted.id ? "FITTED" : set.freshness === "USED" ? "USED" : "AVAILABLE",
    condition: set.condition,
    lapsUsed: set.lapsUsed,
  } satisfies TyreSetState));
}

/**
 * Reserves a set for the next stop. Passing `tyreSetId` fits that exact set, so
 * the pit wall can take a scrubbed set deliberately; without it the freshest
 * usable set of the compound is chosen.
 */
function reserveTyreSet(car: RaceCarState, compound: TyreCompound, tyreSetId?: string): RaceCarState {
  const released = car.tyreSets.map((set) => set.status === "RESERVED" ? { ...set, status: "AVAILABLE" as const } : set);
  const usable = released.filter((set) => set.compound === compound && (set.status === "AVAILABLE" || set.status === "USED"));
  const candidate = (tyreSetId ? usable.find((set) => set.id === tyreSetId) : undefined)
    ?? [...usable].sort((a, b) => b.condition - a.condition)[0];
  if (!candidate) return { ...car, tyreSets: released, scheduledPitCompound: null, scheduledPitTyreSetId: null };
  return {
    ...car,
    tyreSets: released.map((set) => set.id === candidate.id ? { ...set, status: "RESERVED" as const } : set),
    scheduledPitCompound: compound,
    scheduledPitTyreSetId: candidate.id,
  };
}

function releaseReservedTyreSet(car: RaceCarState): RaceCarState {
  return {
    ...car,
    tyreSets: car.tyreSets.map((set) => set.status === "RESERVED" ? { ...set, status: "AVAILABLE" as const } : set),
    scheduledPitCompound: null,
    scheduledPitTyreSetId: null,
  };
}

function createCar(
  driverId: string,
  index: number,
  seed: number,
  playerTeamId: string,
  startingTyre: TyreCompound,
  weekendTyreUsage?: WeekendTyreUsage,
  setupPerformanceByCar?: Readonly<Record<string, number>>,
  weekendTyreInventory?: WeekendTyreInventory,
): RaceCarState {
  const driver = DRIVER_BY_ID.get(driverId);
  if (!driver) throw new Error(`Unknown driver: ${driverId}`);

  // A compact single-file presentation keeps all 22 cars on Hamilton Straight.
  // The visual game map intentionally uses one line rather than the real
  // staggered two-column boxes requested for this prototype.
  const startingDistance = index === 0 ? 0 : -index * 6.8;
  const segmentIndex = segmentIndexAtDistance(startingDistance);
  const segment = SILVERSTONE_CIRCUIT.segments[segmentIndex];
  const lapDistance = normalizeLapDistance(startingDistance);

  const tyreCompound = startingTyre;
  const tyreSets = createTyreSets(driver.id, tyreCompound, weekendTyreUsage?.[driver.id], weekendTyreInventory);
  const activeTyreSet = tyreSets.find((set) => set.status === "FITTED")!;
  const activeTyreSetId = activeTyreSet.id;
  const initialSoc = (72 + (index % 4) * 4) / 100;
  const energySystem = createEnergySystemState(initialSoc, 43);

  return {
    carId: driver.id,
    teamId: driver.teamId,
    driverId: driver.id,
    currentLap: 1,
    currentSegment: segmentIndex,
    segmentProgress: (lapDistance - segment.startDistance) / segment.length,
    lapDistance,
    totalDistance: startingDistance,
    totalRaceTime: 0,
    currentSpeed: 0,
    reactionTime: 0.18 + (index % 8) * 0.017,
    gridPosition: index + 1,
    racePosition: index + 1,
    racingLineMode: "GRID",
    trackLineOffset: 0,
    gapToLeader: index * 0.18,
    gapToCarAhead: index === 0 ? 0 : 0.18,
    gapToCarBehind: index === DRIVERS.length - 1 ? 0 : 0.18,
    tyreCompound,
    tyreAgeLaps: activeTyreSet.lapsUsed,
    tyreLife: activeTyreSet.condition,
    tyreTemperatures: uniformTyreTemperatures(88),
    tyreTemperature: 88,
    tyreSets,
    activeTyreSetId,
    scheduledPitTyreSetId: null,
    brakeTemperatures: uniformTyreTemperatures(480),
    brakeTemperature: 480,
    powerUnitTemperature: 98,
    gearboxTemperature: 86,
    energyStoreTemperature: 43,
    coolingMode: "NORMAL",
    brakeBiasPercent: 56.5,
    powerUnitStress: 0,
    gearboxStress: 0,
    energyStoreStress: 0,
    brakeStress: 0,
    thermalDeratePercent: 0,
    thermalRiskPercent: 0,
    fuelRemainingKg: 105,
    setupPerformanceFactor: clamp(setupPerformanceByCar?.[driver.id] ?? 1, 0.996, 1),
    eventPerformanceFactor: 1 + signedNoise(seed, 88_000 + driver.number, 0) * 0.0032,
    paceMode: "STANDARD",
    tyreMode: "BALANCED",
    energyMode: "BALANCED",
    energyAutoEnabled: driver.teamId !== playerTeamId,
    energyState: "NEUTRAL",
    energySystem,
    batteryPercent: energySystem.stateOfCharge * 100,
    activeAeroMode: "CORNER",
    overtakeEligible: false,
    overtakeActive: false,
    boostActive: false,
    battleStatus: "CLEAR",
    battleCarId: null,
    dirtyAirLoss: 0,
    overtakes: 0,
    lastOvertakeAt: null,
    overtakeOpponentTimes: {},
    pendingOvertake: null,
    pitStatus: "TRACK",
    pitSpeedingEvidence: null,
    pitLimiterFaultSeconds: 0,
    pitLaneTimer: 0,
    pitTimer: 0,
    pitStopTargetSeconds: PIT_STOP_DURATION,
    lastPitStopTime: null,
    lastPitStopCompletedAt: null,
    lastPitLaneTime: null,
    pitStopIssue: "NONE",
    pitStops: 0,
    scheduledPitCompound: null,
    usedTyreCompounds: [tyreCompound],
    strategyIntent: "HOLD",
    strategyConfidence: 0.5,
    incidentStatus: "RUNNING",
    incidentTimer: 0,
    incidentStartedAt: null,
    incidentDirection: index % 2 === 0 ? 1 : -1,
    lastIncidentAt: null,
    damageLevel: 0,
    retiredReason: null,
    vscDeltaSeconds: 0,
    vscViolationSeconds: 0,
    vscComplianceStatus: "COMPLIANT",
    vscViolationCount: 0,
    trackLimitsWarnings: 0,
    blueFlagActive: false,
    blueFlagSeconds: 0,
    blueFlagWarnings: 0,
    penaltyServiceId: null,
    penaltyServiceIds: [],
    penaltyServiceType: null,
    pitServicePhase: "NONE",
    penaltyHoldSeconds: 0,
    penaltyHoldElapsedSeconds: 0,
    pitTyreServiceTargetSeconds: PIT_STOP_DURATION,
    pitTyreServiceElapsedSeconds: 0,
    lastPenaltyHoldSeconds: 0,
    lastPenaltyServedAt: null,
    servePenaltyRequested: false,
    safetyCarQueuePosition: null,
    safetyCarGapToTargetMeters: null,
    currentSector: 1,
    currentLapTime: 0,
    currentSectorTime: 0,
    lapStartedAt: 0,
    sectorStartedAt: 0,
    sectorTimes: [null, null, null],
    lastLapTime: null,
    bestLapTime: null,
    lastLapSectorTimes: [null, null, null],
    finished: false,
    finishTime: null,
  };
}

export function createInitialSnapshot(
  seed = DEFAULT_SEED,
  status: RaceStatus = "PAUSED",
  requestedGridOrder?: readonly string[],
  weekendTyreUsage?: WeekendTyreUsage,
  setupPerformanceByCar?: Readonly<Record<string, number>>,
  playerTeamId = DEFAULT_PLAYER_TEAM_ID,
  weekendTyreInventory?: WeekendTyreInventory,
): RaceSnapshot {
  if (!TEAM_BY_ID.has(playerTeamId)) throw new RangeError(`Unknown player team: ${playerTeamId}.`);
  const knownCars = new Set(DRIVERS.map((driver) => driver.id));
  const validGrid = requestedGridOrder?.length === DRIVERS.length
    && new Set(requestedGridOrder).size === DRIVERS.length
    && requestedGridOrder.every((carId) => knownCars.has(carId));
  const gridOrder = validGrid ? requestedGridOrder : DRIVERS.map((driver) => driver.id);
  const weather = createSpatialWeather(seed);
  const startingTyrePlan = buildRaceStartingTyrePlan({ seed, gridOrder, tyreUsage: weekendTyreUsage, weather });
  const cars = gridOrder.map((driverId, index) => createCar(driverId, index, seed, playerTeamId, startingTyrePlan[driverId].compound, weekendTyreUsage, setupPerformanceByCar, weekendTyreInventory));
  return {
    seed,
    playerTeamId,
    tick: 0,
    elapsedTime: 0,
    status,
    weather,
    raceControl: "GREEN",
    raceControlTimer: 0,
    yellowSector: null,
    redFlagPhase: "NONE",
    redFlagTimerSeconds: 0,
    redFlagRestartType: "STANDING",
    redFlagOrder: [],
    redFlagDeployments: 0,
    safetyCarPhase: "NONE",
    safetyCarPhaseElapsedSeconds: 0,
    safetyCarDistance: null,
    safetyCarSpeed: 0,
    safetyCarFieldBunched: false,
    safetyCarInPitLane: false,
    safetyCarDeploymentDistance: null,
    safetyCarTargetLaps: 1,
    safetyCarEndingStartDistance: null,
    safetyCarPitEntryDistance: null,
    safetyCarRestartLineDistance: null,
    safetyCarLappedCarsMayOvertake: false,
    safetyCarWaveBy: [],
    safetyCarDeployments: 0,
    scheduledSafetyCarDistance: scheduledSafetyCarTriggerDistance(seed),
    pitLaneOpen: true,
    pitLaneStatus: "OPEN",
    activeIncident: null,
    teamOrder: { type: "NONE", issuedAt: 0, leadCarId: null, trailingCarId: null },
    stewardStrictness: "BALANCED",
    investigations: [],
    penalties: [],
    events: [],
    radioMessages: [],
    cars,
    checksum: checksumFor(0, cars, weather),
  };
}

function surfaceGrip(compound: TyreCompound, wetness: number): number {
  if (compound === "INTERMEDIATE") return Math.max(0.82, 0.91 + Math.min(wetness, 0.58) * 0.22 - Math.max(0, wetness - 0.72) * 0.2);
  if (compound === "WET") return Math.max(0.78, 0.84 + Math.min(1, wetness) * 0.24);
  return Math.max(0.48, 1 - wetness * 0.55);
}

function targetSpeedKph(car: RaceCarState, index: number, seed: number, tick: number, trackWetness: number): number {
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  if (!driver || !team) return 100;

  const segment = SILVERSTONE_CIRCUIT.segments[car.currentSegment];
  const formWave = Math.sin((tick * FIXED_STEP_SECONDS + index * 1.37) / 7.5) * 0.006;
  const stableNoise = signedNoise(seed, index, Math.floor(tick / 8)) * (0.004 / driver.consistency);
  const temperatureGrip = Math.max(0.94, 1 - Math.abs(car.tyreTemperature - 100) * 0.00145);
  const wearGrip = car.tyreLife >= 35 ? 1 : Math.max(0.91, 1 - (35 - car.tyreLife) * 0.0026);
  const fuelWeight = 1 + Math.max(0, 105 - car.fuelRemainingKg) * 0.00017;
  const slipstream = segment.kind === "STRAIGHT" && car.gapToCarAhead > 0 && car.gapToCarAhead < 1.05 ? 1.009 : 1;
  const attackBoost = car.racingLineMode === "ATTACK" ? 1.002 : 1;
  const energySystem = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
  const deployContribution = energySystem.currentDeployPowerKW / ENERGY_SYSTEM_CONFIG.maxDeployPowerKW * 0.0135;
  const recoveryDrag = energySystem.currentHarvestPowerKW / ENERGY_SYSTEM_CONFIG.maxHarvestPowerKW * 0.0035;
  const energyBoost = Math.max(0.972, Math.min(1.016, 1 + deployContribution - recoveryDrag - (energySystem.clippingActive ? 0.008 : 0)));
  const energyModeSpeed = ENERGY_MODE_SPEED[energySystem.deploymentMode];
  const lowEnergyPenalty = energySystem.stateOfCharge <= ENERGY_SYSTEM_CONFIG.minimumUsableSoc + 0.01 ? 0.994 : 1;
  const dirtyAirFactor = 1 - car.dirtyAirLoss;
  const performance = team.performance * driver.pace * PACE_SPEED[car.paceMode] * TYRE_SPEED[car.tyreMode]
    * COMPOUND_SPEED[car.tyreCompound] * surfaceGrip(car.tyreCompound, trackWetness) * temperatureGrip * wearGrip * fuelWeight
    * slipstream * attackBoost * energyBoost * energyModeSpeed * lowEnergyPenalty * dirtyAirFactor * COOLING_SPEED[car.coolingMode ?? "NORMAL"]
    * thermalPerformanceFactor(car) * (car.setupPerformanceFactor ?? 1) * (car.eventPerformanceFactor ?? 1) * (1 + formWave + stableNoise);
  const telemetryTarget = telemetrySpeedAtDistance(car.lapDistance);
  return Math.max(65, telemetryTarget * performance);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Cadence of routine driver/engineer calls. Player cars are staggered by half
 * this interval, so the team hears one routine call about every 1100 ticks.
 */
export const OPERATIONAL_RADIO_INTERVAL_TICKS = 2_200;

function buildOperationalRadio(
  cars: readonly RaceCarState[],
  tick: number,
  elapsedTime: number,
  playerTeamId: string,
  seed: number,
  weather: WeatherState,
  previousCars: readonly RaceCarState[] = [],
): RadioMessage[] {
  /*
   * Routine driver/engineer calls are deliberately sparse. Two player cars are
   * staggered by half the interval, so this yields one routine call roughly every
   * 1100 ticks across the team rather than a constant stream. Urgent Race
   * Control, pit and thermal transitions remain event-driven elsewhere.
   */
  const intervalTicks = OPERATIONAL_RADIO_INTERVAL_TICKS;
  const playerCars = cars.filter((car) => car.teamId === playerTeamId);
  const messages: RadioMessage[] = [];

  playerCars.forEach((car, index) => {
    if ((tick + index * Math.floor(intervalTicks / 2)) % intervalTicks !== 0 || car.finished || car.incidentStatus === "RETIRED") return;
    const driver = DRIVER_BY_ID.get(car.driverId);
    if (!driver) return;
    const carIndex = Math.max(0, DRIVERS.findIndex((candidate) => candidate.id === car.carId));
    const hotTyre = Math.max(car.tyreTemperatures.frontLeft, car.tyreTemperatures.frontRight, car.tyreTemperatures.rearLeft, car.tyreTemperatures.rearRight);
    const coldTyre = Math.min(car.tyreTemperatures.frontLeft, car.tyreTemperatures.frontRight, car.tyreTemperatures.rearLeft, car.tyreTemperatures.rearRight);
    const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const normalizedDistance = normalizeLapDistance(car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const surfaceZones = weather.surfaceZones ?? [];
    const localZone = surfaceZones.length
      ? surfaceZones[Math.min(surfaceZones.length - 1, Math.floor((normalizedDistance / SILVERSTONE_CIRCUIT.lengthMeters) * surfaceZones.length))]
      : undefined;
    const localRain = localZone?.rainIntensity ?? weather.rainIntensity;
    const dryingLine = localZone?.dryingLine ?? Math.max(0, 1 - localWater);
    const onDryTyre = DRY_COMPOUNDS.includes(car.tyreCompound);
    const onWetWeatherTyre = car.tyreCompound === "INTERMEDIATE" || car.tyreCompound === "WET";

    /*
     * Situational judgement for the radio. Each of these reads live state the
     * driver would actually notice, so the call that comes out matches what is
     * happening rather than cycling a fixed rota.
     */
    const previous = previousCars.find((candidate) => candidate.carId === car.carId);
    const positionChange = previous ? previous.racePosition - car.racePosition : 0;
    const carAhead = cars.find((candidate) => candidate.racePosition === car.racePosition - 1);
    // Being held up by a car that is genuinely slower, not simply defending well.
    const heldUpBySlowerCar = Boolean(carAhead
      && car.gapToCarAhead > 0 && car.gapToCarAhead < 1.6
      && car.tyreLife > carAhead.tyreLife + 14);
    const stuckInTraffic = car.gapToCarAhead > 0 && car.gapToCarAhead < 2.2 && car.gapToCarBehind < 2.2 && car.racePosition > 4;
    // The tyre is past its useful life and no stop has been called yet.
    const tyreCallOverdue = car.tyreLife < 22 && !car.scheduledPitCompound && car.pitStatus === "TRACK";
    // Rain in the air before it reaches the surface.
    const rainOnVisor = localRain >= 0.02 && localRain < 0.045 && localWater < 0.05;
    const finalLaps = car.currentLap >= SILVERSTONE_CIRCUIT.totalLaps - 2;
    const strategyWorking = positionChange === 0 && car.pitStops > 0 && car.tyreLife > 68 && car.racePosition <= 6;
    const strategyDoubt = car.pitStops > 0 && car.tyreLife < 45 && car.racePosition > 10;
    const carFeelsGood = car.tyreLife > 76 && car.dirtyAirLoss < 0.002 && car.gapToCarAhead > 3.5;
    const lackingPace = car.gapToCarAhead > 4 && car.gapToCarBehind > 4 && car.racePosition > 12;

    let source: RadioMessage["source"] = "ENGINEER";
    let priority: RadioMessage["priority"] = "NORMAL";
    let message: string;

    /*
     * Anything the driver is reacting to gets the short, emotional call; only the
     * routine reports lower down build a full sentence.
     */
    if (localWater >= 0.52) {
      source = "DRIVER";
      priority = "URGENT";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "AQUAPLANING", intensity: "HIGH" });
    } else if (onDryTyre && localWater >= 0.2) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "WET_GRIP", intensity: "HIGH" });
    } else if (onWetWeatherTyre && localWater <= 0.12 && dryingLine >= 0.48) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "DRYING_LINE", intensity: "HIGH" });
    } else if (onWetWeatherTyre && (localWater >= 0.24 || localRain >= 0.12)) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "RAIN_RUNNING", metric: `wet running in sector ${car.currentSector}` });
    } else if (localRain >= 0.045 && localWater < 0.14) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "RAIN_STARTING", intensity: "HIGH" });
    } else if (localWater >= 0.1 && localWater < 0.3) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "INTER_CROSSOVER", intensity: "HIGH" });
    } else if (car.tyreLife < 28) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "TYRE_WEAR", intensity: "HIGH" });
    } else if (hotTyre > 112) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "TYRE_HOT", intensity: "HIGH" });
    } else if (coldTyre < 82 && car.currentLap > 1) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "TYRE_COLD", metric: `coldest corner ${Math.round(coldTyre)} degrees` });
    } else if (car.paceMode === "ATTACK" && (car.tyreLife < 72 || car.batteryPercent < 32)) {
      source = "DRIVER";
      priority = "WARNING";
      message = car.batteryPercent < 32
        ? buildRaceDriverRadio({ seed, tick, carIndex, situation: "ATTACK_ENERGY", intensity: "HIGH" })
        : buildRaceDriverRadio({ seed, tick, carIndex, situation: "ATTACK_TYRE", intensity: "HIGH" });
    } else if (car.batteryPercent < 18) {
      message = `Energy is low at ${Math.round(car.batteryPercent)} percent. Recharge through the next technical section.`;
    } else if (car.dirtyAirLoss > 0.006 || (car.gapToCarAhead > 0 && car.gapToCarAhead < 1.1)) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "DIRTY_AIR", intensity: "HIGH" });
    } else if (positionChange < 0) {
      // Overtaken since the last routine call.
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "POSITION_LOST", intensity: "HIGH" });
    } else if (positionChange > 0) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "POSITION_GAINED", intensity: "HIGH" });
    } else if (heldUpBySlowerCar) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "SLOW_CAR_AHEAD", intensity: "HIGH" });
    } else if (stuckInTraffic) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "TRAFFIC_FRUSTRATION", intensity: "HIGH" });
    } else if (tyreCallOverdue) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "PIT_CALL_LATE", intensity: "HIGH" });
    } else if (rainOnVisor) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "FIRST_DROPS", intensity: "HIGH" });
    } else if (finalLaps) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "FINAL_LAPS_PUSH", intensity: "HIGH" });
    } else if (strategyWorking) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "STRATEGY_APPROVAL", intensity: "HIGH" });
    } else if (strategyDoubt) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "STRATEGY_DOUBT", intensity: "HIGH" });
    } else if (carFeelsGood) {
      source = "DRIVER";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "CAR_HAPPY", intensity: "HIGH" });
    } else if (lackingPace) {
      source = "DRIVER";
      priority = "WARNING";
      message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "PACE_COMPLAINT", intensity: "HIGH" });
    } else {
      const situation = (Math.floor(tick / intervalTicks) + index) % 4;
      if (situation === 0) {
        message = car.racePosition === 1
          ? `You are leading. Keep the tyre phase controlled; no need to overwork the exits.`
          : `Gap ahead ${car.gapToCarAhead.toFixed(3)}. Build the run through Maggotts and prioritise the Hangar exit.`;
      } else if (situation === 1) {
        source = "DRIVER";
        message = buildRaceDriverRadio({ seed, tick, carIndex, situation: "BALANCE", metric: `tyre life ${Math.round(car.tyreLife)} percent` });
      } else if (situation === 2) {
        message = `Tyre life ${Math.round(car.tyreLife)} percent, energy ${Math.round(car.batteryPercent)} percent. Current pace is sustainable.`;
      } else {
        source = "DRIVER";
        const underPressure = car.gapToCarBehind < 1.2;
        message = buildRaceDriverRadio({
          seed,
          tick,
          carIndex,
          situation: underPressure ? "DEFENDING" : "STABLE",
          // Being attacked is a reaction; cruising in clear air is a report.
          intensity: underPressure ? "HIGH" : undefined,
          metric: underPressure ? undefined : `position P${car.racePosition}`,
        });
      }
    }

    messages.push({
      id: `${tick}-${car.carId}-operations-radio`,
      elapsedTime,
      carId: car.carId,
      source,
      message,
      priority,
    });
  });
  return messages;
}

function rainIntensityAtCar(weather: WeatherState, lapDistance: number): number {
  const zones = weather.surfaceZones;
  if (!zones?.length) return weather.rainIntensity;
  const normalized = normalizeLapDistance(lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
  const index = Math.min(zones.length - 1, Math.floor((normalized / SILVERSTONE_CIRCUIT.lengthMeters) * zones.length));
  return zones[index]?.rainIntensity ?? weather.rainIntensity;
}

/** Immediate, threshold-based driver reports for changing local rain conditions. */
export function buildWeatherTransitionRadio(
  previousWeather: WeatherState,
  weather: WeatherState,
  cars: readonly RaceCarState[],
  previousMessages: readonly RadioMessage[],
  tick: number,
  elapsedTime: number,
  playerTeamId: string,
  seed: number,
): RadioMessage[] {
  const recentCall = previousMessages.find((message) => (
    message.id.includes("weather-transition")
    && elapsedTime - message.elapsedTime < 55
  ));
  const playerCars = cars.filter((car) => car.teamId === playerTeamId && !car.finished && car.incidentStatus !== "RETIRED" && car.pitStatus === "TRACK");
  const sectorRain = weather.sectors?.map((sector) => sector.rainIntensity) ?? [weather.rainIntensity];
  const rainSpread = Math.max(...sectorRain) - Math.min(...sectorRain);
  const candidates = playerCars.flatMap((car) => {
    const previousRain = rainIntensityAtCar(previousWeather, car.lapDistance);
    const localRain = rainIntensityAtCar(weather, car.lapDistance);
    const previousWater = effectiveWaterAtDistance(previousWeather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const carIndex = Math.max(0, DRIVERS.findIndex((candidate) => candidate.id === car.carId));
    let situation: Parameters<typeof buildRaceDriverRadio>[0]["situation"] | null = null;
    let priority: RadioMessage["priority"] = "WARNING";
    let score = 0;

    if (previousWater < 0.45 && localWater >= 0.5) {
      situation = "AQUAPLANING";
      priority = "URGENT";
      score = 6;
    } else if (previousRain < 0.48 && localRain >= 0.58) {
      situation = "RAIN_INTENSIFYING";
      priority = "URGENT";
      score = 5;
    } else if ((previousRain < 0.2 && localRain >= 0.2) || localRain - previousRain >= 0.075) {
      situation = "RAIN_INTENSIFYING";
      score = 4;
    } else if (previousRain < 0.025 && localRain >= 0.04) {
      situation = "RAIN_STARTING";
      score = 3;
    } else if (previousRain >= 0.13 && localRain < 0.07) {
      situation = "RAIN_EASING";
      score = 2;
    } else if (rainSpread >= 0.24 && localRain >= Math.max(...sectorRain) - 0.04 && previousRain < localRain) {
      situation = "LOCAL_SHOWER";
      score = 1;
    }
    if (!situation) return [];
    const metric = `sector ${car.currentSector}, rain ${Math.round(localRain * 100)} percent, surface water ${Math.round(localWater * 100)} percent`;
    return [{
      car,
      score,
      priority,
      message: buildRaceDriverRadio({ seed, tick, carIndex, situation, metric }),
    }];
  }).sort((left, right) => right.score - left.score);

  const selected = candidates[0];
  if (!selected || (recentCall && selected.priority !== "URGENT")) return [];
  if (recentCall && selected.priority === "URGENT" && elapsedTime - recentCall.elapsedTime < 24) return [];
  return [{
    id: `${tick}-${selected.car.carId}-weather-transition`,
    elapsedTime,
    carId: selected.car.carId,
    source: "DRIVER",
    message: selected.message,
    priority: selected.priority,
  }];
}

interface CornerThermalLoad {
  intensity: number;
  hotterSide: "LEFT" | "RIGHT" | null;
}

/**
 * Samples the centreline either side of the car. The signed cross product
 * identifies the outside tyres without baking Silverstone's corner sequence
 * into the thermal model.
 */
function cornerThermalLoadAtDistance(distanceMeters: number): CornerThermalLoad {
  const sampleRadiusMeters = 32;
  const before = pointAtDistance(distanceMeters - sampleRadiusMeters);
  const centre = pointAtDistance(distanceMeters);
  const after = pointAtDistance(distanceMeters + sampleRadiusMeters);
  const incomingX = centre.x - before.x;
  const incomingY = centre.y - before.y;
  const outgoingX = after.x - centre.x;
  const outgoingY = after.y - centre.y;
  const cross = incomingX * outgoingY - incomingY * outgoingX;
  const dot = incomingX * outgoingX + incomingY * outgoingY;
  const signedAngle = Math.atan2(cross, dot);
  const intensity = clamp(Math.abs(signedAngle) / 0.24, 0, 1);
  if (intensity < 0.025) return { intensity: 0, hotterSide: null };
  // A positive screen-space turn loads the left side of the car; a negative
  // turn loads the right. Only the relative outside/inside split matters.
  return { intensity, hotterSide: signedAngle > 0 ? "LEFT" : "RIGHT" };
}

interface TyreThermalContext {
  previousSpeedKph: number;
  currentSpeedKph: number;
  lapDistance: number;
  localWater: number;
  rainIntensity: number;
  airTemperature: number;
  trackTemperature: number;
  pitStatus: RaceCarState["pitStatus"];
}

function advanceTyreTemperatures(
  car: RaceCarState,
  temperatures: TyreTemperatureState,
  compound: TyreCompound,
  context: TyreThermalContext,
): TyreTemperatureState {
  const segment = SILVERSTONE_CIRCUIT.segments[segmentIndexAtDistance(context.lapDistance)];
  const water = clamp(context.localWater, 0, 1);
  const speed = Math.max(0, context.currentSpeedKph);
  const brakingRate = Math.max(0, context.previousSpeedKph - speed) / FIXED_STEP_SECONDS;
  const tractionRate = Math.max(0, speed - context.previousSpeedKph) / FIXED_STEP_SECONDS;
  const corner = cornerThermalLoadAtDistance(context.lapDistance);

  const climateOffset = (context.trackTemperature - 31) * 0.22 + (context.airTemperature - 22) * 0.1;
  const segmentOffset = segment.kind === "FAST" ? 2.5 : segment.kind === "MEDIUM" ? 1 : segment.kind === "SLOW" ? -0.5 : -2.5;
  const speedHeat = clamp((speed - 170) * 0.025, -3.5, 4.5);
  const wetCompound = compound === "INTERMEDIATE" || compound === "WET";
  const treadDryHeat = compound === "WET" ? (1 - water) * 13 : compound === "INTERMEDIATE" ? (1 - water) * 8 : 0;
  const waterCooling = wetCompound
    ? water * (compound === "WET" ? 3 + speed * 0.006 : 5 + speed * 0.009)
    : water * (14 + speed * 0.02);
  const precipitationCooling = clamp(context.rainIntensity, 0, 1) * (wetCompound ? 1.2 : 2.8);
  const baseTarget = PACE_TEMPERATURE[car.paceMode]
    + COMPOUND_TEMPERATURE[compound]
    + TYRE_MODE_TEMPERATURE[car.tyreMode]
    + climateOffset
    + segmentOffset
    + speedHeat
    + treadDryHeat
    - waterCooling
    - precipitationCooling;

  const brakingHeat = clamp(brakingRate * 0.035, 0, 9.5);
  const tractionHeat = clamp(tractionRate * 0.028, 0, 7.5);
  const cornerHeat = corner.intensity * (3.2 + speed * 0.025) * (1 - water * 0.48);
  const outsideHeat = cornerHeat;
  const insideHeat = -cornerHeat * 0.34;
  const leftCornerOffset = corner.hotterSide === "LEFT" ? outsideHeat : corner.hotterSide === "RIGHT" ? insideHeat : 0;
  const rightCornerOffset = corner.hotterSide === "RIGHT" ? outsideHeat : corner.hotterSide === "LEFT" ? insideHeat : 0;
  const deploymentRearHeat = car.energyState === "DEPLOYING" || car.energyState === "OVERTAKE" || car.energyState === "DEFENDING" ? 1.8 : 0;

  let targets: TyreTemperatureState = {
    frontLeft: baseTarget + brakingHeat + tractionHeat * 0.2 + leftCornerOffset,
    frontRight: baseTarget + brakingHeat + tractionHeat * 0.2 + rightCornerOffset,
    rearLeft: baseTarget + brakingHeat * 0.32 + tractionHeat + deploymentRearHeat + leftCornerOffset * 0.88,
    rearRight: baseTarget + brakingHeat * 0.32 + tractionHeat + deploymentRearHeat + rightCornerOffset * 0.88,
  };

  const stoppedInBox = context.pitStatus === "PIT_STOP";
  if (stoppedInBox) {
    const stationaryTarget = Math.max(context.airTemperature + 13, context.trackTemperature + 8);
    targets = uniformTyreTemperatures(stationaryTarget);
  }

  const pitLaneFactor = context.pitStatus === "TRACK" ? 1 : stoppedInBox ? 0.16 : 0.52;
  const wetResponse = 1 + water * 0.55;
  const modeResponse = car.tyreMode === "GRIP" ? 1.08 : car.tyreMode === "SAVE" ? 0.93 : 1;
  const responsePerSecond = 0.12 * COMPOUND_THERMAL_RESPONSE[compound] * pitLaneFactor * wetResponse * modeResponse;
  const blend = 1 - Math.exp(-responsePerSecond * FIXED_STEP_SECONDS);
  const advance = (current: number, target: number) => clamp(current + (clamp(target, TYRE_TEMPERATURE_MIN, TYRE_TEMPERATURE_MAX) - current) * blend, TYRE_TEMPERATURE_MIN, TYRE_TEMPERATURE_MAX);

  return {
    frontLeft: advance(temperatures.frontLeft, targets.frontLeft),
    frontRight: advance(temperatures.frontRight, targets.frontRight),
    rearLeft: advance(temperatures.rearLeft, targets.rearLeft),
    rearRight: advance(temperatures.rearRight, targets.rearRight),
  };
}

interface PowerUnitThermalContext {
  previousSpeedKph: number;
  currentSpeedKph: number;
  lapDistance: number;
  localWater: number;
  rainIntensity: number;
  airTemperature: number;
  trackTemperature: number;
  pitStatus: RaceCarState["pitStatus"];
}

interface PowerUnitThermalState {
  powerUnitTemperature: number;
  gearboxTemperature: number;
  energyStoreTemperature: number;
}

const PACE_THERMAL_LOAD: Record<PaceMode, number> = {
  ATTACK: 1,
  PUSH: 0.82,
  STANDARD: 0.58,
  CONSERVE: 0.34,
  COOL: 0.14,
};

/**
 * Advances the three power-unit thermal systems from deterministic vehicle
 * state only. Targets describe heat generation, while the exponential blend
 * gives each system a different amount of thermal inertia.
 */
function advancePowerUnitTemperatures(
  car: RaceCarState,
  current: PowerUnitThermalState,
  context: PowerUnitThermalContext,
): PowerUnitThermalState {
  const speedLoad = clamp(context.currentSpeedKph / 325, 0, 1);
  const accelerationKphPerSecond = (context.currentSpeedKph - context.previousSpeedKph) / FIXED_STEP_SECONDS;
  const accelerationLoad = clamp(Math.max(0, accelerationKphPerSecond) / 70, 0, 1);
  const shiftLoad = clamp(Math.abs(accelerationKphPerSecond) / 85, 0, 1);
  const segment = SILVERSTONE_CIRCUIT.segments[segmentIndexAtDistance(context.lapDistance)];
  const segmentLoad = segment.kind === "STRAIGHT" ? 1 : segment.kind === "FAST" ? 0.82 : segment.kind === "MEDIUM" ? 0.58 : 0.4;
  const paceLoad = PACE_THERMAL_LOAD[car.paceMode];
  const energyLoad = car.energyState === "OVERTAKE"
    ? 1
    : car.energyState === "DEFENDING"
      ? 0.9
      : car.energyState === "DEPLOYING"
        ? 0.78
        : car.energyState === "HARVESTING" ? 0.58 : 0.18;
  const pitLoad = context.pitStatus === "TRACK" ? 1 : context.pitStatus === "PIT_STOP" ? 0.08 : 0.42;
  const climateHeat = (context.airTemperature - 20) * 0.24 + (context.trackTemperature - 30) * 0.055;
  const wetCooling = clamp(context.localWater, 0, 1) * (5 + speedLoad * 10)
    + clamp(context.rainIntensity, 0, 1) * 3.5;
  const damageHeat = clamp(car.damageLevel, 0, 1);
  const coolingMode = car.coolingMode ?? "NORMAL";
  const coolingLoadFactor = coolingMode === "MAX_COOLING" ? 0.62 : coolingMode === "LIFT_AND_COAST" ? 0.8 : 1;
  const coolingOffset = coolingMode === "MAX_COOLING" ? 10 : coolingMode === "LIFT_AND_COAST" ? 5 : 0;

  const powerUnitTarget = 77
    + pitLoad * coolingLoadFactor * (18 * paceLoad + 13 * speedLoad + 7 * accelerationLoad + 5 * segmentLoad + 5 * energyLoad)
    + climateHeat
    + damageHeat * 20
    - wetCooling
    - coolingOffset;
  const gearboxTarget = 61
    + pitLoad * coolingLoadFactor * (13 * paceLoad + 15 * speedLoad + 9 * shiftLoad + 8 * (1 - segmentLoad) + 3 * energyLoad)
    + climateHeat * 0.7
    + damageHeat * 16
    - wetCooling * 0.72
    - coolingOffset * 0.72;
  const energyStoreTarget = Math.max(context.airTemperature + 9, 29
    + pitLoad * coolingLoadFactor * (5 * paceLoad + 4 * speedLoad + 25 * energyLoad)
    + (context.airTemperature - 20) * 0.32
    + damageHeat * 10
    - wetCooling * 0.32
    - coolingOffset * 0.38);

  const advance = (value: number, target: number, responsePerSecond: number, minimum: number, maximum: number) => {
    const safeValue = Number.isFinite(value) ? clamp(value, minimum, maximum) : clamp(target, minimum, maximum);
    const blend = 1 - Math.exp(-responsePerSecond * FIXED_STEP_SECONDS);
    return clamp(safeValue + (clamp(target, minimum, maximum) - safeValue) * blend, minimum, maximum);
  };

  return {
    powerUnitTemperature: advance(current.powerUnitTemperature, powerUnitTarget, 0.052, POWER_UNIT_TEMPERATURE_MIN, POWER_UNIT_TEMPERATURE_MAX),
    gearboxTemperature: advance(current.gearboxTemperature, gearboxTarget, 0.061, GEARBOX_TEMPERATURE_MIN, GEARBOX_TEMPERATURE_MAX),
    energyStoreTemperature: advance(current.energyStoreTemperature, energyStoreTarget, 0.09, ENERGY_STORE_TEMPERATURE_MIN, ENERGY_STORE_TEMPERATURE_MAX),
  };
}

function withPositionData(car: RaceCarState): RaceCarState {
  const lapDistance = normalizeLapDistance(car.totalDistance);
  const currentSegment = segmentIndexAtDistance(lapDistance);
  const segment = SILVERSTONE_CIRCUIT.segments[currentSegment];
  const currentLap = Math.min(SILVERSTONE_CIRCUIT.totalLaps, Math.max(1, Math.floor(car.totalDistance / SILVERSTONE_CIRCUIT.lengthMeters) + 1));
  return {
    ...car,
    currentLap,
    currentSegment,
    segmentProgress: Math.max(0, Math.min(1, (lapDistance - segment.startDistance) / segment.length)),
    lapDistance,
  };
}

function rankCars(cars: readonly RaceCarState[], raceControl: RaceControlStatus): RaceCarState[] {
  const ordered = [...cars].sort((a, b) => {
    const aCompleted = a.finishTime !== null;
    const bCompleted = b.finishTime !== null;
    const aRetired = a.incidentStatus === "RETIRED";
    const bRetired = b.incidentStatus === "RETIRED";
    if (aCompleted && bCompleted) return a.finishTime! - b.finishTime!;
    if (aCompleted) return -1;
    if (bCompleted) return 1;
    if (aRetired && bRetired) return b.totalDistance - a.totalDistance;
    if (aRetired) return 1;
    if (bRetired) return -1;
    return b.totalDistance - a.totalDistance;
  });

  const leader = ordered[0];
  const averageLeaderSpeedMps = Math.max(1, leader.currentSpeed / 3.6);
  const updates = new Map<string, Pick<RaceCarState, "racePosition" | "gapToLeader" | "gapToCarAhead" | "gapToCarBehind" | "racingLineMode" | "trackLineOffset" | "battleStatus" | "battleCarId">>();

  ordered.forEach((car, index) => {
    const ahead = ordered[index - 1];
    const behind = ordered[index + 1];
    const distanceAhead = ahead ? ahead.totalDistance - car.totalDistance : Infinity;
    const distanceBehind = behind ? car.totalDistance - behind.totalDistance : Infinity;
    const speedReference = Math.max(20, ahead?.currentSpeed ?? 0, car.currentSpeed) / 3.6;
    const gapAhead = ahead ? Math.max(0, distanceAhead / speedReference) : 0;
    const gapBehind = behind ? Math.max(0, distanceBehind / (Math.max(20, car.currentSpeed, behind.currentSpeed) / 3.6)) : 0;
    let racingLineMode: RacingLineMode = "RACING";
    let battleStatus: BattleStatus = "CLEAR";
    let battleCarId: string | null = null;
    const trackLineOffset = 0;
    if (car.currentLap === 1 && car.totalDistance < 260) {
      racingLineMode = "GRID";
    } else if (ahead && distanceAhead < 42) {
      racingLineMode = "ATTACK";
    } else if (behind && distanceBehind < 30) {
      racingLineMode = "DEFEND";
    }
    if (raceControl === "GREEN" && ahead && distanceAhead < 8) {
      battleStatus = "SIDE_BY_SIDE";
      battleCarId = ahead.carId;
    } else if (raceControl === "GREEN" && ahead && gapAhead <= 1.2) {
      battleStatus = "ATTACKING";
      battleCarId = ahead.carId;
    } else if (raceControl === "GREEN" && behind && gapBehind <= 1.2) {
      battleStatus = "DEFENDING";
      battleCarId = behind.carId;
    }
    updates.set(car.carId, {
      racePosition: index + 1,
      gapToLeader: index === 0 ? 0 : Math.max(0, (leader.totalDistance - car.totalDistance) / averageLeaderSpeedMps),
      gapToCarAhead: gapAhead,
      gapToCarBehind: gapBehind,
      racingLineMode,
      trackLineOffset,
      battleStatus,
      battleCarId,
    });
  });

  return cars.map((car) => ({ ...car, ...updates.get(car.carId) }));
}

function withTimingData(previous: RaceCarState, next: RaceCarState, elapsedTime: number): RaceCarState {
  const trackLength = SILVERSTONE_CIRCUIT.lengthMeters;
  const previousCompletedLaps = Math.max(0, Math.floor(previous.totalDistance / trackLength));
  const completedLaps = Math.max(0, Math.floor(next.totalDistance / trackLength));
  const crossedTimingLine = completedLaps > previousCompletedLaps;
  const enteredTrack = previous.totalDistance < 0 && next.totalDistance >= 0;
  const nextSector = sectorAtDistance(next.totalDistance);

  if (crossedTimingLine) {
    const lapTime = elapsedTime - previous.lapStartedAt;
    const finalSectorTime = elapsedTime - previous.sectorStartedAt;
    const completedSectors: RaceCarState["lastLapSectorTimes"] = [
      previous.sectorTimes[0],
      previous.sectorTimes[1],
      finalSectorTime,
    ];
    return {
      ...next,
      currentSector: 1,
      currentLapTime: 0,
      currentSectorTime: 0,
      lapStartedAt: elapsedTime,
      sectorStartedAt: elapsedTime,
      sectorTimes: [null, null, null],
      lastLapTime: lapTime,
      bestLapTime: previous.bestLapTime === null ? lapTime : Math.min(previous.bestLapTime, lapTime),
      lastLapSectorTimes: completedSectors,
    };
  }

  if (enteredTrack) {
    return {
      ...next,
      currentSector: 1,
      currentLapTime: elapsedTime - previous.lapStartedAt,
      currentSectorTime: elapsedTime,
      sectorStartedAt: 0,
    };
  }

  if (nextSector !== previous.currentSector && next.totalDistance >= 0) {
    const sectorTime = elapsedTime - previous.sectorStartedAt;
    const sectorTimes: RaceCarState["sectorTimes"] = [...previous.sectorTimes];
    sectorTimes[previous.currentSector - 1] = sectorTime;
    return {
      ...next,
      currentSector: nextSector,
      currentLapTime: elapsedTime - previous.lapStartedAt,
      currentSectorTime: 0,
      sectorStartedAt: elapsedTime,
      sectorTimes,
    };
  }

  return {
    ...next,
    currentSector: next.totalDistance < 0 ? 1 : nextSector,
    currentLapTime: elapsedTime - previous.lapStartedAt,
    currentSectorTime: elapsedTime - previous.sectorStartedAt,
  };
}

function surfaceTrafficForCars(cars: readonly RaceCarState[]): number[] {
  const traffic = Array.from({ length: WEATHER_SURFACE_ZONE_COUNT }, () => 0.08);
  for (const car of cars) {
    if (car.finished || car.pitStatus !== "TRACK") continue;
    const distanceCovered = Math.max(24, car.currentSpeed / 3.6);
    const samples = Math.max(2, Math.ceil(distanceCovered / 24));
    for (let sample = 0; sample <= samples; sample += 1) {
      const distance = normalizeLapDistance(car.lapDistance - distanceCovered + (distanceCovered * sample) / samples);
      const zoneIndex = Math.min(WEATHER_SURFACE_ZONE_COUNT - 1, Math.floor((distance / SILVERSTONE_CIRCUIT.lengthMeters) * WEATHER_SURFACE_ZONE_COUNT));
      traffic[zoneIndex] = Math.min(1, traffic[zoneIndex] + 0.16);
    }
  }
  return traffic;
}

function incidentSeverity(status: "SPUN" | "DAMAGED" | "RETIRED", safetyCarAvailable: boolean): { control: RaceControlStatus; duration: number } {
  if (status === "RETIRED") return safetyCarAvailable
    ? { control: "SAFETY_CAR", duration: 70 }
    : { control: "VSC", duration: 42 };
  if (status === "DAMAGED") return { control: "VSC", duration: 35 };
  return { control: "YELLOW", duration: 16 };
}

function nearestCornerAtDistance(distanceMeters: number) {
  const distance = normalizeLapDistance(distanceMeters);
  return SILVERSTONE_CORNERS.reduce((nearest, corner) => {
    const nearestDelta = Math.min(Math.abs(nearest.distanceMeters - distance), SILVERSTONE_CIRCUIT.lengthMeters - Math.abs(nearest.distanceMeters - distance));
    const cornerDelta = Math.min(Math.abs(corner.distanceMeters - distance), SILVERSTONE_CIRCUIT.lengthMeters - Math.abs(corner.distanceMeters - distance));
    return cornerDelta < nearestDelta ? corner : nearest;
  });
}

function actualLapsDownFromLeader(leaderDistance: number, carDistance: number): number {
  const distanceDeficit = Math.max(0, leaderDistance - carDistance);
  return Math.max(0, Math.floor((distanceDeficit + 0.001) / SILVERSTONE_CIRCUIT.lengthMeters));
}

function blueFlagRequiredFor(car: RaceCarState, reference: RaceCarState | undefined): boolean {
  if (car.finished || car.incidentStatus === "RETIRED" || car.pitStatus !== "TRACK") return false;
  if (!reference || reference.carId === car.carId || reference.finished || reference.pitStatus !== "TRACK") return false;
  const distanceAdvantage = reference.totalDistance - car.totalDistance;
  if (distanceAdvantage < SILVERSTONE_CIRCUIT.lengthMeters * 0.72) return false;
  const closingDistance = (car.lapDistance - reference.lapDistance + SILVERSTONE_CIRCUIT.lengthMeters) % SILVERSTONE_CIRCUIT.lengthMeters;
  // The instruction is shown only once the lapping car is close enough for a
  // prompt, controlled pass. Flagging from 235 m away kept the whole backfield
  // under instruction for too long and manufactured ignored-blue penalties.
  return closingDistance > 4 && closingDistance < 140;
}

function redFlagRestartCompound(weather: WeatherState, car: RaceCarState): TyreCompound {
  if (car.scheduledPitCompound) return car.scheduledPitCompound;
  const standingWater = Math.max(0, ...(weather.surfaceZones?.map((zone) => zone.standingWater) ?? [0]));
  if (standingWater >= 0.16 || weather.trackWetness >= 0.72) return "WET";
  if (weather.trackWetness >= 0.18) return "INTERMEDIATE";
  return car.tyreCompound;
}

function serviceCarDuringRedFlag(car: RaceCarState, weather: WeatherState): RaceCarState {
  if (car.finished || car.incidentStatus === "RETIRED") return car;
  const compound = redFlagRestartCompound(weather, car);
  const replacement = car.tyreSets.find((set) => set.compound === compound && set.status === "AVAILABLE");
  const tyreSets = replacement
    ? car.tyreSets.map((set) => set.id === car.activeTyreSetId
      ? { ...set, status: "USED" as const, condition: car.tyreLife, lapsUsed: car.tyreAgeLaps }
      : set.id === replacement.id ? { ...set, status: "FITTED" as const } : set)
    : car.tyreSets;
  return {
    ...car,
    tyreCompound: replacement ? compound : car.tyreCompound,
    tyreAgeLaps: replacement ? 0 : car.tyreAgeLaps,
    tyreLife: replacement ? 100 : car.tyreLife,
    tyreTemperatures: replacement ? uniformTyreTemperatures(compound === "WET" ? 66 : compound === "INTERMEDIATE" ? 72 : 82) : car.tyreTemperatures,
    tyreTemperature: replacement ? (compound === "WET" ? 66 : compound === "INTERMEDIATE" ? 72 : 82) : car.tyreTemperature,
    tyreSets,
    activeTyreSetId: replacement?.id ?? car.activeTyreSetId,
    scheduledPitCompound: null,
    scheduledPitTyreSetId: null,
    // Only genuine accident repair is represented here; the car is not reset
    // to factory condition under suspension.
    damageLevel: Math.max(0, car.damageLevel - 0.18),
  };
}

function updateIncidents(snapshot: RaceSnapshot, weather: WeatherState, tick: number, elapsedTime: number) {
  let raceControlTimer = Math.max(0, snapshot.raceControlTimer - FIXED_STEP_SECONDS);
  let raceControl: RaceControlStatus = snapshot.raceControl === "SAFETY_CAR" || snapshot.raceControl === "RED_FLAG"
    ? snapshot.raceControl
    : raceControlTimer > 0 ? snapshot.raceControl : "GREEN";
  let redFlagPhase = snapshot.redFlagPhase ?? "NONE";
  let redFlagTimerSeconds = Math.max(0, (snapshot.redFlagTimerSeconds ?? 0) - FIXED_STEP_SECONDS);
  let redFlagRestartType = snapshot.redFlagRestartType ?? "STANDING";
  let redFlagOrder = [...(snapshot.redFlagOrder ?? [])];
  let redFlagDeployments = snapshot.redFlagDeployments ?? 0;
  let yellowSector = raceControl === "GREEN" ? null : snapshot.yellowSector;
  let activeIncident: ActiveIncident | null = raceControl === "GREEN" ? null : snapshot.activeIncident;
  const newEvents: RaceEvent[] = [];
  const newRadio: RadioMessage[] = [];
  let cars = [...snapshot.cars];

  if (raceControl === "RED_FLAG") {
    if (redFlagPhase === "SUSPENDED" && redFlagTimerSeconds <= 0) {
      redFlagPhase = "RESTART_FORMATION";
      redFlagRestartType = weather.trackWetness >= 0.46 ? "ROLLING" : "STANDING";
      redFlagTimerSeconds = 12;
      cars = cars.map((car) => serviceCarDuringRedFlag(car, weather));
      const message = `${redFlagRestartType} RESTART CONFIRMED · TYRE CHANGE AND GENUINE ACCIDENT REPAIR COMPLETE`;
      newEvents.push({ id: `${tick}-red-restart-procedure`, elapsedTime, type: "RACE_CONTROL", message });
      newRadio.push({ id: `${tick}-red-restart-procedure-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: "URGENT" });
    } else if (redFlagPhase === "RESTART_FORMATION" && redFlagTimerSeconds <= 0) {
      redFlagPhase = "RESTART_COUNTDOWN";
      redFlagTimerSeconds = 5;
      const message = `${redFlagRestartType} RESTART · FIVE SECOND COUNTDOWN`;
      newEvents.push({ id: `${tick}-red-restart-countdown`, elapsedTime, type: "RACE_CONTROL", message });
      newRadio.push({ id: `${tick}-red-restart-countdown-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: "URGENT" });
    } else if (redFlagPhase === "RESTART_COUNTDOWN" && redFlagTimerSeconds <= 0) {
      raceControl = "GREEN";
      raceControlTimer = 0;
      redFlagPhase = "NONE";
      redFlagTimerSeconds = 0;
      const message = "GREEN FLAG · RACE RESUMED";
      newEvents.push({ id: `${tick}-red-restart-green`, elapsedTime, type: "RACE_CONTROL", message });
      newRadio.push({ id: `${tick}-red-restart-green-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: "NORMAL" });
    }
  }
  let safetyCarDeployments = snapshot.safetyCarDeployments
    ?? (snapshot.raceControl === "SAFETY_CAR" ? 1 : 0);
  const scheduledSafetyCarDistance = snapshot.scheduledSafetyCarDistance
    ?? scheduledSafetyCarTriggerDistance(snapshot.seed);
  let incidentCreated = false;
  const latestIncidentAt = snapshot.cars.reduce(
    (latest, car) => Math.max(latest, car.lastIncidentAt ?? Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY,
  );
  const incidentWindowOpen = raceControl === "GREEN";
  const fieldIncidentReady = incidentWindowOpen && elapsedTime - latestIncidentAt >= INCIDENT_FIELD_COOLDOWN_SECONDS;

  const maximumStandingWater = tick % 100 === 0
    ? weather.surfaceZones?.reduce((maximum, zone) => Math.max(maximum, zone.standingWater), 0) ?? 0
    : 0;
  const heavyRainSuspensionDue = tick % 100 === 0
    && redFlagDeployments === 0
    && raceControl === "GREEN"
    && elapsedTime > 90
    && weather.trackWetness >= 0.78
    && maximumStandingWater >= 0.18;
  if (heavyRainSuspensionDue) {
    raceControl = "RED_FLAG";
    raceControlTimer = 0;
    redFlagPhase = "SUSPENDED";
    redFlagTimerSeconds = 32;
    redFlagRestartType = "ROLLING";
    redFlagOrder = [...cars].sort((a, b) => a.racePosition - b.racePosition).map((car) => car.carId);
    redFlagDeployments += 1;
    const message = "RED FLAG · RACE SUSPENDED · STANDING WATER AND VISIBILITY BELOW SAFE LIMIT";
    newEvents.push({ id: `${tick}-weather-red-flag`, elapsedTime, type: "RACE_CONTROL", message });
    newRadio.push({ id: `${tick}-weather-red-flag-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: "URGENT" });
  }

  const leadingRaceDistance = cars.reduce((leading, car) => (
    car.incidentStatus === "RETIRED" ? leading : Math.max(leading, car.totalDistance)
  ), Number.NEGATIVE_INFINITY);
  const scheduledSafetyCarDue = tick % 10 === 0
    && safetyCarDeployments === 0
    && raceControl === "GREEN"
    && elapsedTime - latestIncidentAt >= INCIDENT_FIELD_COOLDOWN_SECONDS
    && leadingRaceDistance >= scheduledSafetyCarDistance;

  if (scheduledSafetyCarDue) {
    const eligibleCars = cars.filter((car) => !car.finished && car.incidentStatus === "RUNNING" && car.pitStatus === "TRACK");
    if (eligibleCars.length > 0) {
      const candidateRoll = (signedNoise(snapshot.seed, 71_003, 0) + 1) / 2;
      const candidate = eligibleCars[Math.min(eligibleCars.length - 1, Math.floor(candidateRoll * eligibleCars.length))];
      const candidateIndex = cars.findIndex((car) => car.carId === candidate.carId);
      const directionRoll = (signedNoise(snapshot.seed, 71_004, 0) + 1) / 2;
      const corner = nearestCornerAtDistance(candidate.lapDistance);
      const incidentSector = sectorAtDistance(candidate.lapDistance);
      const driver = DRIVER_BY_ID.get(candidate.driverId);
      const location = `T${corner.number} ${corner.name}`;
      const cause = directionRoll > 0.66
        ? "CAR STOPPED IN UNSAFE POSITION"
        : directionRoll > 0.33 ? "VEHICLE RECOVERY REQUIRED" : "DEBRIS ON RACING LINE";

      raceControl = "SAFETY_CAR";
      raceControlTimer = 70;
      yellowSector = incidentSector;
      activeIncident = {
        carId: candidate.carId,
        distanceMeters: candidate.lapDistance,
        cornerNumber: corner.number,
        cornerName: corner.name,
        sector: incidentSector,
        status: "SPUN",
        cause,
      };
      safetyCarDeployments = 1;
      incidentCreated = true;
      newEvents.push({
        id: `${tick}-${candidate.carId}-scheduled-sc`,
        elapsedTime,
        type: "INCIDENT",
        message: `${driver?.shortName ?? candidate.driverId} spun and stopped at ${location} · ${cause}`,
        carId: candidate.carId,
      });
      newRadio.push({
        id: `${tick}-${candidate.carId}-scheduled-sc-radio`,
        elapsedTime,
        carId: candidate.carId,
        source: "RACE CONTROL",
        message: `CAR ${driver?.number ?? "—"} (${driver?.shortName ?? candidate.driverId}) STOPPED AT ${location.toUpperCase()} · SAFETY CAR REQUIRED`,
        priority: "URGENT",
      });
      cars = cars.map((car, index) => index === candidateIndex ? {
        ...car,
        incidentStatus: "SPUN",
        incidentTimer: 24,
        incidentStartedAt: elapsedTime,
        incidentDirection: directionRoll >= 0.5 ? 1 : -1,
        lastIncidentAt: elapsedTime,
        currentSpeed: Math.min(car.currentSpeed, 45),
      } satisfies RaceCarState : car);
    }
  }

  const retirementTarget = plannedRetirementCount(snapshot.seed);
  const retiredCount = cars.filter((car) => car.incidentStatus === "RETIRED").length;
  const plannedRetirementDue = !incidentCreated
    && tick % 10 === 0
    && fieldIncidentReady
    && retiredCount < retirementTarget
    && leadingRaceDistance >= plannedRetirementTriggerDistance(snapshot.seed, retiredCount, retirementTarget);

  if (plannedRetirementDue) {
    const eligibleCars = cars
      .filter((car) => !car.finished && car.incidentStatus === "RUNNING" && car.pitStatus === "TRACK")
      .sort((left, right) => {
        const leftIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === left.driverId));
        const rightIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === right.driverId));
        const leftOrder = signedNoise(snapshot.seed, 73_000 + leftIndex, retiredCount + 1);
        const rightOrder = signedNoise(snapshot.seed, 73_000 + rightIndex, retiredCount + 1);
        return leftOrder - rightOrder || left.racePosition - right.racePosition;
      });
    const candidate = eligibleCars[0];
    if (candidate) {
      const candidateIndex = cars.findIndex((car) => car.carId === candidate.carId);
      const variant = (signedNoise(snapshot.seed, 74_000 + candidateIndex, retiredCount + 1) + 1) / 2;
      const causes = ["POWER UNIT FAILURE", "HYDRAULIC PRESSURE LOSS", "GEARBOX FAILURE", "SUSPENSION DAMAGE", "ELECTRICAL SHUTDOWN", "CAR STOPPED ON CIRCUIT"] as const;
      const cause = causes[Math.min(causes.length - 1, Math.floor(variant * causes.length))];
      const corner = nearestCornerAtDistance(candidate.lapDistance);
      const incidentSector = sectorAtDistance(candidate.lapDistance);
      const driver = DRIVER_BY_ID.get(candidate.driverId);
      const severity = incidentSeverity("RETIRED", safetyCarDeployments === 0);
      raceControl = severity.control;
      raceControlTimer = severity.duration;
      if (severity.control === "SAFETY_CAR") safetyCarDeployments += 1;
      yellowSector = incidentSector;
      activeIncident = { carId: candidate.carId, distanceMeters: candidate.lapDistance, cornerNumber: corner.number, cornerName: corner.name, sector: incidentSector, status: "RETIRED", cause };
      const location = `T${corner.number} ${corner.name}`;
      newEvents.push({ id: `${tick}-${candidate.carId}-planned-retirement`, elapsedTime, type: "INCIDENT", message: `${driver?.shortName ?? candidate.driverId} retired at ${location} · ${cause}`, carId: candidate.carId });
      newRadio.push({ id: `${tick}-${candidate.carId}-planned-retirement-radio`, elapsedTime, carId: candidate.carId, source: "RACE CONTROL", message: `CAR ${driver?.number ?? "—"} (${driver?.shortName ?? candidate.driverId}) STOPPED AT ${location.toUpperCase()} · ${cause}`, priority: "URGENT" });
      cars = cars.map((car, index) => index === candidateIndex ? {
        ...car,
        incidentStatus: "RETIRED",
        incidentTimer: 0,
        incidentStartedAt: elapsedTime,
        incidentDirection: variant >= 0.5 ? 1 : -1,
        lastIncidentAt: elapsedTime,
        retiredReason: cause,
        finished: true,
        finishTime: null,
        currentSpeed: 0,
      } satisfies RaceCarState : car);
      incidentCreated = true;
    }
  }

  if (tick % 10 === 0 && fieldIncidentReady) {
    cars = cars.map((car, index) => {
      if (incidentCreated || car.finished || car.incidentStatus !== "RUNNING" || car.pitStatus !== "TRACK") return car;
      if (elapsedTime - (car.lastIncidentAt ?? Number.NEGATIVE_INFINITY) < INCIDENT_DRIVER_COOLDOWN_SECONDS) return car;
      const tyreRisk = Math.max(0, 35 - car.tyreLife) / 18;
      const speedRisk = car.currentSpeed > 270 ? 0.55 : 0;
      const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
      const rotatingExposure = 1 + (((index + Math.floor(elapsedTime / 180)) % Math.max(1, cars.length)) / Math.max(1, cars.length - 1)) * 0.36;
      const driverRisk = raceIncidentRiskMultiplier(DRIVER_BY_ID.get(car.driverId)?.risk ?? 6);
      const risk = INCIDENT_BASE_PROBABILITY_PER_CAR_SECOND * rotatingExposure * driverRisk * (1 + localWater * 4.2 + tyreRisk + speedRisk);
      const roll = (signedNoise(snapshot.seed, 40_000 + index, tick) + 1) / 2;
      if (roll >= risk) return car;

      const outcomeRoll = (signedNoise(snapshot.seed, 50_000 + index, tick) + 1) / 2;
      const variantRoll = (signedNoise(snapshot.seed, 60_000 + index, tick) + 1) / 2;
      const retirementSlotsOpen = cars.filter((candidate) => candidate.incidentStatus === "RETIRED").length < retirementTarget;
      const incidentStatus = outcomeRoll < 0.64 ? "SPUN" : outcomeRoll < 0.88 || !retirementSlotsOpen ? "DAMAGED" : "RETIRED";
      const beachedSpin = incidentStatus === "SPUN" && variantRoll > 0.82;
      const severeRedFlag = incidentStatus === "RETIRED"
        && redFlagDeployments === 0
        && (localWater > 0.68 || variantRoll > 0.94);
      const severity = severeRedFlag
        ? { control: "RED_FLAG" as const, duration: 0 }
        : beachedSpin
        ? { control: "VSC" as const, duration: 28 }
        : incidentSeverity(incidentStatus, safetyCarDeployments === 0);
      const selectedControl = selectHigherPriorityRaceControl(raceControl, severity.control);
      const incidentWinsControl = selectedControl !== raceControl || (selectedControl === severity.control && severity.duration > raceControlTimer);
      if (incidentWinsControl) {
        if (selectedControl === "SAFETY_CAR" && raceControl !== "SAFETY_CAR") safetyCarDeployments += 1;
        if (selectedControl === "RED_FLAG" && raceControl !== "RED_FLAG") {
          redFlagDeployments += 1;
          redFlagPhase = "SUSPENDED";
          redFlagTimerSeconds = 32;
          redFlagRestartType = localWater > 0.46 ? "ROLLING" : "STANDING";
          redFlagOrder = [...cars].sort((a, b) => a.racePosition - b.racePosition).map((candidate) => candidate.carId);
        }
        raceControl = selectedControl;
        raceControlTimer = severity.duration;
      }
      const driver = DRIVER_BY_ID.get(car.driverId);
      const corner = nearestCornerAtDistance(car.lapDistance);
      const incidentSector = sectorAtDistance(car.lapDistance);
      const cause = localWater > 0.48
        ? variantRoll > 0.5 ? "AQUAPLANING" : "LOSS OF GRIP ON WET SURFACE"
        : incidentStatus === "SPUN"
          ? variantRoll > 0.5 ? "REAR AXLE SNAP" : "BRAKING LOCK-UP"
          : incidentStatus === "DAMAGED"
            ? variantRoll > 0.5 ? "CONTACT AND DEBRIS" : "KERB IMPACT"
            : variantRoll > 0.5 ? "CAR STOPPED ON CIRCUIT" : "MECHANICAL FAILURE";
      if (incidentWinsControl) {
        yellowSector = incidentSector;
        activeIncident = { carId: car.carId, distanceMeters: car.lapDistance, cornerNumber: corner.number, cornerName: corner.name, sector: incidentSector, status: incidentStatus, cause };
      }
      const location = `T${corner.number} ${corner.name}`;
      const message = incidentStatus === "SPUN"
        ? `${driver?.shortName ?? car.driverId} ${beachedSpin ? "spun and stopped briefly" : "spun and rejoined"} at ${location} · ${cause}`
        : incidentStatus === "DAMAGED" ? `${driver?.shortName ?? car.driverId} has vehicle damage at ${location} · ${cause}` : `${driver?.shortName ?? car.driverId} retired at ${location} · ${cause}`;
      newEvents.push({ id: `${tick}-${car.carId}`, elapsedTime, type: "INCIDENT", message, carId: car.carId });
      const investigationMessage = `INCIDENT INVOLVING CAR ${driver?.number ?? "—"} (${driver?.shortName ?? car.driverId}) AT ${location.toUpperCase()} · UNDER INVESTIGATION`;
      newRadio.push({ id: `${tick}-${car.carId}-radio`, elapsedTime, carId: car.carId, source: "RACE CONTROL", message: investigationMessage, priority: incidentStatus === "RETIRED" ? "URGENT" : "WARNING" });
      incidentCreated = true;
      return {
        ...car,
        incidentStatus,
        incidentTimer: incidentStatus === "SPUN" ? (beachedSpin ? 8 : 4.5 + outcomeRoll * 3) : 0,
        incidentStartedAt: elapsedTime,
        incidentDirection: variantRoll >= 0.5 ? 1 : -1,
        lastIncidentAt: elapsedTime,
        damageLevel: incidentStatus === "DAMAGED" ? Math.max(car.damageLevel, 0.45 + outcomeRoll * 0.35) : car.damageLevel,
        retiredReason: incidentStatus === "RETIRED" ? "MECHANICAL / INCIDENT" : car.retiredReason,
        finished: incidentStatus === "RETIRED" ? true : car.finished,
        currentSpeed: incidentStatus === "RETIRED" ? 0 : car.currentSpeed,
      } satisfies RaceCarState;
    });
  }

  let safetyCarPhase: RaceSnapshot["safetyCarPhase"] = raceControl === "SAFETY_CAR"
    ? snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarPhase !== "NONE" ? snapshot.safetyCarPhase : "DEPLOYED"
    : "NONE";
  let safetyCarPhaseElapsedSeconds = raceControl === "SAFETY_CAR" && snapshot.raceControl === "SAFETY_CAR"
    ? snapshot.safetyCarPhaseElapsedSeconds
    : 0;
  let safetyCarDistance: number | null = null;
  let safetyCarSpeed = 0;
  let safetyCarFieldBunched = false;
  let safetyCarInPitLane = false;
  let safetyCarDeploymentDistance = raceControl === "SAFETY_CAR" ? snapshot.safetyCarDeploymentDistance ?? null : null;
  let safetyCarTargetLaps: 1 | 2 = raceControl === "SAFETY_CAR" ? snapshot.safetyCarTargetLaps ?? 1 : 1;
  let safetyCarEndingStartDistance = raceControl === "SAFETY_CAR" ? snapshot.safetyCarEndingStartDistance ?? null : null;
  let safetyCarPitEntryDistance = raceControl === "SAFETY_CAR" ? snapshot.safetyCarPitEntryDistance ?? null : null;
  let safetyCarRestartLineDistance: number | null = raceControl === "SAFETY_CAR" ? snapshot.safetyCarRestartLineDistance : null;
  let safetyCarLappedCarsMayOvertake = raceControl === "SAFETY_CAR" ? snapshot.safetyCarLappedCarsMayOvertake ?? false : false;
  let safetyCarWaveBy = raceControl === "SAFETY_CAR" ? [...(snapshot.safetyCarWaveBy ?? [])] : [];
  let safetyCarFormation: SafetyCarFormation | null = null;

  if (raceControl === "SAFETY_CAR" && safetyCarPhase !== "NONE") {
    const leader = [...cars].filter((car) => !car.finished && car.pitStatus === "TRACK").sort((a, b) => a.racePosition - b.racePosition)[0];
    if (leader) {
      const safetyCar = advanceSafetyCarPosition({
        previousTotalDistance: snapshot.raceControl === "SAFETY_CAR" ? snapshot.safetyCarDistance : null,
        leaderTotalDistance: leader.totalDistance,
        circuitLengthMeters: SILVERSTONE_CIRCUIT.lengthMeters,
        phase: safetyCarPhase,
        stepSeconds: FIXED_STEP_SECONDS,
      });
      safetyCarDistance = safetyCar.totalDistance;
      safetyCarSpeed = safetyCar.speedKph;

      if (safetyCarDeploymentDistance === null || safetyCarEndingStartDistance === null || safetyCarPitEntryDistance === null) {
        const lappedCars = cars
          .map((car) => ({ car, lapsDown: actualLapsDownFromLeader(leader.totalDistance, car.totalDistance) }))
          .filter(({ car, lapsDown }) => (
            !car.finished
            && car.incidentStatus !== "RETIRED"
            && car.pitStatus === "TRACK"
            && car.carId !== leader.carId
            && lapsDown >= 1
          ));
        safetyCarTargetLaps = safetyCarTargetLapsFor(snapshot.seed, safetyCarDeployments, lappedCars.length > 0);
        const schedule = buildSafetyCarSchedule({
          deploymentDistance: safetyCar.totalDistance,
          targetLaps: safetyCarTargetLaps,
          circuitLengthMeters: SILVERSTONE_CIRCUIT.lengthMeters,
          sectorThreeStartDistance: SILVERSTONE_SECTOR_ENDS[1],
          pitEntryLapDistance: PIT_ENTRY_START,
        });
        safetyCarDeploymentDistance = schedule.deploymentDistance;
        safetyCarEndingStartDistance = schedule.endingStartDistance;
        safetyCarPitEntryDistance = schedule.pitEntryDistance;
        safetyCarRestartLineDistance ??= schedule.restartLineDistance;
        safetyCarWaveBy = lappedCars.map(({ car, lapsDown }) => ({
          carId: car.carId,
          startDistance: car.totalDistance,
          targetDistance: car.totalDistance,
          lapsDown,
          active: false,
          passedSafetyCar: false,
          completed: false,
        }));
      }

      const unlappingStartDistance = safetyCarTargetLaps === 2 && safetyCarEndingStartDistance !== null
        ? safetyCarEndingStartDistance - SILVERSTONE_CIRCUIT.lengthMeters
        : null;
      const waveByWindowOpen = safetyCarPhase === "BUNCHING"
        && unlappingStartDistance !== null
        && safetyCar.totalDistance >= unlappingStartDistance
        && safetyCar.totalDistance < (safetyCarEndingStartDistance ?? Infinity);

      safetyCarWaveBy = safetyCarWaveBy.map((waveBy) => {
        const car = cars.find((candidate) => candidate.carId === waveBy.carId);
        if (!car || car.finished || car.incidentStatus === "RETIRED") {
          return { ...waveBy, active: false, completed: true };
        }
        const lapsDown = Math.max(1, waveBy.lapsDown ?? actualLapsDownFromLeader(leader.totalDistance, car.totalDistance));
        if (waveByWindowOpen && !waveBy.completed && !waveBy.active) {
          return {
            ...waveBy,
            startDistance: car.totalDistance,
            targetDistance: car.totalDistance,
            lapsDown,
            active: true,
            passedSafetyCar: false,
          };
        }
        return {
          ...waveBy,
          lapsDown,
          // Permission expires as soon as SC ENDING begins. Any car that could
          // not complete its pass is folded back into the preserved-lap queue
          // instead of remaining exempt from Safety Car order enforcement.
          active: waveByWindowOpen && waveBy.active === true && !waveBy.completed,
          passedSafetyCar: waveBy.passedSafetyCar === true,
        };
      });

      let activeWaveByIds = safetyCarWaveBy
        .filter((waveBy) => waveBy.active === true && !waveBy.completed)
        .map((waveBy) => waveBy.carId);
      const queueOffsetMetersByCarId = Object.fromEntries(safetyCarWaveBy
        .filter((waveBy) => waveBy.active !== true)
        .map((waveBy) => {
          const recoveredLaps = waveBy.completed ? 1 : 0;
          const preservedLapsDown = Math.max(0, (waveBy.lapsDown ?? 1) - recoveredLaps);
          return [waveBy.carId, preservedLapsDown * SILVERSTONE_CIRCUIT.lengthMeters];
        }));
      const baseFormation = buildSafetyCarFormation(
        cars,
        safetyCar,
        safetyCarPhase,
        activeWaveByIds,
        queueOffsetMetersByCarId,
      );
      const baseTailTarget = baseFormation.queue.at(-1)?.targetTotalDistance ?? safetyCar.totalDistance - 60;
      let activeWaveByIndex = 0;
      safetyCarWaveBy = safetyCarWaveBy.map((waveBy) => {
        if (waveBy.active !== true || waveBy.completed) return waveBy;
        const car = cars.find((candidate) => candidate.carId === waveBy.carId);
        if (!car || car.pitStatus !== "TRACK") return { ...waveBy, active: false, completed: true };
        const lapsDown = Math.max(1, waveBy.lapsDown ?? 1);
        const rejoinTarget = baseTailTarget
          - (lapsDown - 1) * SILVERSTONE_CIRCUIT.lengthMeters
          - (activeWaveByIndex + 1) * 18;
        activeWaveByIndex += 1;
        const virtualTrackDistance = car.totalDistance + lapsDown * SILVERSTONE_CIRCUIT.lengthMeters;
        const passedSafetyCar = waveBy.passedSafetyCar === true
          || virtualTrackDistance >= safetyCar.totalDistance + 8;
        const completed = passedSafetyCar && car.totalDistance >= rejoinTarget - 6;
        return {
          ...waveBy,
          lapsDown,
          targetDistance: rejoinTarget,
          passedSafetyCar,
          completed,
          active: !completed,
        };
      });
      activeWaveByIds = safetyCarWaveBy
        .filter((waveBy) => waveBy.active === true && !waveBy.completed)
        .map((waveBy) => waveBy.carId);
      safetyCarLappedCarsMayOvertake = waveByWindowOpen && activeWaveByIds.length > 0;
      const finalQueueOffsetMetersByCarId = Object.fromEntries(safetyCarWaveBy
        .filter((waveBy) => waveBy.active !== true)
        .map((waveBy) => {
          const recoveredLaps = waveBy.completed ? 1 : 0;
          const preservedLapsDown = Math.max(0, (waveBy.lapsDown ?? 1) - recoveredLaps);
          return [waveBy.carId, preservedLapsDown * SILVERSTONE_CIRCUIT.lengthMeters];
        }));
      safetyCarFormation = buildSafetyCarFormation(
        cars,
        safetyCar,
        safetyCarPhase,
        activeWaveByIds,
        finalQueueOffsetMetersByCarId,
      );
      safetyCarFieldBunched = safetyCarFormation.fieldBunched;
      const safetyCarExitingPit = safetyCarPhase === "DEPLOYED" && safetyCarPhaseElapsedSeconds < 3.2;
      safetyCarInPitLane = safetyCarExitingPit
        || (safetyCarPhase === "RESTART" && (
          snapshot.safetyCarInPitLane
          || (safetyCarPitEntryDistance !== null && safetyCar.totalDistance >= safetyCarPitEntryDistance)
        ));
      const leaderReachedRestartLine = safetyCarRestartLineDistance !== null && leader.totalDistance >= safetyCarRestartLineDistance;
      const procedure = advanceSafetyCarProcedure({
        state: { phase: safetyCarPhase, phaseElapsedSeconds: safetyCarPhaseElapsedSeconds },
        stepSeconds: FIXED_STEP_SECONDS,
        fieldBunched: safetyCarFieldBunched,
        endingSectorReached: safetyCarEndingStartDistance !== null && safetyCar.totalDistance >= safetyCarEndingStartDistance,
        safetyCarInPitLane,
        leaderReachedRestartLine,
      });
      if (safetyCarLappedCarsMayOvertake && !snapshot.safetyCarLappedCarsMayOvertake) {
        const waveByMessage = raceControlPhaseMessage({
          raceControl: "SAFETY_CAR",
          safetyCarPhase: "BUNCHING",
          pitLaneOpen: true,
          lappedCarsMayOvertake: true,
          waveByCarCount: safetyCarWaveBy.filter((waveBy) => !waveBy.completed).length,
        });
        const message = `${waveByMessage.headline} — ${waveByMessage.detail}`;
        newEvents.push({ id: `${tick}-sc-wave-by`, elapsedTime, type: "RACE_CONTROL", message });
        newRadio.push({ id: `${tick}-sc-wave-by-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: waveByMessage.priority });
      }
      safetyCarPhase = procedure.phase;
      safetyCarPhaseElapsedSeconds = procedure.phaseElapsedSeconds;
      if (procedure.changed && procedure.phase === "RESTART") {
        safetyCarLappedCarsMayOvertake = false;
        safetyCarWaveBy = safetyCarWaveBy.map((waveBy) => waveBy.active
          ? { ...waveBy, active: false, completed: true }
          : waveBy);
      }
      if (procedure.changed && procedure.message && procedure.phase !== "NONE") {
        const message = `${procedure.message.headline} — ${procedure.message.detail}`;
        newEvents.push({ id: `${tick}-sc-phase`, elapsedTime, type: "RACE_CONTROL", message });
        newRadio.push({ id: `${tick}-sc-phase-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: procedure.message.priority });
      }
      if (procedure.phase === "NONE") {
        raceControl = "GREEN";
        raceControlTimer = 0;
        yellowSector = null;
        activeIncident = null;
        safetyCarDistance = null;
        safetyCarSpeed = 0;
        safetyCarFieldBunched = false;
        safetyCarInPitLane = true;
        safetyCarDeploymentDistance = null;
        safetyCarTargetLaps = 1;
        safetyCarEndingStartDistance = null;
        safetyCarPitEntryDistance = null;
        safetyCarRestartLineDistance = null;
        safetyCarLappedCarsMayOvertake = false;
        safetyCarWaveBy = [];
        safetyCarFormation = null;
      }
    }
  }

  const pitProcedure = pitLaneProcedureFor(raceControl, safetyCarPhase, safetyCarPhaseElapsedSeconds);
  const pitLaneOpen = pitProcedure.open;
  if (pitLaneOpen !== snapshot.pitLaneOpen) {
    newEvents.push({ id: `${tick}-pit-procedure`, elapsedTime, type: "RACE_CONTROL", message: pitProcedure.message });
    newRadio.push({ id: `${tick}-pit-procedure-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message: pitProcedure.message, priority: pitLaneOpen ? "NORMAL" : "URGENT" });
  }

  if (raceControl !== snapshot.raceControl) {
    const procedureMessage = raceControlPhaseMessage({ raceControl, safetyCarPhase, yellowSector, pitLaneOpen });
    const message = `${procedureMessage.headline} — ${procedureMessage.detail}`;
    newEvents.push({ id: `${tick}-control`, elapsedTime, type: "RACE_CONTROL", message });
    newRadio.push({ id: `${tick}-control-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: procedureMessage.priority });
  }

  return {
    cars,
    raceControl,
    raceControlTimer,
    yellowSector,
    redFlagPhase,
    redFlagTimerSeconds,
    redFlagRestartType,
    redFlagOrder,
    redFlagDeployments,
    safetyCarPhase,
    safetyCarPhaseElapsedSeconds,
    safetyCarDistance,
    safetyCarSpeed,
    safetyCarFieldBunched,
    safetyCarInPitLane,
    safetyCarDeploymentDistance,
    safetyCarTargetLaps,
    safetyCarEndingStartDistance,
    safetyCarPitEntryDistance,
    safetyCarRestartLineDistance,
    safetyCarLappedCarsMayOvertake,
    safetyCarWaveBy,
    safetyCarDeployments,
    scheduledSafetyCarDistance,
    safetyCarFormation,
    pitLaneOpen,
    pitLaneStatus: pitProcedure.status,
    activeIncident,
    events: [...newEvents.reverse(), ...snapshot.events].slice(0, 24),
    radioMessages: [...newRadio.reverse(), ...snapshot.radioMessages].slice(0, 30),
  };
}

function enforceRaceControlOrder(
  cars: readonly RaceCarState[],
  previousCars: readonly RaceCarState[],
  control: RaceControlStatus,
  yellowSector: 1 | 2 | 3 | null,
  safetyCarFormation: SafetyCarFormation | null,
  exemptCarIds: readonly string[] = [],
): RaceCarState[] {
  if (control === "GREEN") return [...cars];
  const byId = new Map(cars.map((car) => [car.carId, car]));
  const previousOrder = [...previousCars]
    .filter((car) => !car.finished && car.pitStatus === "TRACK" && byId.get(car.carId)?.pitStatus === "TRACK")
    .sort((a, b) => a.racePosition - b.racePosition);
  const safetyTargets = new Map(safetyCarFormation?.queue.map((entry) => [entry.carId, entry]) ?? []);
  const exempt = new Set(exemptCarIds);
  let aheadDistance = Infinity;
  const updates = new Map<string, RaceCarState>();
  for (const previous of previousOrder) {
    const car = byId.get(previous.carId);
    if (!car) continue;
    if (control === "SAFETY_CAR" && exempt.has(car.carId)) {
      updates.set(car.carId, car);
      continue;
    }
    const controlled = control !== "YELLOW" || (yellowSector !== null && car.currentSector === yellowSector);
    const minimumGap = control === "SAFETY_CAR" ? 12 : 5;
    const queueTarget = control === "SAFETY_CAR" ? safetyTargets.get(car.carId)?.targetTotalDistance : undefined;
    const maximumDistance = Math.min(aheadDistance - minimumGap, queueTarget ?? Infinity);
    const adjusted = controlled && Number.isFinite(maximumDistance) && car.totalDistance > maximumDistance
      ? withPositionData({ ...car, totalDistance: maximumDistance, currentSpeed: Math.min(car.currentSpeed, safetyCarFormation?.safetyCar.speedKph ?? 145) })
      : car;
    updates.set(car.carId, adjusted);
    aheadDistance = adjusted.totalDistance;
  }
  return cars.map((car) => updates.get(car.carId) ?? car);
}

interface EnergyTactics {
  activeAeroMode: ActiveAeroMode;
  energyState: EnergyState;
  overtakeEligible: boolean;
  overtakeActive: boolean;
  boostActive: boolean;
  dirtyAirLoss: number;
}

function energyTacticsFor(car: RaceCarState, energySystem: EnergySystemState, raceControl: RaceControlStatus, trackWetness: number): EnergyTactics {
  const segment = SILVERSTONE_CIRCUIT.segments[car.currentSegment];
  const lowGrip = trackWetness > 0.48;
  const activeAeroMode: ActiveAeroMode = lowGrip && segment.activeAeroAllowed
    ? "PARTIAL"
    : segment.activeAeroAllowed ? "STRAIGHT" : "CORNER";
  const overtakeEligible = energySystem.overtakeEligible;
  const overtakeActive = energySystem.overtakeActive;
  const boostActive = energySystem.boostActive;
  const energyState: EnergyState = energySystem.clippingActive ? "CLIPPING"
    : overtakeActive ? "OVERTAKE"
      : boostActive ? "DEFENDING"
        : energySystem.currentDeployPowerKW > 1 ? "DEPLOYING"
          : energySystem.currentHarvestPowerKW > 1 ? "HARVESTING" : "NEUTRAL";
  const greenTrack = raceControl === "GREEN" && car.pitStatus === "TRACK" && car.incidentStatus === "RUNNING";
  const closeInCorners = greenTrack && segment.kind !== "STRAIGHT" && car.gapToCarAhead > 0 && car.gapToCarAhead < 1.55;
  const dirtyAirLoss = closeInCorners ? Math.min(0.018, (1.55 - car.gapToCarAhead) * 0.0115) : 0;
  return { activeAeroMode, energyState, overtakeEligible, overtakeActive, boostActive, dirtyAirLoss };
}

function energyZoneLengthAt(segmentIndex: number): number {
  const segments = SILVERSTONE_CIRCUIT.segments;
  const origin = segments[segmentIndex];
  const isDeploymentSegment = (index: number) => Boolean(segments[index]?.activeAeroAllowed);
  if (!origin.activeAeroAllowed) return origin.length;
  let length = origin.length;
  for (let index = segmentIndex - 1; index >= 0 && isDeploymentSegment(index); index -= 1) length += segments[index].length;
  for (let index = segmentIndex + 1; index < segments.length && isDeploymentSegment(index); index += 1) length += segments[index].length;
  return length;
}

function energyContextFor(car: RaceCarState, raceControl: RaceControlStatus, localWater: number, airTemperatureC: number): EnergyManagementContext {
  const segment = SILVERSTONE_CIRCUIT.segments[car.currentSegment];
  const migrated = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
  const tyreGrip = clamp((car.tyreLife / 100) * (1 - Math.abs(car.tyreTemperature - 100) * 0.0018), 0.52, 1);
  const lapDistance = normalizeLapDistance(car.lapDistance);
  const entitlementLap = migrated.overtakeEntitlementLap;
  const carriesOntoHamiltonStraight = entitlementLap !== null
    && car.currentLap === entitlementLap + 1
    && lapDistance <= SILVERSTONE_OVERTAKE_ZONE_END_DISTANCE;
  return {
    sessionType: "RACE",
    lapNumber: car.currentLap,
    totalLaps: SILVERSTONE_CIRCUIT.totalLaps,
    lapProgress: clamp(lapDistance / SILVERSTONE_CIRCUIT.lengthMeters, 0, 1),
    currentSoc: migrated.stateOfCharge,
    targetLapEndSoc: migrated.targetSocAtLapEnd,
    predictedLapEndSoc: migrated.predictedSocAtLapEnd,
    trackPosition: car.racePosition,
    gapAheadSeconds: car.racePosition === 1 ? null : car.gapToCarAhead,
    gapBehindSeconds: car.gapToCarBehind > 0 ? car.gapToCarBehind : null,
    currentSegmentType: segment.activeAeroAllowed ? "STRAIGHT" : segment.kind,
    segmentLength: energyZoneLengthAt(car.currentSegment),
    segmentProgress: clamp(car.segmentProgress, 0, 1),
    vehicleSpeed: car.currentSpeed,
    previousVehicleSpeed: car.currentSpeed,
    tyreGrip,
    weatherGrip: clamp(1 - localWater * 0.52, 0.48, 1),
    airTemperatureC,
    trafficCoolingLoss: car.gapToCarAhead > 0 && car.gapToCarAhead < 1.25 ? (1.25 - car.gapToCarAhead) * 0.22 : 0,
    safetyCarActive: raceControl === "SAFETY_CAR" || raceControl === "RED_FLAG",
    virtualSafetyCarActive: raceControl === "VSC" || raceControl === "YELLOW" || raceControl === "RED_FLAG",
    pitLaneActive: car.pitStatus !== "TRACK",
    overtakeEntitled: entitlementLap === car.currentLap || carriesOntoHamiltonStraight,
    overtakeActivationZone: lapDistance >= SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE || lapDistance <= SILVERSTONE_OVERTAKE_ZONE_END_DISTANCE,
    driverAttackIntent: car.paceMode === "ATTACK" ? 1 : car.battleStatus === "ATTACKING" ? 0.78 : 0.2,
    driverDefenceIntent: car.battleStatus === "DEFENDING" ? 1 : car.racingLineMode === "DEFEND" ? 0.72 : 0.16,
  };
}

export function stepSnapshot(snapshot: RaceSnapshot): RaceSnapshot {
  if (snapshot.status === "FINISHED") return snapshot;

  const tick = snapshot.tick + 1;
  const elapsedTime = snapshot.elapsedTime + FIXED_STEP_SECONDS;
  const raceDistance = SILVERSTONE_CIRCUIT.totalLaps * SILVERSTONE_CIRCUIT.lengthMeters;
  const weather = tick % 10 === 0
    ? updateSpatialWeather(snapshot.weather, elapsedTime, snapshot.seed, {
      deltaSeconds: 1,
      trackLengthMeters: SILVERSTONE_CIRCUIT.lengthMeters,
      trafficIntensity: surfaceTrafficForCars(snapshot.cars),
    })
    : snapshot.weather;
  const incidentUpdate = updateIncidents(snapshot, weather, tick, elapsedTime);
  const weatherStrategyActive = weather.rainIntensity > 0.035
    || weather.trackWetness > 0.045
    || Boolean(weather.surfaceZones?.some((zone) => zone.wetness > 0.08 || zone.standingWater > 0.025));
  const strategyRefreshTicks = weatherStrategyActive ? 100 : 300;

  const strategicCars = incidentUpdate.cars.map((car) => {
    if (car.teamId === snapshot.playerTeamId || tick % strategyRefreshTicks !== 0 || car.scheduledPitCompound || car.pitStatus !== "TRACK" || car.currentLap >= SILVERSTONE_CIRCUIT.totalLaps) return car;
    const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const decision = buildAiStrategyDecision({ trackWetness: localWater, weather, raceControl: incidentUpdate.raceControl, pitLaneOpen: incidentUpdate.pitLaneOpen, cars: incidentUpdate.cars }, car);
    const strategicCar = { ...car, strategyIntent: decision.intent, strategyConfidence: decision.confidence };
    return decision.pitNow && decision.compound ? reserveTyreSet(strategicCar, decision.compound) : strategicCar;
  });

  // Racecraft orders are stable enough to refresh at 2 Hz; keeping them off
  // the 10 Hz physics path avoids recalculating the whole field 650k times in
  // a full Grand Prix while still reacting faster than the visible timing UI.
  const updateAiTactics = tick % 5 === 0 && incidentUpdate.raceControl === "GREEN";
  const fieldRacecraft = new Map((updateAiTactics
    ? calculateFieldRacecraft({ raceControl: incidentUpdate.raceControl, weather, cars: strategicCars })
    : []).map((decision) => [decision.carId, decision]));
  const tacticalCars = strategicCars.map((car) => {
    if (!updateAiTactics || !(car.energyAutoEnabled ?? car.teamId !== snapshot.playerTeamId) || car.finished || car.incidentStatus === "RETIRED" || car.pitStatus !== "TRACK") return car;
    const thermalAssessment = assessVehicleThermals(car);
    const racecraft = fieldRacecraft.get(car.carId);
    if (!racecraft) return car;
    const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const energyDecision = chooseAiEnergyMode(
      migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature),
      energyContextFor(car, incidentUpdate.raceControl, localWater, weather.airTemperature),
    );
    const energyMode: EnergyMode = energyDecision.mode;
    const coolingMode: CoolingMode = thermalAssessment.severity === "CRITICAL"
      ? "MAX_COOLING"
      : thermalAssessment.severity === "WARNING" ? "LIFT_AND_COAST" : "NORMAL";
    return {
      ...car,
      energyMode,
      energySystem: car.energySystem ? { ...car.energySystem, deploymentMode: energyDecision.mode, modeReason: energyDecision.reason } : car.energySystem,
      coolingMode,
      paceMode: racecraft.recommendedPaceMode,
    };
  });

  const vscEvents: RaceEvent[] = [];
  const vscRadio: RadioMessage[] = [];
  const sportingEvents: RaceEvent[] = [];
  const sportingRadio: RadioMessage[] = [];
  const servedPenaltyIds = new Set<string>();
  const servingPenaltyIds = new Set<string>();
  const crossedLineCarIds = new Set<string>();
  const pitEvents: RaceEvent[] = [];
  const pitRadio: RadioMessage[] = [];
  const blueFlagReference = tick % 5 === 0 && incidentUpdate.raceControl === "GREEN"
    ? tacticalCars.reduce<RaceCarState | undefined>((leader, candidate) => (
      candidate.finished || candidate.incidentStatus === "RETIRED" || candidate.pitStatus !== "TRACK"
        ? leader
        : !leader || candidate.totalDistance > leader.totalDistance ? candidate : leader
    ), undefined)
    : undefined;
  const pendingMandatoryPenaltyByCar = new Map<string, RaceSnapshot["penalties"][number]>();
  const pendingTimePenaltiesByCar = new Map<string, RaceSnapshot["penalties"]>();
  for (const penalty of snapshot.penalties) {
    if (penalty.status !== "PENDING" && penalty.status !== "SERVING") continue;
    if (isMandatoryPitPenalty(penalty.type)) {
      if (!pendingMandatoryPenaltyByCar.has(penalty.carId)) pendingMandatoryPenaltyByCar.set(penalty.carId, penalty);
    } else if (isTimePenalty(penalty.type)) {
      const pending = pendingTimePenaltiesByCar.get(penalty.carId) ?? [];
      pendingTimePenaltiesByCar.set(penalty.carId, [...pending, penalty]);
    }
  }
  const reservedPitSpeedingSlots = tacticalCars.filter((car) => (
    (car.pitLimiterFaultSeconds ?? 0) > 0 || car.pitSpeedingEvidence?.active
  )).length;
  const pitSpeedingSlotsRemaining = Math.max(0, pitSpeedingIncidentQuota(snapshot.seed)
    - snapshot.investigations.filter((investigation) => investigation.infringement === "PIT_SPEEDING").length
    - reservedPitSpeedingSlots);
  const plannedPitSpeeders = new Set(tacticalCars
    .filter((car) => car.pitStatus === "PIT_ENTRY" && normalizeLapDistance(car.totalDistance) >= PIT_LANE_START)
    .sort((left, right) => {
      const risk = (car: RaceCarState) => {
        const driverRisk = DRIVER_BY_ID.get(car.driverId)?.risk ?? 6;
        const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
        return signedNoise(snapshot.seed, 74_000 + car.gridPosition, car.pitStops + 1) * 0.52
          + pitMistakeRiskBias(driverRisk)
          + localWater * 0.28
          + car.damageLevel * 0.22
          + clamp(car.brakeStress ?? 0, 0, 1) * 0.12
          + (car.paceMode === "ATTACK" ? 0.12 : car.paceMode === "PUSH" ? 0.06 : 0);
      };
      return risk(right) - risk(left);
    })
    .slice(0, pitSpeedingSlotsRemaining)
    .map((car) => car.carId));
  // A VSC delta breach is exceptional, not a field-wide dice roll. Only five
  // percent of race seeds nominate one eligible driver, and a race can never
  // nominate a second driver after any delta breach has been recorded.
  const vscViolationAlreadyRecorded = tacticalCars.some((car) => car.vscViolationCount > 0);
  const vscMistakeRoll = (signedNoise(snapshot.seed, 95_000, 0) + 1) / 2;
  const vscMistakeCandidates = tacticalCars.filter((car) => (
    !car.finished && car.incidentStatus === "RUNNING" && car.pitStatus === "TRACK"
  ));
  const vscMistakeCandidateIndex = Math.min(
    Math.max(0, vscMistakeCandidates.length - 1),
    Math.floor(((signedNoise(snapshot.seed, 95_001, 0) + 1) / 2) * vscMistakeCandidates.length),
  );
  const plannedVscOffenderId = incidentUpdate.raceControl === "VSC"
    && !vscViolationAlreadyRecorded
    && vscMistakeRoll < 0.05
    && vscMistakeCandidates.length > 0
    ? vscMistakeCandidates[vscMistakeCandidateIndex]?.carId ?? null
    : null;
  // One shared map coordinate represents the teams' individual pit boxes, so
  // completed stops need an explicit release queue. The longest-waiting ready
  // car receives priority; followers remain stationary until the lane gap is
  // physically clear. A three-percent race seed can nominate one crew error,
  // preserving rare unsafe releases without turning a mass stop into mass
  // penalties.
  const readyPitReleaseCarId = tacticalCars
    .filter((car) => car.pitStatus === "PIT_STOP" && car.pitTimer + FIXED_STEP_SECONDS + Number.EPSILON >= car.pitStopTargetSeconds)
    .sort((left, right) => (
      (right.pitTimer - right.pitStopTargetSeconds) - (left.pitTimer - left.pitStopTargetSeconds)
      || left.racePosition - right.racePosition
      || left.carId.localeCompare(right.carId)
    ))[0]?.carId ?? null;
  const unsafeReleaseAlreadyRecorded = snapshot.investigations.some((investigation) => investigation.infringement === "UNSAFE_RELEASE");
  const unsafeReleaseMistakeCandidates = tacticalCars.filter((car) => !car.finished && car.incidentStatus !== "RETIRED");
  const unsafeReleaseMistakeIndex = Math.min(
    Math.max(0, unsafeReleaseMistakeCandidates.length - 1),
    Math.floor(((signedNoise(snapshot.seed, 96_001, 0) + 1) / 2) * unsafeReleaseMistakeCandidates.length),
  );
  const plannedUnsafeReleaseCarId = !unsafeReleaseAlreadyRecorded
    && (signedNoise(snapshot.seed, 96_000, 0) + 1) / 2 < UNSAFE_RELEASE_MISTAKE_PROBABILITY_PER_RACE
    && unsafeReleaseMistakeCandidates.length > 0
    ? unsafeReleaseMistakeCandidates[unsafeReleaseMistakeIndex]?.carId ?? null
    : null;
  const unsafeRejoinAlreadyRecorded = snapshot.investigations.some((investigation) => investigation.infringement === "DANGEROUS_REJOIN");
  const unsafeRejoinMistakeCandidates = tacticalCars.filter((car) => !car.finished && car.incidentStatus !== "RETIRED");
  const unsafeRejoinMistakeIndex = Math.min(
    Math.max(0, unsafeRejoinMistakeCandidates.length - 1),
    Math.floor(((signedNoise(snapshot.seed, 97_001, 0) + 1) / 2) * unsafeRejoinMistakeCandidates.length),
  );
  const plannedUnsafeRejoinCarId = !unsafeRejoinAlreadyRecorded
    && (signedNoise(snapshot.seed, 97_000, 0) + 1) / 2 < UNSAFE_REJOIN_MISTAKE_PROBABILITY_PER_RACE
    && unsafeRejoinMistakeCandidates.length > 0
    ? unsafeRejoinMistakeCandidates[unsafeRejoinMistakeIndex]?.carId ?? null
    : null;
  const advancedCars = tacticalCars.map((car, index) => {
    if (car.finished) return car;
    const lapDistanceBefore = normalizeLapDistance(car.totalDistance);
    let pitStatus = car.pitStatus;
    let pitSpeedingEvidence = car.pitSpeedingEvidence ?? null;
    let pitLimiterFaultSeconds = car.pitLimiterFaultSeconds ?? 0;
    let pitLaneTimer = car.pitLaneTimer ?? 0;
    let pitTimer = car.pitTimer;
    let pitStops = car.pitStops;
    let tyreCompound = car.tyreCompound;
    let tyreAgeLaps = car.tyreAgeLaps;
    let tyreLife = car.tyreLife;
    let tyreTemperatures = car.tyreTemperatures ?? uniformTyreTemperatures(car.tyreTemperature);
    let tyreTemperature = car.tyreTemperature;
    let tyreSets = car.tyreSets;
    let activeTyreSetId = car.activeTyreSetId;
    let scheduledPitTyreSetId = car.scheduledPitTyreSetId;
    let brakeTemperatures = car.brakeTemperatures ?? uniformTyreTemperatures(car.brakeTemperature);
    let brakeTemperature = car.brakeTemperature;
    let powerUnitTemperature = car.powerUnitTemperature ?? 98;
    let gearboxTemperature = car.gearboxTemperature ?? 86;
    let energyStoreTemperature = car.energyStoreTemperature ?? 43;
    let powerUnitStress = car.powerUnitStress ?? 0;
    let gearboxStress = car.gearboxStress ?? 0;
    let energyStoreStress = car.energyStoreStress ?? 0;
    let brakeStress = car.brakeStress ?? 0;
    let thermalDeratePercent = car.thermalDeratePercent ?? 0;
    let thermalRiskPercent = car.thermalRiskPercent ?? 0;
    let scheduledPitCompound = car.scheduledPitCompound;
    let pitStopTargetSeconds = car.pitStopTargetSeconds;
    let lastPitStopTime = car.lastPitStopTime;
    let lastPitStopCompletedAt = car.lastPitStopCompletedAt ?? null;
    let lastPitLaneTime = car.lastPitLaneTime ?? null;
    let pitStopIssue: PitStopIssue = car.pitStopIssue;
    let usedTyreCompounds = car.usedTyreCompounds;
    let penaltyServiceId = car.penaltyServiceId ?? null;
    let penaltyServiceIds = [...(car.penaltyServiceIds ?? (penaltyServiceId ? [penaltyServiceId] : []))];
    let penaltyServiceType = car.penaltyServiceType ?? null;
    let pitServicePhase = car.pitServicePhase ?? "NONE";
    let penaltyHoldSeconds = car.penaltyHoldSeconds ?? 0;
    let penaltyHoldElapsedSeconds = car.penaltyHoldElapsedSeconds ?? 0;
    let pitTyreServiceTargetSeconds = car.pitTyreServiceTargetSeconds ?? car.pitStopTargetSeconds;
    let pitTyreServiceElapsedSeconds = car.pitTyreServiceElapsedSeconds ?? 0;
    let lastPenaltyHoldSeconds = car.lastPenaltyHoldSeconds ?? 0;
    let lastPenaltyServedAt = car.lastPenaltyServedAt ?? null;
    let servePenaltyRequested = car.servePenaltyRequested ?? false;
    const pendingMandatoryPenalty = pendingMandatoryPenaltyByCar.get(car.carId);
    const pendingTimePenalties = pendingTimePenaltiesByCar.get(car.carId) ?? [];
    const localWater = effectiveWaterAtDistance(weather, lapDistanceBefore, SILVERSTONE_CIRCUIT.lengthMeters);
    const energyContext = energyContextFor(car, incidentUpdate.raceControl, localWater, weather.airTemperature);
    let energySystem = updateEnergySystem({
      state: migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature),
      requestedMode: car.energyMode,
      context: energyContext,
      profile: energyProfileForTeam(car.teamId),
      deltaTimeSeconds: FIXED_STEP_SECONDS,
    }).state;
    const energyTactics = energyTacticsFor(car, energySystem, incidentUpdate.raceControl, localWater);
    const tacticalCar: RaceCarState = {
      ...car,
      ...energyTactics,
      // Keep the command as a baseline tendency. Automatic OVT may temporarily
      // replace deploymentMode inside the PU state without overwriting it.
      energyMode: car.energyMode,
      energySystem,
      batteryPercent: energySystem.stateOfCharge * 100,
      energyStoreTemperature: energySystem.batteryTemperatureC,
    };

    const mandatoryCrossingsRemaining = pendingMandatoryPenalty ? penaltyCrossingsRemaining(pendingMandatoryPenalty) : null;
    const aiPenaltyWindow = pendingMandatoryPenalty
      && car.teamId !== snapshot.playerTeamId
      && pendingMandatoryPenalty.lineCrossingsAfterIssue >= (car.gridPosition % 2 === 0 ? 0 : 1);
    const mandatoryPenaltyDue = pendingMandatoryPenalty
      && (servePenaltyRequested || aiPenaltyWindow || (mandatoryCrossingsRemaining !== null && mandatoryCrossingsRemaining <= 1))
      && incidentUpdate.raceControl !== "VSC"
      && incidentUpdate.raceControl !== "SAFETY_CAR"
      && incidentUpdate.raceControl !== "RED_FLAG"
      && incidentUpdate.pitLaneOpen;
    /*
     * The pit entry can only be taken in the window that begins at the entry line
     * and ends before the box. Allowing it anywhere past the entry line meant a
     * car could commit with the box already behind it and arrive at the stop
     * without ever driving the lane.
     */
    const inPitEntryWindow = lapDistanceBefore >= PIT_ENTRY_START && lapDistanceBefore < PIT_LANE_START;
    if (pitStatus === "TRACK" && mandatoryPenaltyDue && car.totalDistance >= 0 && inPitEntryWindow) {
      pitStatus = "PIT_ENTRY";
      pitLaneTimer = 0;
      penaltyServiceId = pendingMandatoryPenalty.id;
      penaltyServiceIds = [pendingMandatoryPenalty.id];
      penaltyServiceType = pendingMandatoryPenalty.type;
      pitServicePhase = pendingMandatoryPenalty.type === "DRIVE_THROUGH" ? "DRIVE_THROUGH" : "STOP_GO_HOLD";
      penaltyHoldSeconds = pendingMandatoryPenalty.type === "STOP_GO_10" ? 10 : 0;
      penaltyHoldElapsedSeconds = 0;
      pitTyreServiceElapsedSeconds = 0;
      servePenaltyRequested = false;
      servingPenaltyIds.add(pendingMandatoryPenalty.id);
    } else if (pitStatus === "TRACK" && scheduledPitCompound && incidentUpdate.pitLaneOpen && car.totalDistance >= 0 && inPitEntryWindow) {
      pitStatus = "PIT_ENTRY";
      pitLaneTimer = 0;
    }
    /*
     * Each pit phase has to be held for at least one tick. Chaining the entry,
     * lane and box transitions in a single step let a car that crossed the entry
     * line beyond the box distance skip straight to the stop, so it appeared to
     * teleport to the pit exit instead of driving down the lane.
     */
    const enteredPitThisStep = car.pitStatus === "TRACK" && pitStatus === "PIT_ENTRY";
    if (!enteredPitThisStep && pitStatus === "PIT_ENTRY" && lapDistanceBefore >= PIT_LANE_START) pitStatus = "PIT_LANE";
    const joinedLaneThisStep = car.pitStatus !== "PIT_LANE" && pitStatus === "PIT_LANE";
    // Each team stops at its own garage, so the box the car is driving to is the
    // one that belongs to it rather than a single shared point in the lane.
    const teamBoxDistance = pitBoxDistanceForTeam(car.teamId);
    if (!joinedLaneThisStep && pitStatus === "PIT_LANE" && lapDistanceBefore >= teamBoxDistance) {
      if (penaltyServiceType === "DRIVE_THROUGH") {
        pitStatus = "PIT_EXIT";
      } else {
        pitStatus = "PIT_STOP";
        pitTimer = 0;
        penaltyHoldElapsedSeconds = 0;
        pitTyreServiceElapsedSeconds = 0;
        if (penaltyServiceType === "STOP_GO_10") {
          pitStopIssue = "NONE";
          pitStopTargetSeconds = 10;
          pitServicePhase = "STOP_GO_HOLD";
          penaltyHoldSeconds = 10;
          pitTyreServiceTargetSeconds = 0;
        } else {
          const operation = resolvePitStopExecution({
            seed: snapshot.seed,
            tick,
            elapsedTime,
            pitLaneOpen: incidentUpdate.pitLaneOpen,
            cars: tacticalCars,
          }, car.carId);
          pitStopIssue = operation.issue;
          penaltyServiceIds = pendingTimePenalties.map((penalty) => penalty.id);
          penaltyServiceId = penaltyServiceIds[0] ?? null;
          penaltyServiceType = pendingTimePenalties[0]?.type ?? null;
          penaltyHoldSeconds = pendingTimePenalties.reduce((total, penalty) => total + penalty.seconds, 0);
          pitTyreServiceTargetSeconds = operation.tyreServiceSeconds;
          pitStopTargetSeconds = operation.stationarySeconds + penaltyHoldSeconds;
          pitServicePhase = penaltyHoldSeconds > 0 ? "PENALTY_HOLD" : "TYRE_SERVICE";
          for (const id of penaltyServiceIds) servingPenaltyIds.add(id);
        }
      }
    }

    if (pitStatus === "PIT_STOP") {
      pitTimer += FIXED_STEP_SECONDS;
      if (pitServicePhase === "PENALTY_HOLD" || pitServicePhase === "STOP_GO_HOLD") {
        penaltyHoldElapsedSeconds = Math.min(penaltyHoldSeconds, pitTimer);
        if (pitServicePhase === "PENALTY_HOLD" && pitTimer >= penaltyHoldSeconds) pitServicePhase = "TYRE_SERVICE";
      }
      if (pitServicePhase === "TYRE_SERVICE") pitTyreServiceElapsedSeconds = Math.min(pitTyreServiceTargetSeconds, Math.max(0, pitTimer - penaltyHoldSeconds));
      if (pitTimer >= pitStopTargetSeconds) {
        const releaseTraffic = tacticalCars.filter((candidate) => (
          candidate.carId !== car.carId
          && !candidate.finished
          && candidate.incidentStatus !== "RETIRED"
          && (candidate.pitStatus === "PIT_LANE" || candidate.pitStatus === "PIT_EXIT")
        ));
        const nearestReleaseTraffic = releaseTraffic.reduce(
          (nearest, candidate) => Math.min(nearest, Math.abs(candidate.totalDistance - car.totalDistance)),
          Number.POSITIVE_INFINITY,
        );
        const nearestApproachingTraffic = releaseTraffic.reduce((nearest, candidate) => {
          const gapBehind = car.totalDistance - candidate.totalDistance;
          return gapBehind >= 0 ? Math.min(nearest, gapBehind) : nearest;
        }, Number.POSITIVE_INFINITY);
        const plannedReleaseMistake = car.carId === plannedUnsafeReleaseCarId && nearestApproachingTraffic < 18;
        const hasReleasePriority = readyPitReleaseCarId === null || readyPitReleaseCarId === car.carId;
        const releaseBlocked = !plannedReleaseMistake
          && (!hasReleasePriority || nearestReleaseTraffic < PIT_RELEASE_SAFE_GAP_METERS);

        if (releaseBlocked) {
          pitServicePhase = "RELEASE_HOLD";
        } else {
          pitStatus = "PIT_EXIT";
          const stopGoOnly = penaltyServiceType === "STOP_GO_10";
          lastPitStopTime = stopGoOnly ? lastPitStopTime : pitTyreServiceTargetSeconds;
          lastPitStopCompletedAt = elapsedTime;
          lastPenaltyHoldSeconds = penaltyHoldSeconds;
          if (penaltyServiceIds.length > 0) lastPenaltyServedAt = elapsedTime;
          pitTimer = 0;
          if (!stopGoOnly) pitStops += 1;
          tyreCompound = stopGoOnly ? tyreCompound : scheduledPitCompound ?? tyreCompound;
          if (!stopGoOnly && scheduledPitTyreSetId) {
            tyreSets = tyreSets.map((set) => set.id === activeTyreSetId
              ? { ...set, status: "USED" as const, condition: tyreLife, lapsUsed: tyreAgeLaps }
              : set.id === scheduledPitTyreSetId
                ? { ...set, status: "FITTED" as const }
                : set);
            activeTyreSetId = scheduledPitTyreSetId;
          }
          if (!stopGoOnly) {
            usedTyreCompounds = [...usedTyreCompounds, tyreCompound];
            scheduledPitCompound = null;
            scheduledPitTyreSetId = null;
            tyreAgeLaps = 0;
            tyreLife = 100;
            tyreTemperatures = uniformTyreTemperatures(82);
            tyreTemperature = 82;
          }
          pitServicePhase = "NONE";
          for (const id of penaltyServiceIds) servedPenaltyIds.add(id);
        }
      }
    }
    if (pitStatus !== "TRACK") pitLaneTimer += FIXED_STEP_SECONDS;

    const stoppedInBox = pitStatus === "PIT_STOP";
    const released = elapsedTime >= car.reactionTime;
    const incidentSpeedFactor = car.incidentStatus === "SPUN" ? 0.12 : car.incidentStatus === "DAMAGED" ? Math.max(0.82, 1 - car.damageLevel * 0.18) : 1;
    const activeTeamOrder = snapshot.teamOrder ?? { type: "NONE" as const, issuedAt: 0, leadCarId: null, trailingCarId: null };
    const teamOrderLead = activeTeamOrder.leadCarId ? tacticalCars.find((candidate) => candidate.carId === activeTeamOrder.leadCarId) : null;
    const teamOrderTrail = activeTeamOrder.trailingCarId ? tacticalCars.find((candidate) => candidate.carId === activeTeamOrder.trailingCarId) : null;
    const teamOrderGapMeters = teamOrderLead && teamOrderTrail ? Math.abs(teamOrderLead.totalDistance - teamOrderTrail.totalDistance) : Infinity;
    const teamOrderFactor = incidentUpdate.raceControl !== "GREEN" || pitStatus !== "TRACK"
      ? 1
      : activeTeamOrder.type === "SWAP_CARS" && teamOrderGapMeters <= 220
        ? car.carId === activeTeamOrder.leadCarId ? 0.966 : car.carId === activeTeamOrder.trailingCarId ? 1.008 : 1
        : activeTeamOrder.type === "HOLD_POSITION" && teamOrderGapMeters <= 140 && car.carId === activeTeamOrder.trailingCarId
          ? 0.982
          : 1;
    const unconstrainedTarget = targetSpeedKph({ ...tacticalCar, tyreCompound }, index, snapshot.seed, tick, localWater) * incidentSpeedFactor * teamOrderFactor;
    let vscDeltaSeconds = car.vscDeltaSeconds;
    let vscViolationSeconds = car.vscViolationSeconds;
    let vscComplianceStatus = car.vscComplianceStatus;
    let vscViolationCount = car.vscViolationCount;
    let trackLimitsWarnings = car.trackLimitsWarnings ?? 0;
    let blueFlagActive = car.blueFlagActive ?? false;
    let blueFlagSeconds = car.blueFlagSeconds ?? 0;
    let blueFlagWarnings = car.blueFlagWarnings ?? 0;
    const yellowInstruction = localYellowInstructionFor(car.currentSector, incidentUpdate.raceControl, incidentUpdate.yellowSector);
    const safetyQueueEntry = incidentUpdate.safetyCarFormation?.queue.find((entry) => entry.carId === car.carId);
    const safetyWaveByEntry = incidentUpdate.safetyCarWaveBy.find((entry) => entry.carId === car.carId);
    let controlledTarget = unconstrainedTarget;
    if (pitStatus === "TRACK") {
      if (yellowInstruction.applies) {
        controlledTarget = Math.min(unconstrainedTarget * yellowInstruction.speedFactor, yellowInstruction.maximumSpeedKph ?? Infinity);
      } else if (incidentUpdate.raceControl === "VSC") {
        const correction = vscComplianceStatus === "VIOLATION" ? 0.88
          : vscComplianceStatus === "WARNING" ? 0.94
            : vscDeltaSeconds > 0.8 ? 1.025 : 1;
        controlledTarget = unconstrainedTarget * VSC_SPEED_FACTOR * correction;
      } else if (incidentUpdate.raceControl === "SAFETY_CAR") {
        if (incidentUpdate.safetyCarPhase === "RESTART" && incidentUpdate.safetyCarInPitLane && car.racePosition === 1) {
          // Once the lights are out and the SC turns into the pits, P1 dictates
          // the restart pace while every following car retains frozen order.
          controlledTarget = unconstrainedTarget;
        } else if (safetyWaveByEntry?.active === true && !safetyWaveByEntry.completed) {
          const distanceRemaining = safetyWaveByEntry.targetDistance - car.totalDistance;
          if (incidentUpdate.safetyCarLappedCarsMayOvertake && !safetyWaveByEntry.completed && distanceRemaining > 0) {
            const waveByGain = Math.max(120, Math.min(180, distanceRemaining * 0.18));
            controlledTarget = Math.min(305, Math.max(incidentUpdate.safetyCarSpeed + waveByGain, 245));
          } else {
            controlledTarget = Math.min(unconstrainedTarget, Math.max(80, incidentUpdate.safetyCarSpeed));
          }
        } else if (safetyQueueEntry) {
          const catchUpKph = Math.max(-105, Math.min(82, safetyQueueEntry.distanceToTargetMeters * 1.05));
          controlledTarget = Math.max(45, Math.min(235, incidentUpdate.safetyCarSpeed + catchUpKph));
        } else {
          // A car rejoining from the pits must never fall through to green-flag
          // pace merely because it was absent from this tick's queue snapshot.
          controlledTarget = Math.min(unconstrainedTarget, Math.max(80, incidentUpdate.safetyCarSpeed + 10));
        }
      } else if (incidentUpdate.raceControl === "RED_FLAG") {
        const rollingRestart = incidentUpdate.redFlagRestartType === "ROLLING";
        controlledTarget = incidentUpdate.redFlagPhase === "RESTART_FORMATION"
          ? rollingRestart ? 95 : 62
          : incidentUpdate.redFlagPhase === "RESTART_COUNTDOWN" && rollingRestart ? 105 : 0;
      }
      if (tick % 5 === 0) blueFlagActive = incidentUpdate.raceControl === "GREEN" && blueFlagRequiredFor(car, blueFlagReference);
      if (blueFlagActive) {
        // Drivers comply automatically by creating a decisive speed delta;
        // the player manages strategy, not each mandatory blue-flag lift.
        controlledTarget *= 0.86;
      }
    }
    const racingTarget = released ? controlledTarget : 0;
    const inPitLimiterZone = pitStatus === "PIT_LANE" || pitStatus === "PIT_EXIT";
    const targetKph = pitStatus === "PIT_ENTRY"
      ? Math.min(120, racingTarget)
      : inPitLimiterZone ? Math.min(FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph, racingTarget) : racingTarget;
    const unconstrainedCurrentSpeed = stoppedInBox ? 0 : released ? car.currentSpeed + (targetKph - car.currentSpeed) * 0.16 : 0;
    const enteredLimiterThisStep = car.pitStatus === "PIT_ENTRY" && pitStatus === "PIT_LANE";
    if (enteredLimiterThisStep && plannedPitSpeeders.has(car.carId)) pitLimiterFaultSeconds = 0.4;
    const plannedPitSpeeding = inPitLimiterZone && pitLimiterFaultSeconds > 0;
    const limiterMistakeKph = FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph
      + 0.3
      + ((signedNoise(snapshot.seed, 74_500 + car.gridPosition, car.pitStops + 1) + 1) / 2) * 2.7;
    // Entry-road braking is legal before the limiter line. At and beyond that
    // line a normal car is hard-capped at 80 km/h; only the race's two or three
    // planned, one-tick limiter mistakes may briefly exceed it.
    const currentSpeed = plannedPitSpeeding
      ? limiterMistakeKph
      : inPitLimiterZone ? Math.min(FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph, unconstrainedCurrentSpeed) : unconstrainedCurrentSpeed;
    const distanceDelta = (currentSpeed / 3.6) * FIXED_STEP_SECONDS;
    const pitSpeedTolerance = FIA_2026_PENALTY_RULES.pitLaneSpeeding.sensorToleranceKph;
    if (inPitLimiterZone && currentSpeed > FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph + pitSpeedTolerance) {
      const previousEvidence = pitSpeedingEvidence?.active ? pitSpeedingEvidence : null;
      const sampleCount = (previousEvidence?.sampleCount ?? 0) + 1;
      const durationSeconds = (previousEvidence?.durationSeconds ?? 0) + FIXED_STEP_SECONDS;
      pitSpeedingEvidence = {
        active: true,
        confirmed: sampleCount >= FIA_2026_PENALTY_RULES.pitLaneSpeeding.minimumStableSampleCount
          && durationSeconds + Number.EPSILON >= FIA_2026_PENALTY_RULES.pitLaneSpeeding.minimumDurationSeconds,
        startedAt: previousEvidence?.startedAt ?? elapsedTime,
        entrySpeedKph: previousEvidence?.entrySpeedKph ?? currentSpeed,
        maximumSpeedKph: Math.max(previousEvidence?.maximumSpeedKph ?? 0, currentSpeed),
        excessSpeedSumKph: (previousEvidence?.excessSpeedSumKph ?? 0) + Math.max(0, currentSpeed - FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph),
        sampleCount,
        durationSeconds,
        distanceMetres: (previousEvidence?.distanceMetres ?? 0) + distanceDelta,
        limiterActive: !plannedPitSpeeding,
      };
    } else {
      pitSpeedingEvidence = null;
    }
    pitLimiterFaultSeconds = Math.max(0, pitLimiterFaultSeconds - FIXED_STEP_SECONDS);
    if (incidentUpdate.raceControl === "VSC" && pitStatus === "TRACK") {
      const representativeGreenSeconds = distanceDelta / Math.max(1, unconstrainedTarget / 3.6);
      const targetStepSeconds = vscTargetElapsedSeconds(representativeGreenSeconds);
      const rawNextDelta = clamp(vscDeltaSeconds + FIXED_STEP_SECONDS - targetStepSeconds, -9.999, 9.999);
      const inDeploymentGrace = incidentUpdate.raceControlTimer > 32.5;
      const hasExistingDeltaRisk = car.vscComplianceStatus !== "COMPLIANT" || car.vscViolationSeconds > 0;
      const plannedMistakeActive = car.carId === plannedVscOffenderId
        && car.vscViolationCount === 0
        && incidentUpdate.raceControlTimer <= 24
        && !inDeploymentGrace;
      // The driver normally follows the dashboard delta automatically. During
      // deployment grace we initialise a safe positive margin instead of
      // carrying green-to-VSC deceleration transients into the judged window.
      // A pre-existing warning (including stewarding test evidence) remains
      // untouched, while the one rare planned mistake can drift briefly red.
      const nextDelta = inDeploymentGrace
        ? 0.35
        : plannedMistakeActive
          ? Math.max(-0.18, vscDeltaSeconds - 0.045)
          : hasExistingDeltaRisk
            ? rawNextDelta
            : clamp(rawNextDelta, 0.18, 1.25);
      const compliance = updateVscCompliance({
        actualElapsedSeconds: nextDelta,
        targetElapsedSeconds: 0,
        previousViolationSeconds: vscViolationSeconds,
        stepSeconds: FIXED_STEP_SECONDS,
      });
      vscDeltaSeconds = compliance.deltaSeconds;
      vscViolationSeconds = inDeploymentGrace ? 0 : compliance.violationSeconds;
      vscComplianceStatus = inDeploymentGrace ? "COMPLIANT" : compliance.status;
      if (vscComplianceStatus === "VIOLATION" && car.vscComplianceStatus !== "VIOLATION") {
        vscViolationCount += 1;
        const driver = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.carId;
        const message = `${driver} VSC DELTA VIOLATION · ${vscDeltaSeconds.toFixed(3)}s`;
        const investigationMessage = `CAR ${DRIVER_BY_ID.get(car.driverId)?.number ?? "—"} (${driver}) VSC DELTA VIOLATION · UNDER INVESTIGATION`;
        vscEvents.push({ id: `${tick}-${car.carId}-vsc`, elapsedTime, type: "RACE_CONTROL", message, carId: car.carId });
        vscRadio.push({ id: `${tick}-${car.carId}-vsc-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message: investigationMessage, priority: "URGENT" });
      }
    } else {
      vscDeltaSeconds = 0;
      vscViolationSeconds = 0;
      vscComplianceStatus = "COMPLIANT";
    }
    const totalDistance = car.totalDistance + distanceDelta;
    const lapDistanceAfter = normalizeLapDistance(totalDistance);
    const crossedEnergyTimingLine = Math.floor(totalDistance / SILVERSTONE_CIRCUIT.lengthMeters) > Math.floor(car.totalDistance / SILVERSTONE_CIRCUIT.lengthMeters);
    if (crossedEnergyTimingLine) crossedLineCarIds.add(car.carId);
    if (blueFlagActive) {
      blueFlagSeconds += FIXED_STEP_SECONDS;
      if (Math.floor(blueFlagSeconds / 8) > Math.floor((car.blueFlagSeconds ?? 0) / 8)) {
        blueFlagWarnings += 1;
        const driver = DRIVER_BY_ID.get(car.driverId);
        const message = `BLUE FLAGS · CAR ${driver?.number ?? "—"} (${driver?.shortName ?? car.carId}) MUST LET THE FASTER CAR PASS`;
        sportingEvents.push({ id: `${tick}-${car.carId}-blue-${blueFlagWarnings}`, elapsedTime, type: "RACE_CONTROL", message, carId: car.carId });
        sportingRadio.push({ id: `${tick}-${car.carId}-blue-radio-${blueFlagWarnings}`, elapsedTime, carId: car.carId, source: "RACE CONTROL", message, priority: blueFlagWarnings >= 3 ? "URGENT" : "WARNING" });
      }
    } else {
      blueFlagSeconds = 0;
      blueFlagWarnings = 0;
    }
    if (crossedEnergyTimingLine
      && car.currentLap > 3
      && car.incidentStatus === "RUNNING"
      && car.damageLevel < 0.65
      && (car.paceMode === "ATTACK" || car.paceMode === "PUSH")) {
      // Track-limit strikes are uncommon driver errors. The opening three laps
      // are protected, then risk rises slightly with aggressive pace and worn
      // tyres; rain reduces the rate because drivers naturally leave margin.
      const paceRisk = car.paceMode === "ATTACK" ? 0.032 : 0.014;
      const wornTyreRisk = clamp((35 - car.tyreLife) / 35, 0, 1) * 0.018;
      const wetCautionFactor = 1 - clamp(localWater * 0.55, 0, 0.45);
      const violationProbability = (paceRisk + wornTyreRisk) * wetCautionFactor;
      const violationRoll = (signedNoise(snapshot.seed, 92_000 + index, car.currentLap) + 1) / 2;
      if (violationRoll < violationProbability) {
        trackLimitsWarnings += 1;
        const driver = DRIVER_BY_ID.get(car.driverId);
        const label = trackLimitsWarnings < 3
          ? `TRACK LIMITS STRIKE ${trackLimitsWarnings}/3`
          : trackLimitsWarnings === 3
            ? "BLACK AND WHITE FLAG · TRACK LIMITS"
            : `TRACK LIMITS OFFENCE ${trackLimitsWarnings} · STEWARDS REVIEW`;
        const message = `CAR ${driver?.number ?? "—"} (${driver?.shortName ?? car.carId}) · ${label}`;
        sportingEvents.push({ id: `${tick}-${car.carId}-limits-${trackLimitsWarnings}`, elapsedTime, type: "RACE_CONTROL", message, carId: car.carId });
        sportingRadio.push({ id: `${tick}-${car.carId}-limits-radio-${trackLimitsWarnings}`, elapsedTime, carId: car.carId, source: "RACE CONTROL", message, priority: trackLimitsWarnings >= 4 ? "URGENT" : "WARNING" });
      }
    }
    if (crossedEnergyTimingLine) energySystem = completeEnergyLap(energySystem);
    const crossedOvertakeDetection = !crossedEnergyTimingLine
      && lapDistanceBefore < SILVERSTONE_OVERTAKE_DETECTION_DISTANCE
      && lapDistanceAfter >= SILVERSTONE_OVERTAKE_DETECTION_DISTANCE;
    if (crossedOvertakeDetection) {
      const detectedWithinOneSecond = incidentUpdate.raceControl === "GREEN"
        && pitStatus === "TRACK"
        && car.racePosition > 1
        && car.gapToCarAhead > 0
        && car.gapToCarAhead <= ENERGY_SYSTEM_CONFIG.overtakeMaximumGapSeconds;
      energySystem = {
        ...energySystem,
        overtakeEntitlementLap: detectedWithinOneSecond ? car.currentLap + 1 : null,
      };
    }
    if (pitStatus === "PIT_EXIT" && lapDistanceAfter >= PIT_EXIT_END && lapDistanceAfter < PIT_ENTRY_START) {
      lastPitLaneTime = pitLaneTimer;
      pitLaneTimer = 0;
      pitStatus = "TRACK";
      for (const id of penaltyServiceIds) servedPenaltyIds.add(id);
      penaltyServiceId = null;
      penaltyServiceIds = [];
      penaltyServiceType = null;
      pitServicePhase = "NONE";
      penaltyHoldSeconds = 0;
      penaltyHoldElapsedSeconds = 0;
      pitTyreServiceElapsedSeconds = 0;
      const driver = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId;
      const stopTime = lastPitStopTime ?? pitStopTargetSeconds;
      const message = `${driver} PIT COMPLETE · TOTAL ${lastPitLaneTime.toFixed(1)}s · TYRES ${stopTime.toFixed(2)}s`;
      pitEvents.push({ id: `${tick}-${car.carId}-pit-complete`, elapsedTime, type: "PIT", message, carId: car.carId });
      if (car.teamId === snapshot.playerTeamId) {
        pitRadio.push({ id: `${tick}-${car.carId}-pit-radio`, elapsedTime, carId: car.carId, source: "ENGINEER", message, priority: "NORMAL" });
      }
    }
    tyreTemperatures = advanceTyreTemperatures(
      tacticalCar,
      tyreTemperatures,
      tyreCompound,
      {
        previousSpeedKph: car.currentSpeed,
        currentSpeedKph: currentSpeed,
        lapDistance: lapDistanceAfter,
        localWater,
        rainIntensity: weather.rainIntensity,
        airTemperature: weather.airTemperature,
        trackTemperature: weather.trackTemperature,
        pitStatus,
      },
    );
    tyreTemperature = averageTyreTemperature(tyreTemperatures);
    ({ powerUnitTemperature, gearboxTemperature, energyStoreTemperature } = advancePowerUnitTemperatures(
      tacticalCar,
      { powerUnitTemperature, gearboxTemperature, energyStoreTemperature },
      {
        previousSpeedKph: car.currentSpeed,
        currentSpeedKph: currentSpeed,
        lapDistance: lapDistanceAfter,
        localWater,
        rainIntensity: weather.rainIntensity,
        airTemperature: weather.airTemperature,
        trackTemperature: weather.trackTemperature,
        pitStatus,
      },
    ));
    energyStoreTemperature = energySystem.batteryTemperatureC;
    const segmentKind = SILVERSTONE_CIRCUIT.segments[segmentIndexAtDistance(lapDistanceAfter)].kind;
    const cornerLoad = cornerThermalLoadAtDistance(lapDistanceAfter);
    brakeTemperatures = advanceBrakeTemperatures(brakeTemperatures, {
      previousSpeedKph: car.currentSpeed,
      currentSpeedKph: currentSpeed,
      segmentKind,
      cornerIntensity: cornerLoad.intensity,
      hotterSide: cornerLoad.hotterSide,
      localWater,
      airTemperature: weather.airTemperature,
      pitStopped: stoppedInBox,
      brakeBiasPercent: tacticalCar.brakeBiasPercent ?? 56.5,
      coolingMode: tacticalCar.coolingMode ?? "NORMAL",
    }, FIXED_STEP_SECONDS);
    brakeTemperature = averageCornerTemperature(brakeTemperatures);
    powerUnitStress = advanceThermalStress(powerUnitStress, powerUnitTemperature, THERMAL_THRESHOLDS.powerUnit.warning, THERMAL_THRESHOLDS.powerUnit.critical, FIXED_STEP_SECONDS);
    gearboxStress = advanceThermalStress(gearboxStress, gearboxTemperature, THERMAL_THRESHOLDS.gearbox.warning, THERMAL_THRESHOLDS.gearbox.critical, FIXED_STEP_SECONDS);
    energyStoreStress = advanceThermalStress(energyStoreStress, energyStoreTemperature, THERMAL_THRESHOLDS.energyStore.warning, THERMAL_THRESHOLDS.energyStore.critical, FIXED_STEP_SECONDS);
    brakeStress = advanceThermalStress(brakeStress, Math.max(...Object.values(brakeTemperatures)), THERMAL_THRESHOLDS.brakes.warning, THERMAL_THRESHOLDS.brakes.critical, FIXED_STEP_SECONDS);
    const thermalAssessment = assessVehicleThermals({
      ...tacticalCar,
      tyreCompound,
      tyreTemperatures,
      tyreTemperature,
      brakeTemperatures,
      brakeTemperature,
      powerUnitTemperature,
      gearboxTemperature,
      energyStoreTemperature,
      energySystem,
      batteryPercent: energySystem.stateOfCharge * 100,
      powerUnitStress,
      gearboxStress,
      energyStoreStress,
      brakeStress,
    });
    thermalDeratePercent = thermalAssessment.deratePercent;
    thermalRiskPercent = thermalAssessment.reliabilityRiskPercent;
    const wetTyreDryPenalty = tyreCompound === "INTERMEDIATE" || tyreCompound === "WET" ? 1 + (1 - localWater) * 1.5 : 1;
    tyreLife = Math.max(0, tyreLife - distanceDelta * 0.00054 * PACE_WEAR[car.paceMode] * TYRE_WEAR[car.tyreMode] * COMPOUND_WEAR[tyreCompound] * wetTyreDryPenalty);
    tyreAgeLaps += distanceDelta / SILVERSTONE_CIRCUIT.lengthMeters;
    tyreSets = tyreSets.map((set) => set.id === activeTyreSetId ? { ...set, condition: tyreLife, lapsUsed: tyreAgeLaps } : set);
    const fuelRemainingKg = Math.max(0, car.fuelRemainingKg - distanceDelta * 0.00032 * PACE_FUEL[car.paceMode] * COOLING_FUEL[tacticalCar.coolingMode ?? "NORMAL"]);
    const finished = totalDistance >= raceDistance;
    let incidentStatus = car.incidentStatus;
    let incidentTimer = car.incidentTimer;
    const thermalDamage = Math.max(0, thermalRiskPercent - 24) * 0.000002 * FIXED_STEP_SECONDS;
    const damageLevel = Math.min(1, car.damageLevel + thermalDamage);
    if (incidentStatus === "SPUN") {
      incidentTimer = Math.max(0, incidentTimer - FIXED_STEP_SECONDS);
      if (incidentTimer === 0) {
        const nearestPassingCar = tacticalCars
          .filter((candidate) => candidate.carId !== car.carId
            && !candidate.finished
            && candidate.incidentStatus === "RUNNING"
            && candidate.pitStatus === "TRACK")
          .reduce((nearest, candidate) => Math.min(nearest, Math.abs(candidate.totalDistance - totalDistance)), Number.POSITIVE_INFINITY);
        const plannedRejoinMistake = car.carId === plannedUnsafeRejoinCarId && nearestPassingCar < 45;
        if (nearestPassingCar < 55 && !plannedRejoinMistake) {
          // The driver waits off-line for a safe opening instead of blindly
          // rejoining as the countdown expires. Recheck twice per second.
          incidentTimer = 0.5;
        } else {
          incidentStatus = "RUNNING";
        }
      }
    }
    const positioned = withPositionData({
      ...tacticalCar,
      currentSpeed,
      totalDistance,
      totalRaceTime: elapsedTime,
      tyreLife,
      tyreAgeLaps,
      tyreCompound,
      tyreTemperatures,
      tyreTemperature,
      tyreSets,
      activeTyreSetId,
      scheduledPitTyreSetId,
      brakeTemperatures,
      brakeTemperature,
      powerUnitTemperature,
      gearboxTemperature,
      energyStoreTemperature,
      energySystem,
      batteryPercent: energySystem.stateOfCharge * 100,
      powerUnitStress,
      gearboxStress,
      energyStoreStress,
      brakeStress,
      thermalDeratePercent,
      thermalRiskPercent,
      pitStatus,
      pitSpeedingEvidence,
      pitLimiterFaultSeconds,
      pitLaneTimer,
      pitTimer,
      pitStopTargetSeconds,
      lastPitStopTime,
      lastPitStopCompletedAt,
      lastPitLaneTime,
      pitStopIssue,
      pitStops,
      scheduledPitCompound,
      usedTyreCompounds,
      penaltyServiceId,
      penaltyServiceIds,
      penaltyServiceType,
      pitServicePhase,
      penaltyHoldSeconds,
      penaltyHoldElapsedSeconds,
      pitTyreServiceTargetSeconds,
      pitTyreServiceElapsedSeconds,
      lastPenaltyHoldSeconds,
      lastPenaltyServedAt,
      servePenaltyRequested,
      incidentStatus,
      incidentTimer,
      damageLevel,
      vscDeltaSeconds,
      vscViolationSeconds,
      vscComplianceStatus,
      vscViolationCount,
      trackLimitsWarnings,
      blueFlagActive,
      blueFlagSeconds,
      blueFlagWarnings,
      safetyCarQueuePosition: safetyQueueEntry?.queuePosition ?? null,
      safetyCarGapToTargetMeters: safetyQueueEntry ? safetyQueueEntry.targetTotalDistance - totalDistance : null,
      fuelRemainingKg,
      finished,
      finishTime: finished ? elapsedTime : null,
    });
    return positioned;
  });

  const controlledCars = enforceRaceControlOrder(
    advancedCars,
    snapshot.cars,
    incidentUpdate.raceControl,
    incidentUpdate.yellowSector,
    incidentUpdate.safetyCarPhase === "RESTART" && incidentUpdate.safetyCarInPitLane
      ? null
      : incidentUpdate.safetyCarFormation,
    incidentUpdate.safetyCarWaveBy
      .filter((entry) => entry.active === true && !entry.completed)
      .map((entry) => entry.carId),
  );
  const timedCars = controlledCars.map((car) => {
    const previous = snapshot.cars.find((candidate) => candidate.carId === car.carId);
    if (!previous || previous.finished) return car;
    const crossedFinishLine = car.totalDistance >= raceDistance;
    const finished = car.incidentStatus === "RETIRED" || crossedFinishLine;
    const corrected = {
      ...car,
      finished,
      finishTime: crossedFinishLine ? car.finishTime ?? elapsedTime : null,
    };
    return withTimingData(previous, corrected, elapsedTime);
  });
  const rankedCars = rankCars(timedCars, incidentUpdate.raceControl);
  const battleEvents: RaceEvent[] = [];
  const battleRadio: RadioMessage[] = [];
  const cars = rankedCars.map((car) => {
    const previous = snapshot.cars.find((candidate) => candidate.carId === car.carId);
    if (!previous) return car;
    if (incidentUpdate.raceControl !== "GREEN" || car.pitStatus !== "TRACK" || car.finished) {
      return previous.pendingOvertake ? { ...car, pendingOvertake: null } : car;
    }

    if (previous.pendingOvertake) {
      const pending = previous.pendingOvertake;
      const opponent = rankedCars.find((candidate) => candidate.carId === pending.opponentCarId);
      const passStillHeld = opponent?.pitStatus === "TRACK" && car.racePosition < opponent.racePosition;
      if (!passStillHeld) return { ...car, pendingOvertake: null };
      const immediateChaser = opponent.racePosition === car.racePosition + 1;
      const passIsClear = !immediateChaser || car.gapToCarBehind >= 0.18;
      const pendingSeconds = elapsedTime - pending.detectedAt;
      if (!passIsClear && pendingSeconds > 8) return { ...car, pendingOvertake: null };
      if (pendingSeconds < 2.5 || !passIsClear) return car;
      const lastPassAgainstOpponent = previous.overtakeOpponentTimes?.[opponent.carId] ?? Number.NEGATIVE_INFINITY;
      if (elapsedTime - lastPassAgainstOpponent < 12) return { ...car, pendingOvertake: null };
      const attacker = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId;
      const defender = DRIVER_BY_ID.get(opponent.driverId)?.shortName ?? opponent.driverId;
      const message = `${attacker} passed ${defender} for P${car.racePosition}`;
      battleEvents.push({ id: `${tick}-${car.carId}-pass`, elapsedTime, type: "BATTLE", message, carId: car.carId });
      if (car.teamId === snapshot.playerTeamId) {
        battleRadio.push({ id: `${tick}-${car.carId}-pass-radio`, elapsedTime, carId: car.carId, source: "ENGINEER", message: `Great move. ${defender} cleared.`, priority: "NORMAL" });
      }
      return {
        ...car,
        overtakes: previous.overtakes + pending.positionsGained,
        lastOvertakeAt: elapsedTime,
        overtakeOpponentTimes: { ...(previous.overtakeOpponentTimes ?? {}), [opponent.carId]: elapsedTime },
        pendingOvertake: null,
      };
    }

    const positionsGained = Math.max(0, previous.racePosition - car.racePosition);
    if (positionsGained === 0 || (previous.battleStatus !== "ATTACKING" && previous.battleStatus !== "SIDE_BY_SIDE" && !previous.overtakeActive)) return car;
    const previousOpponent = snapshot.cars.find((candidate) => candidate.racePosition === car.racePosition);
    const currentOpponent = previousOpponent ? rankedCars.find((candidate) => candidate.carId === previousOpponent.carId) : undefined;
    if (!previousOpponent || currentOpponent?.pitStatus !== "TRACK") return car;
    // Official-style race reports exclude opening-lap reshuffles, while a
    // per-rival hold rejects rapid timing-line swaps without hiding a later
    // pass on a different car.
    if (previous.currentLap <= 1) return car;
    const lastPassAgainstOpponent = previous.overtakeOpponentTimes?.[previousOpponent.carId] ?? Number.NEGATIVE_INFINITY;
    const repeatedOpponentCoolingDown = elapsedTime - lastPassAgainstOpponent < 12;
    if (repeatedOpponentCoolingDown) return car;
    return {
      ...car,
      pendingOvertake: { opponentCarId: previousOpponent.carId, detectedAt: elapsedTime, positionsGained: 1 },
    };
  });
  const thermalEvents: RaceEvent[] = [];
  const thermalRadio: RadioMessage[] = [];
  for (const car of cars) {
    if (car.teamId !== snapshot.playerTeamId) continue;
    const previous = snapshot.cars.find((candidate) => candidate.carId === car.carId);
    if (!previous) continue;
    const before = assessVehicleThermals(previous);
    const after = assessVehicleThermals(car);
    const escalated = [...after.alerts]
      .filter((alert) => {
        const prior = before.alerts.find((candidate) => candidate.system === alert.system)?.severity ?? "NOMINAL";
        return thermalSeverityRank(alert.severity) > thermalSeverityRank(prior);
      })
      .sort((a, b) => thermalSeverityRank(b.severity) - thermalSeverityRank(a.severity));
    if (escalated.length === 0) continue;
    const driver = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId;
    for (const alert of escalated) {
      const message = `${driver} ${alert.title} · ${alert.message}`;
      thermalEvents.push({ id: `${tick}-${car.carId}-${alert.id}`, elapsedTime, type: "THERMAL", message, carId: car.carId });
    }
    const highestPriorityAlert = escalated[0];
    thermalRadio.push({
      id: `${tick}-${car.carId}-${highestPriorityAlert.id}-radio`,
      elapsedTime,
      carId: car.carId,
      source: "ENGINEER",
      message: `${highestPriorityAlert.title}. ${highestPriorityAlert.message}. Recommend ${highestPriorityAlert.actionLabel}.`,
      priority: highestPriorityAlert.severity === "CRITICAL" ? "URGENT" : "WARNING",
    });
  }
  const weatherStrategyRadio: RadioMessage[] = [];
  if (weatherStrategyActive && tick % strategyRefreshTicks === 0) {
    for (const car of cars) {
      if (car.teamId !== snapshot.playerTeamId || car.finished || car.pitStatus !== "TRACK" || car.scheduledPitCompound) continue;
      const recentWeatherCall = snapshot.radioMessages.some((message) => message.carId === car.carId
        && message.source === "ENGINEER"
        && message.message.startsWith("WEATHER CROSSOVER")
        && elapsedTime - message.elapsedTime < 35);
      if (recentWeatherCall) continue;
      const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
      const decision = buildAiStrategyDecision({
        trackWetness: localWater,
        weather,
        raceControl: incidentUpdate.raceControl,
        pitLaneOpen: incidentUpdate.pitLaneOpen,
        cars,
      }, car);
      if (!decision.pitNow || !decision.compound) continue;
      weatherStrategyRadio.push({
        id: `${tick}-${car.carId}-weather-crossover`,
        elapsedTime,
        carId: car.carId,
        source: "ENGINEER",
        message: `WEATHER CROSSOVER · BOX THIS LAP · FIT ${decision.compound} · CONFIDENCE ${Math.round(decision.confidence * 100)}%`,
        priority: decision.compound === "WET" ? "URGENT" : "WARNING",
      });
    }
  }
  const weatherTransitionRadio = tick % 10 === 0
    ? buildWeatherTransitionRadio(snapshot.weather, weather, cars, snapshot.radioMessages, tick, elapsedTime, snapshot.playerTeamId, snapshot.seed)
    : [];
  const operationalRadio = buildOperationalRadio(cars, tick, elapsedTime, snapshot.playerTeamId, snapshot.seed, weather, snapshot.cars);
  const energyRadio = buildEnergyRadioMessages(snapshot.cars, cars, snapshot.playerTeamId, tick, elapsedTime, snapshot.radioMessages);
  let teamOrder = snapshot.teamOrder ?? { type: "NONE" as const, issuedAt: 0, leadCarId: null, trailingCarId: null };
  const teamOrderEvents: RaceEvent[] = [];
  const teamOrderRadio: RadioMessage[] = [];
  if (teamOrder.type === "SWAP_CARS" && teamOrder.leadCarId && teamOrder.trailingCarId) {
    const originalLead = cars.find((car) => car.carId === teamOrder.leadCarId);
    const releasedCar = cars.find((car) => car.carId === teamOrder.trailingCarId);
    const completedSwap = originalLead && releasedCar && releasedCar.racePosition < originalLead.racePosition;
    const abortedSwap = !originalLead || !releasedCar || originalLead.finished || releasedCar.finished || originalLead.pitStatus !== "TRACK" || releasedCar.pitStatus !== "TRACK";
    if (completedSwap || abortedSwap) {
      const message = completedSwap ? "TEAM ORDER COMPLETE · CARS SWAPPED" : "TEAM ORDER CANCELLED · WINDOW CLOSED";
      teamOrderEvents.push({ id: `${tick}-team-order`, elapsedTime, type: "BATTLE", message, carId: releasedCar?.carId ?? null });
      teamOrderRadio.push({ id: `${tick}-team-order-radio`, elapsedTime, carId: null, source: "ENGINEER", message, priority: "NORMAL" });
      teamOrder = { type: "NONE", issuedAt: elapsedTime, leadCarId: null, trailingCarId: null };
    }
  }
  const lifecyclePenalties = advancePenaltyLifecycle({
    penalties: snapshot.penalties,
    cars,
    crossedLineCarIds,
    raceControl: incidentUpdate.raceControl,
    elapsedTime,
    servingPenaltyIds,
    servedPenaltyIds,
  });
  const stewardingSnapshot: RaceSnapshot = {
    ...snapshot,
    penalties: lifecyclePenalties,
    investigations: snapshot.investigations ?? [],
  };
  const stewarding = reviewStewarding({ snapshot: stewardingSnapshot, cars, incidentEvents: incidentUpdate.events, tick, elapsedTime });
  const status: RaceStatus = classifiedFieldHasFinished(cars)
    ? "FINISHED"
    : "RUNNING";
  return {
    ...snapshot,
    tick,
    elapsedTime,
    status,
    weather,
    raceControl: incidentUpdate.raceControl,
    raceControlTimer: incidentUpdate.raceControlTimer,
    yellowSector: incidentUpdate.yellowSector,
    redFlagPhase: incidentUpdate.redFlagPhase,
    redFlagTimerSeconds: incidentUpdate.redFlagTimerSeconds,
    redFlagRestartType: incidentUpdate.redFlagRestartType,
    redFlagOrder: incidentUpdate.redFlagOrder,
    redFlagDeployments: incidentUpdate.redFlagDeployments,
    safetyCarPhase: incidentUpdate.safetyCarPhase,
    safetyCarPhaseElapsedSeconds: incidentUpdate.safetyCarPhaseElapsedSeconds,
    safetyCarDistance: incidentUpdate.safetyCarDistance,
    safetyCarSpeed: incidentUpdate.safetyCarSpeed,
    safetyCarFieldBunched: incidentUpdate.safetyCarFieldBunched,
    safetyCarInPitLane: incidentUpdate.safetyCarInPitLane,
    safetyCarDeploymentDistance: incidentUpdate.safetyCarDeploymentDistance,
    safetyCarTargetLaps: incidentUpdate.safetyCarTargetLaps,
    safetyCarEndingStartDistance: incidentUpdate.safetyCarEndingStartDistance,
    safetyCarPitEntryDistance: incidentUpdate.safetyCarPitEntryDistance,
    safetyCarRestartLineDistance: incidentUpdate.safetyCarRestartLineDistance,
    safetyCarLappedCarsMayOvertake: incidentUpdate.safetyCarLappedCarsMayOvertake,
    safetyCarWaveBy: incidentUpdate.safetyCarWaveBy,
    safetyCarDeployments: incidentUpdate.safetyCarDeployments,
    scheduledSafetyCarDistance: incidentUpdate.scheduledSafetyCarDistance,
    pitLaneOpen: incidentUpdate.pitLaneOpen,
    pitLaneStatus: incidentUpdate.pitLaneStatus,
    activeIncident: incidentUpdate.activeIncident,
    teamOrder,
    stewardStrictness: snapshot.stewardStrictness ?? "BALANCED",
    investigations: stewarding.investigations,
    penalties: stewarding.penalties,
    events: [...stewarding.events, ...sportingEvents, ...teamOrderEvents, ...pitEvents, ...thermalEvents, ...battleEvents, ...vscEvents, ...incidentUpdate.events].slice(0, 24),
    radioMessages: [...stewarding.radioMessages, ...sportingRadio, ...teamOrderRadio, ...pitRadio, ...energyRadio, ...thermalRadio, ...weatherStrategyRadio, ...weatherTransitionRadio, ...battleRadio, ...operationalRadio, ...vscRadio, ...incidentUpdate.radioMessages].slice(0, 30),
    cars,
    checksum: checksumFor(tick, cars, weather, {
      raceControl: incidentUpdate.raceControl,
      safetyCarPhase: incidentUpdate.safetyCarPhase,
      safetyCarPhaseElapsedSeconds: incidentUpdate.safetyCarPhaseElapsedSeconds,
      safetyCarDistance: incidentUpdate.safetyCarDistance,
      safetyCarDeployments: incidentUpdate.safetyCarDeployments,
      safetyCarTargetLaps: incidentUpdate.safetyCarTargetLaps,
      safetyCarEndingStartDistance: incidentUpdate.safetyCarEndingStartDistance,
      safetyCarLappedCarsMayOvertake: incidentUpdate.safetyCarLappedCarsMayOvertake,
      safetyCarWaveBy: incidentUpdate.safetyCarWaveBy,
      pitLaneOpen: incidentUpdate.pitLaneOpen,
    }),
  };
}

export function setCarPace(snapshot: RaceSnapshot, carId: string, mode: PaceMode): RaceSnapshot {
  if (!canReceiveCarCommand(snapshot, carId)) return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, paceMode: mode } : car),
    radioMessages: appendRadio(snapshot, carId, `Pace mode ${mode}. Confirm.`, mode === "ATTACK" ? "WARNING" : "NORMAL", "pace"),
  };
}

export function setTeamOrder(snapshot: RaceSnapshot, order: TeamOrderType): RaceSnapshot {
  if (snapshot.status === "FINISHED") return snapshot;
  const activeTeamCars = snapshot.cars
    .filter((car) => car.teamId === snapshot.playerTeamId && !car.finished && car.incidentStatus !== "RETIRED" && car.pitStatus === "TRACK")
    .sort((left, right) => left.racePosition - right.racePosition);
  if (order !== "NONE" && activeTeamCars.length < 2) return snapshot;
  const lead = activeTeamCars[0] ?? null;
  const trailing = activeTeamCars[1] ?? null;
  const label = order === "HOLD_POSITION" ? "HOLD POSITION" : order === "SWAP_CARS" ? "SWAP CARS" : "RACE FREELY";
  const radioMessages: RadioMessage[] = activeTeamCars.flatMap((car, index) => ([
    { id: `${snapshot.tick}-${car.carId}-team-order`, elapsedTime: snapshot.elapsedTime, carId: car.carId, source: "ENGINEER" as const, message: label, priority: order === "SWAP_CARS" ? "WARNING" as const : "NORMAL" as const },
    { id: `${snapshot.tick}-${car.carId}-team-order-reply`, elapsedTime: snapshot.elapsedTime + 0.01 + index * 0.001, carId: car.carId, source: "DRIVER" as const, message: "Copy.", priority: "NORMAL" as const },
  ]));
  return {
    ...snapshot,
    teamOrder: { type: order, issuedAt: snapshot.elapsedTime, leadCarId: lead?.carId ?? null, trailingCarId: trailing?.carId ?? null },
    radioMessages: [...radioMessages, ...snapshot.radioMessages].slice(0, 30),
  };
}

export function setCarTyreMode(snapshot: RaceSnapshot, carId: string, mode: TyreMode): RaceSnapshot {
  if (!canReceiveCarCommand(snapshot, carId)) return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, tyreMode: mode } : car),
    radioMessages: appendRadio(snapshot, carId, `Tyre instruction ${mode}.`, "NORMAL", "tyre"),
  };
}

export function setCarEnergyMode(snapshot: RaceSnapshot, carId: string, mode: EnergyMode): RaceSnapshot {
  if (!canReceiveCarCommand(snapshot, carId)) return snapshot;
  const normalizedMode = normalizeEnergyMode(mode);
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => {
      if (car.carId !== carId) return car;
      const energySystem = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
      return {
        ...car,
        energyMode: normalizedMode,
        energySystem: {
          ...energySystem,
          deploymentMode: normalizedMode,
          rechargeMode: normalizedMode === "HARVEST" ? "HIGH" : normalizedMode === "CONSERVE" ? "LOW" : "AUTO",
          modeReason: `Driver command · ${normalizedMode}`,
        },
      };
    }),
    radioMessages: appendRadio(snapshot, carId, `Energy mode ${normalizedMode}.`, normalizedMode === "ATTACK" || normalizedMode === "BOOST" || normalizedMode === "OVERTAKE" ? "WARNING" : "NORMAL", "energy"),
  };
}

export function debugEnergyState(snapshot: RaceSnapshot, carId: string, action: EnergyDebugAction): RaceSnapshot {
  if (process.env.NODE_ENV === "production") return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => {
      if (car.carId !== carId) return car;
      const current = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
      let energySystem = current;
      let energyMode = normalizeEnergyMode(car.energyMode);
      if (action === "SOC_FULL") energySystem = { ...current, stateOfCharge: 0.98, storedEnergyMJ: ENERGY_SYSTEM_CONFIG.batteryCapacityMJ * 0.98 };
      if (action === "SOC_LOW") energySystem = { ...current, stateOfCharge: 0.1, storedEnergyMJ: ENERGY_SYSTEM_CONFIG.batteryCapacityMJ * 0.1 };
      if (action === "HEAT") energySystem = { ...current, batteryTemperatureC: ENERGY_SYSTEM_CONFIG.criticalTemperatureC + 4, thermalBand: "CRITICAL", deratingActive: true };
      if (action === "CLIPPING") energySystem = { ...current, stateOfCharge: 0.12, storedEnergyMJ: ENERGY_SYSTEM_CONFIG.batteryCapacityMJ * 0.12, predictedSocAtLapEnd: 0.1, targetSocAtLapEnd: 0.55, clippingActive: true };
      if (action === "BOOST") { energyMode = "BOOST"; energySystem = { ...current, deploymentMode: "BOOST", boostActive: true }; }
      if (action === "OVERTAKE") { energyMode = "OVERTAKE"; energySystem = { ...current, deploymentMode: "OVERTAKE", overtakeEligible: true, overtakeEntitlementLap: car.currentLap, overtakeActive: true }; }
      return {
        ...car,
        energyMode,
        energyAutoEnabled: action === "TOGGLE_AI" ? !(car.energyAutoEnabled ?? car.teamId !== snapshot.playerTeamId) : car.energyAutoEnabled,
        energySystem,
        batteryPercent: energySystem.stateOfCharge * 100,
        energyStoreTemperature: energySystem.batteryTemperatureC,
      };
    }),
  };
}

export function setCarCoolingMode(snapshot: RaceSnapshot, carId: string, mode: CoolingMode): RaceSnapshot {
  if (!canReceiveCarCommand(snapshot, carId)) return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, coolingMode: mode } : car),
    radioMessages: appendRadio(
      snapshot,
      carId,
      mode === "NORMAL" ? "Return to normal cooling." : mode === "MAX_COOLING" ? "Maximum cooling, lift early." : "Lift and coast enabled.",
      mode === "MAX_COOLING" ? "WARNING" : "NORMAL",
      "cooling",
    ),
  };
}

export function setCarBrakeBias(snapshot: RaceSnapshot, carId: string, brakeBiasPercent: number): RaceSnapshot {
  if (!canReceiveCarCommand(snapshot, carId)) return snapshot;
  const bias = Math.round(clamp(brakeBiasPercent, 50, 64) * 10) / 10;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, brakeBiasPercent: bias } : car),
    radioMessages: appendRadio(snapshot, carId, `Brake balance ${bias.toFixed(1)} percent forward.`, "NORMAL", "brake-bias"),
  };
}

export function setCarPit(snapshot: RaceSnapshot, carId: string, compound: TyreCompound, tyreSetId?: string): RaceSnapshot {
  const requestedCar = snapshot.cars.find((car) => car.carId === carId);
  if (!canReceiveCarCommand(snapshot, carId) || requestedCar?.pitStatus !== "TRACK") return snapshot;
  const cars = snapshot.cars.map((car) => car.carId === carId && car.pitStatus === "TRACK" ? reserveTyreSet(car, compound, tyreSetId) : car);
  const updated = cars.find((car) => car.carId === carId);
  const scheduled = updated?.scheduledPitCompound === compound;
  const reserved = updated?.tyreSets.find((set) => set.id === updated.scheduledPitTyreSetId);
  return {
    ...snapshot,
    cars,
    radioMessages: appendRadio(snapshot, carId, scheduled ? `Box this lap. Fit ${compound}.` : `No usable ${compound} set available. Stay out.`, scheduled ? "WARNING" : "URGENT", scheduled ? "box" : "no-tyres"),
  };
}

export function requestPenaltyService(snapshot: RaceSnapshot, carId: string): RaceSnapshot {
  const car = snapshot.cars.find((candidate) => candidate.carId === carId);
  const penalty = snapshot.penalties.find((candidate) => (
    candidate.carId === carId
      && (candidate.status === "PENDING" || candidate.status === "SERVING")
      && isMandatoryPitPenalty(candidate.type)
  ));
  if (!car || !penalty || !canReceiveCarCommand(snapshot, carId) || car.pitStatus !== "TRACK") return snapshot;
  const label = penalty.type === "DRIVE_THROUGH" ? "drive-through" : "stop-and-go";
  return {
    ...snapshot,
    cars: snapshot.cars.map((candidate) => candidate.carId === carId ? { ...candidate, servePenaltyRequested: true } : candidate),
    radioMessages: appendRadio(snapshot, carId, `Serve the ${label} this lap. No tyre work.`, "URGENT", "serve-penalty"),
  };
}

export function cancelCarPit(snapshot: RaceSnapshot, carId: string): RaceSnapshot {
  const requestedCar = snapshot.cars.find((car) => car.carId === carId);
  if (!canReceiveCarCommand(snapshot, carId) || requestedCar?.pitStatus !== "TRACK" || !requestedCar.scheduledPitCompound) return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId && car.pitStatus === "TRACK" ? releaseReservedTyreSet(car) : car),
    radioMessages: appendRadio(snapshot, carId, "Stay out. Stay out.", "NORMAL", "stay-out"),
  };
}

export function setCarStartingTyre(snapshot: RaceSnapshot, carId: string, compound: TyreCompound, tyreSetId?: string): RaceSnapshot {
  if (snapshot.elapsedTime > 0 || snapshot.status === "RUNNING") return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => {
      if (car.carId !== carId) return car;
      if (car.tyreCompound === compound && (!tyreSetId || tyreSetId === car.activeTyreSetId)) return car;
      const released = car.tyreSets.map((set) => set.id === car.activeTyreSetId
        ? { ...set, status: set.lapsUsed > 0 ? "USED" as const : "AVAILABLE" as const }
        : set);
      const candidates = released
        .filter((set) => set.compound === compound && (set.status === "AVAILABLE" || set.status === "USED"))
        .sort((left, right) => right.condition - left.condition || left.lapsUsed - right.lapsUsed);
      const nextSet = tyreSetId ? candidates.find((set) => set.id === tyreSetId) : candidates[0];
      if (!nextSet) return car;
      return {
        ...car,
        tyreCompound: compound,
        tyreLife: nextSet.condition,
        tyreAgeLaps: nextSet.lapsUsed,
        tyreSets: released.map((set) => set.id === nextSet.id ? { ...set, status: "FITTED" as const } : set),
        activeTyreSetId: nextSet.id,
        usedTyreCompounds: [compound],
      };
    }),
  };
}

function canReceiveCarCommand(snapshot: RaceSnapshot, carId: string): boolean {
  const car = snapshot.cars.find((candidate) => candidate.carId === carId);
  return Boolean(car
    && car.teamId === snapshot.playerTeamId
    && !car.finished
    && car.incidentStatus !== "RETIRED"
    && snapshot.status !== "FINISHED");
}

export function estimatePitOutPosition(snapshot: RaceSnapshot, carId: string): number {
  const car = snapshot.cars.find((candidate) => candidate.carId === carId);
  if (!car) return 0;
  const estimatedDistance = car.totalDistance - Math.max(1, car.currentSpeed / 3.6) * estimatePitLossSeconds(snapshot);
  return 1 + snapshot.cars.filter((candidate) => candidate.carId !== carId && candidate.totalDistance > estimatedDistance).length;
}

export function estimatePitLossSeconds(snapshot: RaceSnapshot): number {
  if (snapshot.raceControl === "SAFETY_CAR") return 11.8;
  if (snapshot.raceControl === "VSC") return 15.6;
  return ESTIMATED_PIT_LOSS_SECONDS;
}

function appendRadio(snapshot: RaceSnapshot, carId: string, message: string, priority: RadioMessage["priority"], suffix: string): readonly RadioMessage[] {
  const engineer: RadioMessage = {
    id: `${snapshot.tick}-${carId}-${suffix}`,
    elapsedTime: snapshot.elapsedTime,
    carId,
    source: "ENGINEER",
    message,
    priority,
  };
  const responseByCommand: Record<string, string> = {
    pace: "Copy. Pace mode confirmed.",
    tyre: "Understood. Managing the tyres.",
    energy: "Copy. Energy target confirmed.",
    cooling: "Copy. Cooling instruction confirmed.",
    "brake-bias": "Brake balance confirmed.",
    box: "Copy. Boxing this lap.",
    "stay-out": "Copy. Staying out.",
  };
  const driver: RadioMessage = {
    id: `${snapshot.tick}-${carId}-${suffix}-reply`,
    elapsedTime: snapshot.elapsedTime + 0.01,
    carId,
    source: "DRIVER",
    message: responseByCommand[suffix] ?? "Copy.",
    priority: "NORMAL",
  };
  return [driver, engineer, ...snapshot.radioMessages].slice(0, 30);
}

export function checksumFor(
  tick: number,
  cars: readonly RaceCarState[],
  weather?: WeatherState,
  control?: Pick<RaceSnapshot, "raceControl" | "safetyCarPhase" | "safetyCarPhaseElapsedSeconds" | "safetyCarDistance" | "safetyCarDeployments" | "pitLaneOpen">
    & Partial<Pick<RaceSnapshot, "safetyCarTargetLaps" | "safetyCarEndingStartDistance" | "safetyCarLappedCarsMayOvertake" | "safetyCarWaveBy">>,
): string {
  let hash = 2_166_136_261 ^ tick;
  for (const car of cars) {
    const tyreTemperatures = car.tyreTemperatures ?? uniformTyreTemperatures(car.tyreTemperature);
    const energySystem = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
    const opponentHistoryCode = Object.entries(car.overtakeOpponentTimes ?? {}).sort(([left], [right]) => left.localeCompare(right)).reduce(
      (code, [opponentId, passTime]) => [...opponentId].reduce((next, character) => Math.imul(next, 31) + character.charCodeAt(0) | 0, code ^ Math.round(passTime * 10)),
      0,
    );
    const pendingOvertakeCode = car.pendingOvertake
      ? [...car.pendingOvertake.opponentCarId].reduce((code, character) => Math.imul(code, 31) + character.charCodeAt(0) | 0, Math.round(car.pendingOvertake.detectedAt * 10) ^ car.pendingOvertake.positionsGained)
      : 0;
    const value = Math.round(car.totalDistance * 1_000) ^ Math.round(car.currentSpeed * 100)
      ^ Math.round(car.tyreLife * 100) ^ Math.round(car.fuelRemainingKg * 100) ^ Math.round(car.batteryPercent * 100)
      ^ Math.round(car.vscDeltaSeconds * 1_000) ^ Math.round(car.vscViolationSeconds * 100)
      ^ Math.round((car.pitLimiterFaultSeconds ?? 0) * 1_000)
      ^ Math.round((car.pitSpeedingEvidence?.maximumSpeedKph ?? 0) * 10)
      ^ ((car.pitSpeedingEvidence?.sampleCount ?? 0) << 12)
      ^ Math.round((car.eventPerformanceFactor ?? 1) * 100_000)
      ^ Math.round((car.lastOvertakeAt ?? 0) * 10)
      ^ Math.round(energySystem.currentDeployPowerKW * 10)
      ^ Math.round(energySystem.currentHarvestPowerKW * 10)
      ^ Math.round(energySystem.totalDeployedEnergyMJ * 1_000)
      ^ Math.round(energySystem.totalHarvestedEnergyMJ * 1_000)
      ^ Math.round(energySystem.batteryHealth * 100_000)
      ^ opponentHistoryCode
      ^ pendingOvertakeCode
      ^ ((car.safetyCarQueuePosition ?? 0) << 8);
    hash ^= value;
    hash = Math.imul(hash, 16_777_619);
    for (const temperature of [tyreTemperatures.frontLeft, tyreTemperatures.frontRight, tyreTemperatures.rearLeft, tyreTemperatures.rearRight]) {
      hash ^= Math.round(temperature * 100);
      hash = Math.imul(hash, 16_777_619);
    }
    for (const temperature of [
      car.brakeTemperatures?.frontLeft ?? car.brakeTemperature,
      car.brakeTemperatures?.frontRight ?? car.brakeTemperature,
      car.brakeTemperatures?.rearLeft ?? car.brakeTemperature,
      car.brakeTemperatures?.rearRight ?? car.brakeTemperature,
      car.powerUnitTemperature ?? 98,
      car.gearboxTemperature ?? 86,
      car.energyStoreTemperature ?? 43,
      car.powerUnitStress ?? 0,
      car.gearboxStress ?? 0,
      car.energyStoreStress ?? 0,
      car.brakeStress ?? 0,
    ]) {
      hash ^= Math.round(temperature * 100);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  if (weather) {
    const weatherValues = weather.surfaceZones?.map((zone) => Math.round((zone.wetness + zone.standingWater + zone.dryingLine) * 10_000))
      ?? [Math.round(weather.rainIntensity * 10_000), Math.round(weather.trackWetness * 10_000)];
    for (const value of weatherValues) {
      hash ^= value;
      hash = Math.imul(hash, 16_777_619);
    }
  }
  if (control) {
    const controlCode = control.raceControl === "GREEN" ? 1 : control.raceControl === "YELLOW" ? 2 : control.raceControl === "VSC" ? 3 : 4;
    const phaseCode = control.safetyCarPhase === "NONE" ? 0 : control.safetyCarPhase === "DEPLOYED" ? 1 : control.safetyCarPhase === "BUNCHING" ? 2 : 3;
    const values = [
      controlCode,
      phaseCode,
      Math.round(control.safetyCarPhaseElapsedSeconds * 10),
      Math.round((control.safetyCarDistance ?? 0) * 10),
      control.safetyCarDeployments,
      control.pitLaneOpen ? 1 : 0,
      control.safetyCarTargetLaps ?? 1,
      Math.round((control.safetyCarEndingStartDistance ?? 0) * 10),
      control.safetyCarLappedCarsMayOvertake ? 1 : 0,
      ...(control.safetyCarWaveBy ?? []).flatMap((entry) => [
        Math.round(entry.targetDistance * 10),
        entry.lapsDown ?? 0,
        entry.active ? 1 : 0,
        entry.passedSafetyCar ? 1 : 0,
        entry.completed ? 1 : 0,
      ]),
    ];
    for (const value of values) {
      hash ^= value;
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
