import type { ActiveAeroMode, ActiveIncident, BattleStatus, EnergyMode, EnergyState, PaceMode, PitStopIssue, RaceCarState, RaceControlStatus, RaceEvent, RaceSnapshot, RaceStatus, RacingLineMode, RadioMessage, TyreCompound, TyreMode, TyreSetState, TyreTemperatureState, WeatherState } from "@/domain/race";
import { DRIVER_BY_ID, DRIVERS, TEAM_BY_ID } from "@/fixtures/grid";
import { buildAiStrategyDecision } from "@/simulation/ai-strategy";
import { signedNoise } from "@/simulation/random";
import {
  VSC_SPEED_FACTOR,
  advanceSafetyCarPosition,
  advanceSafetyCarProcedure,
  buildSafetyCarFormation,
  localYellowInstructionFor,
  pitLaneProcedureFor,
  raceControlPhaseMessage,
  selectHigherPriorityRaceControl,
  updateVscCompliance,
  vscTargetElapsedSeconds,
  type SafetyCarFormation,
} from "@/simulation/race-control";
import { telemetrySpeedAtDistance } from "@/simulation/silverstone-telemetry";
import { normalizeLapDistance, pointAtDistance, sectorAtDistance, segmentIndexAtDistance, SILVERSTONE_CIRCUIT, SILVERSTONE_CORNERS } from "@/simulation/track";
import { createSpatialWeather, effectiveWaterAtDistance, updateSpatialWeather, WEATHER_SURFACE_ZONE_COUNT } from "@/simulation/weather";

export const FIXED_STEP_SECONDS = 0.1;
export const DEFAULT_SEED = 20_260_712;

const PACE_SPEED: Record<PaceMode, number> = { ATTACK: 1.026, PUSH: 1.014, STANDARD: 1, CONSERVE: 0.985, COOL: 0.958 };
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
const ENERGY_DEPLOYMENT: Record<EnergyMode, number> = { ATTACK: 1.05, BALANCED: 0.12, DEFEND: 0.82, RECHARGE: 0 };
const ENERGY_HARVEST: Record<EnergyMode, number> = { ATTACK: 0.05, BALANCED: 0.28, DEFEND: 0.08, RECHARGE: 0.92 };

export const PIT_ENTRY_START = SILVERSTONE_CIRCUIT.lengthMeters - 430;
export const PIT_LANE_START = SILVERSTONE_CIRCUIT.lengthMeters - 300;
export const PIT_BOX_DISTANCE = SILVERSTONE_CIRCUIT.lengthMeters - 55;
export const PIT_EXIT_END = 300;
export const PIT_STOP_DURATION = 2.5;
export const ESTIMATED_PIT_LOSS_SECONDS = 23;

const TYRE_SET_ALLOCATION: Readonly<Record<TyreCompound, number>> = {
  SOFT: 4,
  MEDIUM: 3,
  HARD: 2,
  INTERMEDIATE: 2,
  WET: 1,
};

function uniformTyreTemperatures(temperature: number): TyreTemperatureState {
  return { frontLeft: temperature, frontRight: temperature, rearLeft: temperature, rearRight: temperature };
}

export function averageTyreTemperature(temperatures: TyreTemperatureState): number {
  return (temperatures.frontLeft + temperatures.frontRight + temperatures.rearLeft + temperatures.rearRight) / 4;
}

function createTyreSets(carId: string, fittedCompound: TyreCompound): TyreSetState[] {
  let fitted = false;
  return (Object.keys(TYRE_SET_ALLOCATION) as TyreCompound[]).flatMap((compound) =>
    Array.from({ length: TYRE_SET_ALLOCATION[compound] }, (_, index) => {
      const isFitted = !fitted && compound === fittedCompound;
      if (isFitted) fitted = true;
      return { id: `${carId}-${compound.toLowerCase()}-${index + 1}`, compound, status: isFitted ? "FITTED" : "AVAILABLE", condition: 100, lapsUsed: 0 } satisfies TyreSetState;
    }),
  );
}

function reserveTyreSet(car: RaceCarState, compound: TyreCompound): RaceCarState {
  const released = car.tyreSets.map((set) => set.status === "RESERVED" ? { ...set, status: "AVAILABLE" as const } : set);
  const candidate = released
    .filter((set) => set.compound === compound && set.status === "AVAILABLE")
    .sort((a, b) => b.condition - a.condition)[0];
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

function createCar(driverId: string, index: number): RaceCarState {
  const driver = DRIVER_BY_ID.get(driverId);
  if (!driver) throw new Error(`Unknown driver: ${driverId}`);

  // The field begins on a staggered grid behind the control line instead of
  // being compressed hundreds of metres into Turn 2.
  const startingDistance = index === 0 ? 0 : -index * 12;
  const segmentIndex = segmentIndexAtDistance(startingDistance);
  const segment = SILVERSTONE_CIRCUIT.segments[segmentIndex];
  const lapDistance = normalizeLapDistance(startingDistance);

  const tyreCompound = TEAM_BY_ID.get(driver.teamId)?.isPlayer ? "MEDIUM" : DRY_COMPOUNDS[Math.floor(index / 2) % DRY_COMPOUNDS.length];
  const tyreSets = createTyreSets(driver.id, tyreCompound);
  const activeTyreSetId = tyreSets.find((set) => set.status === "FITTED")!.id;

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
    tyreAgeLaps: 0,
    tyreLife: 100,
    tyreTemperatures: uniformTyreTemperatures(88),
    tyreTemperature: 88,
    tyreSets,
    activeTyreSetId,
    scheduledPitTyreSetId: null,
    brakeTemperature: 480,
    powerUnitTemperature: 98,
    gearboxTemperature: 86,
    energyStoreTemperature: 43,
    fuelRemainingKg: 105,
    paceMode: "STANDARD",
    tyreMode: "BALANCED",
    energyMode: "BALANCED",
    energyState: "NEUTRAL",
    batteryPercent: 72 + (index % 4) * 4,
    activeAeroMode: "CORNER",
    overtakeEligible: false,
    overtakeActive: false,
    boostActive: false,
    battleStatus: "CLEAR",
    battleCarId: null,
    dirtyAirLoss: 0,
    overtakes: 0,
    pitStatus: "TRACK",
    pitTimer: 0,
    pitStopTargetSeconds: PIT_STOP_DURATION,
    lastPitStopTime: null,
    pitStopIssue: "NONE",
    pitStops: 0,
    scheduledPitCompound: null,
    usedTyreCompounds: [tyreCompound],
    strategyIntent: "HOLD",
    strategyConfidence: 0.5,
    incidentStatus: "RUNNING",
    incidentTimer: 0,
    damageLevel: 0,
    retiredReason: null,
    vscDeltaSeconds: 0,
    vscViolationSeconds: 0,
    vscComplianceStatus: "COMPLIANT",
    vscViolationCount: 0,
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

export function createInitialSnapshot(seed = DEFAULT_SEED, status: RaceStatus = "PAUSED"): RaceSnapshot {
  const cars = DRIVERS.map((driver, index) => createCar(driver.id, index));
  const weather = createSpatialWeather(seed);
  return {
    seed,
    tick: 0,
    elapsedTime: 0,
    status,
    weather,
    raceControl: "GREEN",
    raceControlTimer: 0,
    yellowSector: null,
    safetyCarPhase: "NONE",
    safetyCarPhaseElapsedSeconds: 0,
    safetyCarDistance: null,
    safetyCarSpeed: 0,
    safetyCarFieldBunched: false,
    safetyCarInPitLane: false,
    safetyCarRestartLineDistance: null,
    pitLaneOpen: true,
    pitLaneStatus: "OPEN",
    activeIncident: null,
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
  const slipstream = segment.kind === "STRAIGHT" && car.gapToCarAhead > 0 && car.gapToCarAhead < 1.15 ? 1.018 : 1;
  const attackBoost = car.racingLineMode === "ATTACK" ? 1.006 : 1;
  const energyBoost = car.overtakeActive ? 1.027 : car.boostActive ? 1.016 : car.energyState === "DEPLOYING" ? 1.004 : 1;
  const lowEnergyPenalty = car.batteryPercent < 8 ? 0.992 : 1;
  const dirtyAirFactor = 1 - car.dirtyAirLoss;
  const performance = team.performance * driver.pace * PACE_SPEED[car.paceMode] * TYRE_SPEED[car.tyreMode]
    * COMPOUND_SPEED[car.tyreCompound] * surfaceGrip(car.tyreCompound, trackWetness) * temperatureGrip * wearGrip * fuelWeight
    * slipstream * attackBoost * energyBoost * lowEnergyPenalty * dirtyAirFactor * (1 + formWave + stableNoise);
  const telemetryTarget = telemetrySpeedAtDistance(car.lapDistance);
  return Math.max(65, telemetryTarget * performance);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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

  const powerUnitTarget = 77
    + pitLoad * (18 * paceLoad + 13 * speedLoad + 7 * accelerationLoad + 5 * segmentLoad + 5 * energyLoad)
    + climateHeat
    + damageHeat * 20
    - wetCooling;
  const gearboxTarget = 61
    + pitLoad * (13 * paceLoad + 15 * speedLoad + 9 * shiftLoad + 8 * (1 - segmentLoad) + 3 * energyLoad)
    + climateHeat * 0.7
    + damageHeat * 16
    - wetCooling * 0.72;
  const energyStoreTarget = Math.max(context.airTemperature + 9, 29
    + pitLoad * (5 * paceLoad + 4 * speedLoad + 25 * energyLoad)
    + (context.airTemperature - 20) * 0.32
    + damageHeat * 10
    - wetCooling * 0.32);

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

function incidentSeverity(status: "SPUN" | "DAMAGED" | "RETIRED"): { control: RaceControlStatus; duration: number } {
  if (status === "RETIRED") return { control: "SAFETY_CAR", duration: 70 };
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

function updateIncidents(snapshot: RaceSnapshot, weather: WeatherState, tick: number, elapsedTime: number) {
  let raceControlTimer = Math.max(0, snapshot.raceControlTimer - FIXED_STEP_SECONDS);
  let raceControl: RaceControlStatus = snapshot.raceControl === "SAFETY_CAR"
    ? "SAFETY_CAR"
    : raceControlTimer > 0 ? snapshot.raceControl : "GREEN";
  let yellowSector = raceControl === "GREEN" ? null : snapshot.yellowSector;
  let activeIncident: ActiveIncident | null = raceControl === "GREEN" ? null : snapshot.activeIncident;
  const newEvents: RaceEvent[] = [];
  const newRadio: RadioMessage[] = [];
  let cars = [...snapshot.cars];
  let safetyCarRedeployed = false;

  if (tick % 10 === 0) {
    cars = cars.map((car, index) => {
      if (car.finished || car.incidentStatus !== "RUNNING" || car.pitStatus !== "TRACK") return car;
      const tyreRisk = Math.max(0, 35 - car.tyreLife) / 18;
      const speedRisk = car.currentSpeed > 270 ? 0.55 : 0;
      const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
      const risk = 0.000018 * (1 + localWater * 7 + tyreRisk + speedRisk);
      const roll = (signedNoise(snapshot.seed, 40_000 + index, tick) + 1) / 2;
      if (roll >= risk) return car;

      const outcomeRoll = (signedNoise(snapshot.seed, 50_000 + index, tick) + 1) / 2;
      const incidentStatus = outcomeRoll < 0.62 ? "SPUN" : outcomeRoll < 0.91 ? "DAMAGED" : "RETIRED";
      const severity = incidentSeverity(incidentStatus);
      const selectedControl = selectHigherPriorityRaceControl(raceControl, severity.control);
      const incidentWinsControl = selectedControl !== raceControl || (selectedControl === severity.control && severity.duration > raceControlTimer);
      if (incidentWinsControl) {
        safetyCarRedeployed = safetyCarRedeployed || (raceControl === "SAFETY_CAR" && severity.control === "SAFETY_CAR");
        raceControl = selectedControl;
        raceControlTimer = severity.duration;
      }
      const driver = DRIVER_BY_ID.get(car.driverId);
      const corner = nearestCornerAtDistance(car.lapDistance);
      const incidentSector = sectorAtDistance(car.lapDistance);
      if (incidentWinsControl) {
        yellowSector = incidentSector;
        activeIncident = { carId: car.carId, distanceMeters: car.lapDistance, cornerNumber: corner.number, cornerName: corner.name, sector: incidentSector, status: incidentStatus };
      }
      const location = `T${corner.number} ${corner.name}`;
      const message = incidentStatus === "SPUN" ? `${driver?.shortName ?? car.driverId} spun at ${location} and rejoined` : incidentStatus === "DAMAGED" ? `${driver?.shortName ?? car.driverId} has vehicle damage at ${location}` : `${driver?.shortName ?? car.driverId} retired at ${location}`;
      newEvents.push({ id: `${tick}-${car.carId}`, elapsedTime, type: "INCIDENT", message });
      newRadio.push({ id: `${tick}-${car.carId}-radio`, elapsedTime, carId: car.carId, source: "RACE CONTROL", message, priority: incidentStatus === "RETIRED" ? "URGENT" : "WARNING" });
      return {
        ...car,
        incidentStatus,
        incidentTimer: incidentStatus === "SPUN" ? 4.5 + outcomeRoll * 3 : 0,
        damageLevel: incidentStatus === "DAMAGED" ? Math.max(car.damageLevel, 0.45 + outcomeRoll * 0.35) : car.damageLevel,
        retiredReason: incidentStatus === "RETIRED" ? "MECHANICAL / INCIDENT" : car.retiredReason,
        finished: incidentStatus === "RETIRED" ? true : car.finished,
        currentSpeed: incidentStatus === "RETIRED" ? 0 : car.currentSpeed,
      } satisfies RaceCarState;
    });
  }

  let safetyCarPhase: RaceSnapshot["safetyCarPhase"] = raceControl === "SAFETY_CAR"
    ? snapshot.raceControl === "SAFETY_CAR" && !safetyCarRedeployed && snapshot.safetyCarPhase !== "NONE" ? snapshot.safetyCarPhase : "DEPLOYED"
    : "NONE";
  let safetyCarPhaseElapsedSeconds = raceControl === "SAFETY_CAR" && snapshot.raceControl === "SAFETY_CAR" && !safetyCarRedeployed
    ? snapshot.safetyCarPhaseElapsedSeconds
    : 0;
  let safetyCarDistance: number | null = null;
  let safetyCarSpeed = 0;
  let safetyCarFieldBunched = false;
  let safetyCarInPitLane = false;
  let safetyCarRestartLineDistance: number | null = raceControl === "SAFETY_CAR" && !safetyCarRedeployed ? snapshot.safetyCarRestartLineDistance : null;
  let safetyCarFormation: SafetyCarFormation | null = null;

  if (raceControl === "SAFETY_CAR" && safetyCarPhase !== "NONE") {
    const leader = [...cars].filter((car) => !car.finished && car.pitStatus === "TRACK").sort((a, b) => a.racePosition - b.racePosition)[0];
    if (leader) {
      const safetyCar = advanceSafetyCarPosition({
        previousTotalDistance: snapshot.raceControl === "SAFETY_CAR" && !safetyCarRedeployed ? snapshot.safetyCarDistance : null,
        leaderTotalDistance: leader.totalDistance,
        circuitLengthMeters: SILVERSTONE_CIRCUIT.lengthMeters,
        phase: safetyCarPhase,
        stepSeconds: FIXED_STEP_SECONDS,
      });
      safetyCarFormation = buildSafetyCarFormation(cars, safetyCar, safetyCarPhase);
      safetyCarDistance = safetyCar.totalDistance;
      safetyCarSpeed = safetyCar.speedKph;
      safetyCarFieldBunched = safetyCarFormation.fieldBunched;
      safetyCarInPitLane = safetyCarPhase === "RESTART" && safetyCarPhaseElapsedSeconds >= 4;
      const leaderReachedRestartLine = safetyCarRestartLineDistance !== null && leader.totalDistance >= safetyCarRestartLineDistance;
      const procedure = advanceSafetyCarProcedure({
        state: { phase: safetyCarPhase, phaseElapsedSeconds: safetyCarPhaseElapsedSeconds },
        stepSeconds: FIXED_STEP_SECONDS,
        fieldBunched: safetyCarFieldBunched,
        safetyCarInPitLane,
        leaderReachedRestartLine,
      });
      safetyCarPhase = procedure.phase;
      safetyCarPhaseElapsedSeconds = procedure.phaseElapsedSeconds;
      if (procedure.changed && procedure.phase === "RESTART") {
        safetyCarRestartLineDistance = (Math.floor(Math.max(0, leader.totalDistance) / SILVERSTONE_CIRCUIT.lengthMeters) + 1) * SILVERSTONE_CIRCUIT.lengthMeters;
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
        safetyCarRestartLineDistance = null;
        safetyCarFormation = null;
      }
    }
  }

  if (safetyCarRedeployed) {
    const message = "SAFETY CAR REDEPLOYED — NEW INCIDENT";
    newEvents.push({ id: `${tick}-sc-redeployed`, elapsedTime, type: "RACE_CONTROL", message });
    newRadio.push({ id: `${tick}-sc-redeployed-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: "URGENT" });
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
    safetyCarPhase,
    safetyCarPhaseElapsedSeconds,
    safetyCarDistance,
    safetyCarSpeed,
    safetyCarFieldBunched,
    safetyCarInPitLane,
    safetyCarRestartLineDistance,
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
): RaceCarState[] {
  if (control === "GREEN") return [...cars];
  const byId = new Map(cars.map((car) => [car.carId, car]));
  const previousOrder = [...previousCars]
    .filter((car) => !car.finished && car.pitStatus === "TRACK" && byId.get(car.carId)?.pitStatus === "TRACK")
    .sort((a, b) => a.racePosition - b.racePosition);
  const safetyTargets = new Map(safetyCarFormation?.queue.map((entry) => [entry.carId, entry]) ?? []);
  let aheadDistance = Infinity;
  const updates = new Map<string, RaceCarState>();
  for (const previous of previousOrder) {
    const car = byId.get(previous.carId);
    if (!car) continue;
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

function energyTacticsFor(car: RaceCarState, raceControl: RaceControlStatus, trackWetness: number): EnergyTactics {
  const segment = SILVERSTONE_CIRCUIT.segments[car.currentSegment];
  const lowGrip = trackWetness > 0.48;
  const activeAeroMode: ActiveAeroMode = lowGrip && segment.activeAeroAllowed
    ? "PARTIAL"
    : segment.activeAeroAllowed ? "STRAIGHT" : "CORNER";
  const greenTrack = raceControl === "GREEN" && car.pitStatus === "TRACK" && car.incidentStatus === "RUNNING";
  const overtakeEligible = greenTrack && activeAeroMode === "STRAIGHT" && car.gapToCarAhead > 0 && car.gapToCarAhead <= 1 && car.batteryPercent >= 10;
  const overtakeActive = overtakeEligible && car.energyMode === "ATTACK";
  const boostActive = greenTrack && activeAeroMode === "STRAIGHT" && car.energyMode === "DEFEND" && car.gapToCarBehind > 0 && car.gapToCarBehind <= 1.15 && car.batteryPercent >= 8;
  const deploying = greenTrack && car.batteryPercent >= 5 && (overtakeActive || boostActive || (car.energyMode === "ATTACK" && (segment.kind === "STRAIGHT" || segment.kind === "FAST")));
  const harvesting = car.energyMode === "RECHARGE" || (!deploying && (segment.kind === "SLOW" || car.batteryPercent < 22));
  const energyState: EnergyState = overtakeActive ? "OVERTAKE" : boostActive ? "DEFENDING" : deploying ? "DEPLOYING" : harvesting ? "HARVESTING" : "NEUTRAL";
  const closeInCorners = greenTrack && segment.kind !== "STRAIGHT" && car.gapToCarAhead > 0 && car.gapToCarAhead < 1.55;
  const dirtyAirLoss = closeInCorners ? Math.min(0.018, (1.55 - car.gapToCarAhead) * 0.0115) : 0;
  return { activeAeroMode, energyState, overtakeEligible, overtakeActive, boostActive, dirtyAirLoss };
}

function updateBattery(car: RaceCarState, tactics: EnergyTactics): number {
  const segment = SILVERSTONE_CIRCUIT.segments[car.currentSegment];
  const harvestZone = segment.kind === "SLOW" ? 1 : segment.kind === "MEDIUM" ? 0.52 : segment.kind === "FAST" ? 0.16 : 0.04;
  const deploymentZone = segment.kind === "STRAIGHT" ? 1 : segment.kind === "FAST" ? 0.64 : 0.24;
  const deploy = tactics.energyState === "OVERTAKE" || tactics.energyState === "DEFENDING" || tactics.energyState === "DEPLOYING"
    ? ENERGY_DEPLOYMENT[car.energyMode] * deploymentZone * FIXED_STEP_SECONDS
    : 0;
  const harvest = ENERGY_HARVEST[car.energyMode] * harvestZone * FIXED_STEP_SECONDS;
  return Math.max(0, Math.min(100, car.batteryPercent + harvest - deploy));
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

  const strategicCars = incidentUpdate.cars.map((car) => {
    const team = TEAM_BY_ID.get(car.teamId);
    if (team?.isPlayer || tick % 300 !== 0 || car.scheduledPitCompound || car.pitStatus !== "TRACK" || car.currentLap >= SILVERSTONE_CIRCUIT.totalLaps) return car;
    const localWater = effectiveWaterAtDistance(weather, car.lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
    const decision = buildAiStrategyDecision({ trackWetness: localWater, weather, raceControl: incidentUpdate.raceControl, pitLaneOpen: incidentUpdate.pitLaneOpen, cars: incidentUpdate.cars }, car);
    const strategicCar = { ...car, strategyIntent: decision.intent, strategyConfidence: decision.confidence };
    return decision.pitNow && decision.compound ? reserveTyreSet(strategicCar, decision.compound) : strategicCar;
  });

  const tacticalCars = strategicCars.map((car) => {
    const team = TEAM_BY_ID.get(car.teamId);
    if (team?.isPlayer || car.pitStatus !== "TRACK" || incidentUpdate.raceControl !== "GREEN") return car;
    const energyMode: EnergyMode = car.batteryPercent < 24
      ? "RECHARGE"
      : car.gapToCarAhead > 0 && car.gapToCarAhead <= 1.05
        ? "ATTACK"
        : car.gapToCarBehind > 0 && car.gapToCarBehind <= 0.9
          ? "DEFEND"
          : car.batteryPercent > 62 ? "BALANCED" : "RECHARGE";
    return { ...car, energyMode };
  });

  const vscEvents: RaceEvent[] = [];
  const vscRadio: RadioMessage[] = [];
  const advancedCars = tacticalCars.map((car, index) => {
    if (car.finished) return car;
    const lapDistanceBefore = normalizeLapDistance(car.totalDistance);
    let pitStatus = car.pitStatus;
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
    let brakeTemperature = car.brakeTemperature;
    let powerUnitTemperature = car.powerUnitTemperature ?? 98;
    let gearboxTemperature = car.gearboxTemperature ?? 86;
    let energyStoreTemperature = car.energyStoreTemperature ?? 43;
    let scheduledPitCompound = car.scheduledPitCompound;
    let pitStopTargetSeconds = car.pitStopTargetSeconds;
    let lastPitStopTime = car.lastPitStopTime;
    let pitStopIssue: PitStopIssue = car.pitStopIssue;
    let usedTyreCompounds = car.usedTyreCompounds;
    const localWater = effectiveWaterAtDistance(weather, lapDistanceBefore, SILVERSTONE_CIRCUIT.lengthMeters);
    const energyTactics = energyTacticsFor(car, incidentUpdate.raceControl, localWater);
    const batteryPercent = updateBattery(car, energyTactics);
    const tacticalCar: RaceCarState = { ...car, ...energyTactics, batteryPercent };

    if (pitStatus === "TRACK" && scheduledPitCompound && incidentUpdate.pitLaneOpen && car.totalDistance >= 0 && lapDistanceBefore >= PIT_ENTRY_START) pitStatus = "PIT_ENTRY";
    if (pitStatus === "PIT_ENTRY" && lapDistanceBefore >= PIT_LANE_START) pitStatus = "PIT_LANE";
    if (pitStatus === "PIT_LANE" && lapDistanceBefore >= PIT_BOX_DISTANCE) {
      const doubleStacked = tacticalCars.some((other) => other.carId !== car.carId && other.teamId === car.teamId && (
        other.pitStatus === "PIT_STOP"
        || (other.pitStatus === "PIT_LANE" && normalizeLapDistance(other.totalDistance) >= PIT_BOX_DISTANCE && other.gridPosition < car.gridPosition)
      ));
      pitStatus = "PIT_STOP";
      pitTimer = 0;
      const stopNoise = signedNoise(snapshot.seed, 7_000 + index, tick);
      const baseDuration = 2.2 + Math.abs(stopNoise) * 0.65;
      if (doubleStacked) {
        pitStopIssue = "DOUBLE_STACK";
        pitStopTargetSeconds = baseDuration + 1.6 + Math.abs(signedNoise(snapshot.seed, 7_100 + index, tick)) * 1.2;
      } else if (stopNoise > 0.88) {
        pitStopIssue = "WHEEL_GUN";
        pitStopTargetSeconds = baseDuration + 2.1 + Math.abs(signedNoise(snapshot.seed, 7_200 + index, tick)) * 1.8;
      } else if (stopNoise > 0.68) {
        pitStopIssue = "SLOW_RELEASE";
        pitStopTargetSeconds = baseDuration + 0.8 + Math.abs(signedNoise(snapshot.seed, 7_300 + index, tick)) * 0.8;
      } else {
        pitStopIssue = "NONE";
        pitStopTargetSeconds = baseDuration;
      }
    }

    if (pitStatus === "PIT_STOP") {
      pitTimer += FIXED_STEP_SECONDS;
      if (pitTimer >= pitStopTargetSeconds) {
        pitStatus = "PIT_EXIT";
        lastPitStopTime = pitTimer;
        pitTimer = 0;
        pitStops += 1;
        tyreCompound = scheduledPitCompound ?? tyreCompound;
        if (scheduledPitTyreSetId) {
          tyreSets = tyreSets.map((set) => set.id === activeTyreSetId
            ? { ...set, status: "USED" as const, condition: tyreLife, lapsUsed: tyreAgeLaps }
            : set.id === scheduledPitTyreSetId
              ? { ...set, status: "FITTED" as const }
              : set);
          activeTyreSetId = scheduledPitTyreSetId;
        }
        if (!usedTyreCompounds.includes(tyreCompound)) usedTyreCompounds = [...usedTyreCompounds, tyreCompound];
        scheduledPitCompound = null;
        scheduledPitTyreSetId = null;
        tyreAgeLaps = 0;
        tyreLife = 100;
        tyreTemperatures = uniformTyreTemperatures(82);
        tyreTemperature = 82;
      }
    }

    const stoppedInBox = pitStatus === "PIT_STOP";
    const released = elapsedTime >= car.reactionTime;
    const incidentSpeedFactor = car.incidentStatus === "SPUN" ? 0.12 : car.incidentStatus === "DAMAGED" ? Math.max(0.82, 1 - car.damageLevel * 0.18) : 1;
    const unconstrainedTarget = targetSpeedKph({ ...tacticalCar, tyreCompound }, index, snapshot.seed, tick, localWater) * incidentSpeedFactor;
    let vscDeltaSeconds = car.vscDeltaSeconds;
    let vscViolationSeconds = car.vscViolationSeconds;
    let vscComplianceStatus = car.vscComplianceStatus;
    let vscViolationCount = car.vscViolationCount;
    const yellowInstruction = localYellowInstructionFor(car.currentSector, incidentUpdate.raceControl, incidentUpdate.yellowSector);
    const safetyQueueEntry = incidentUpdate.safetyCarFormation?.queue.find((entry) => entry.carId === car.carId);
    let controlledTarget = unconstrainedTarget;
    if (pitStatus === "TRACK") {
      if (yellowInstruction.applies) {
        controlledTarget = Math.min(unconstrainedTarget * yellowInstruction.speedFactor, yellowInstruction.maximumSpeedKph ?? Infinity);
      } else if (incidentUpdate.raceControl === "VSC") {
        const correction = vscComplianceStatus === "VIOLATION" ? 0.88
          : vscComplianceStatus === "WARNING" ? 0.94
            : vscDeltaSeconds > 0.8 ? 1.025 : 1;
        controlledTarget = unconstrainedTarget * VSC_SPEED_FACTOR * correction;
      } else if (incidentUpdate.raceControl === "SAFETY_CAR" && safetyQueueEntry) {
        const catchUpKph = Math.max(-105, Math.min(82, safetyQueueEntry.distanceToTargetMeters * 1.05));
        controlledTarget = Math.max(45, Math.min(235, incidentUpdate.safetyCarSpeed + catchUpKph));
      }
    }
    const racingTarget = released ? controlledTarget : 0;
    const targetKph = pitStatus === "PIT_ENTRY" || pitStatus === "PIT_LANE" || pitStatus === "PIT_EXIT" ? Math.min(80, racingTarget) : racingTarget;
    const currentSpeed = stoppedInBox ? 0 : released ? car.currentSpeed + (targetKph - car.currentSpeed) * 0.16 : 0;
    const distanceDelta = (currentSpeed / 3.6) * FIXED_STEP_SECONDS;
    if (incidentUpdate.raceControl === "VSC" && pitStatus === "TRACK") {
      const representativeGreenSeconds = distanceDelta / Math.max(1, unconstrainedTarget / 3.6);
      const targetStepSeconds = vscTargetElapsedSeconds(representativeGreenSeconds);
      const nextDelta = Math.max(-9.999, Math.min(9.999, vscDeltaSeconds + FIXED_STEP_SECONDS - targetStepSeconds));
      const compliance = updateVscCompliance({
        actualElapsedSeconds: nextDelta,
        targetElapsedSeconds: 0,
        previousViolationSeconds: vscViolationSeconds,
        stepSeconds: FIXED_STEP_SECONDS,
      });
      const inDeploymentGrace = incidentUpdate.raceControlTimer > 32.5;
      vscDeltaSeconds = compliance.deltaSeconds;
      vscViolationSeconds = inDeploymentGrace ? 0 : compliance.violationSeconds;
      vscComplianceStatus = inDeploymentGrace ? "COMPLIANT" : compliance.status;
      if (vscComplianceStatus === "VIOLATION" && car.vscComplianceStatus !== "VIOLATION") {
        vscViolationCount += 1;
        const driver = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.carId;
        const message = `${driver} VSC DELTA VIOLATION · ${vscDeltaSeconds.toFixed(3)}s`;
        vscEvents.push({ id: `${tick}-${car.carId}-vsc`, elapsedTime, type: "RACE_CONTROL", message });
        vscRadio.push({ id: `${tick}-${car.carId}-vsc-radio`, elapsedTime, carId: null, source: "RACE CONTROL", message, priority: "URGENT" });
      }
    } else {
      vscDeltaSeconds = 0;
      vscViolationSeconds = 0;
      vscComplianceStatus = "COMPLIANT";
    }
    const totalDistance = car.totalDistance + distanceDelta;
    const lapDistanceAfter = normalizeLapDistance(totalDistance);
    if (pitStatus === "PIT_EXIT" && lapDistanceAfter >= PIT_EXIT_END && lapDistanceAfter < PIT_ENTRY_START) pitStatus = "TRACK";
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
    const segmentKind = SILVERSTONE_CIRCUIT.segments[car.currentSegment].kind;
    const brakeTarget = segmentKind === "SLOW" ? 920 : segmentKind === "MEDIUM" ? 760 : segmentKind === "FAST" ? 620 : 470;
    brakeTemperature += (brakeTarget - brakeTemperature) * 0.025;
    const wetTyreDryPenalty = tyreCompound === "INTERMEDIATE" || tyreCompound === "WET" ? 1 + (1 - localWater) * 1.5 : 1;
    tyreLife = Math.max(0, tyreLife - distanceDelta * 0.00054 * PACE_WEAR[car.paceMode] * TYRE_WEAR[car.tyreMode] * COMPOUND_WEAR[tyreCompound] * wetTyreDryPenalty);
    tyreAgeLaps += distanceDelta / SILVERSTONE_CIRCUIT.lengthMeters;
    tyreSets = tyreSets.map((set) => set.id === activeTyreSetId ? { ...set, condition: tyreLife, lapsUsed: tyreAgeLaps } : set);
    const fuelRemainingKg = Math.max(0, car.fuelRemainingKg - distanceDelta * 0.00032 * PACE_FUEL[car.paceMode]);
    const finished = totalDistance >= raceDistance;
    let incidentStatus = car.incidentStatus;
    let incidentTimer = car.incidentTimer;
    if (incidentStatus === "SPUN") {
      incidentTimer = Math.max(0, incidentTimer - FIXED_STEP_SECONDS);
      if (incidentTimer === 0) incidentStatus = "RUNNING";
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
      brakeTemperature,
      powerUnitTemperature,
      gearboxTemperature,
      energyStoreTemperature,
      pitStatus,
      pitTimer,
      pitStopTargetSeconds,
      lastPitStopTime,
      pitStopIssue,
      pitStops,
      scheduledPitCompound,
      usedTyreCompounds,
      incidentStatus,
      incidentTimer,
      vscDeltaSeconds,
      vscViolationSeconds,
      vscComplianceStatus,
      vscViolationCount,
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
    incidentUpdate.safetyCarFormation,
  );
  const timedCars = controlledCars.map((car) => {
    const previous = snapshot.cars.find((candidate) => candidate.carId === car.carId);
    if (!previous || previous.finished) return car;
    const finished = car.totalDistance >= raceDistance;
    const corrected = {
      ...car,
      finished,
      finishTime: finished ? elapsedTime : null,
    };
    return withTimingData(previous, corrected, elapsedTime);
  });
  const rankedCars = rankCars(timedCars, incidentUpdate.raceControl);
  const battleEvents: RaceEvent[] = [];
  const battleRadio: RadioMessage[] = [];
  const cars = rankedCars.map((car) => {
    const previous = snapshot.cars.find((candidate) => candidate.carId === car.carId);
    if (!previous || incidentUpdate.raceControl !== "GREEN" || car.pitStatus !== "TRACK") return car;
    const positionsGained = Math.max(0, previous.racePosition - car.racePosition);
    if (positionsGained === 0 || (previous.battleStatus !== "ATTACKING" && previous.battleStatus !== "SIDE_BY_SIDE" && !previous.overtakeActive)) return car;
    const previousOpponent = snapshot.cars.find((candidate) => candidate.racePosition === car.racePosition);
    const currentOpponent = previousOpponent ? rankedCars.find((candidate) => candidate.carId === previousOpponent.carId) : undefined;
    if (!previousOpponent || currentOpponent?.pitStatus !== "TRACK") return car;
    const attacker = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId;
    const defender = DRIVER_BY_ID.get(previousOpponent.driverId)?.shortName ?? previousOpponent.driverId;
    const message = `${attacker} passed ${defender} for P${car.racePosition}`;
    battleEvents.push({ id: `${tick}-${car.carId}-pass`, elapsedTime, type: "BATTLE", message });
    if (TEAM_BY_ID.get(car.teamId)?.isPlayer) {
      battleRadio.push({ id: `${tick}-${car.carId}-pass-radio`, elapsedTime, carId: car.carId, source: "ENGINEER", message: `Great move. ${defender} cleared.`, priority: "NORMAL" });
    }
    return { ...car, overtakes: previous.overtakes + positionsGained };
  });
  const status: RaceStatus = cars.every((car) => car.finished) ? "FINISHED" : "RUNNING";
  return {
    ...snapshot,
    tick,
    elapsedTime,
    status,
    weather,
    raceControl: incidentUpdate.raceControl,
    raceControlTimer: incidentUpdate.raceControlTimer,
    yellowSector: incidentUpdate.yellowSector,
    safetyCarPhase: incidentUpdate.safetyCarPhase,
    safetyCarPhaseElapsedSeconds: incidentUpdate.safetyCarPhaseElapsedSeconds,
    safetyCarDistance: incidentUpdate.safetyCarDistance,
    safetyCarSpeed: incidentUpdate.safetyCarSpeed,
    safetyCarFieldBunched: incidentUpdate.safetyCarFieldBunched,
    safetyCarInPitLane: incidentUpdate.safetyCarInPitLane,
    safetyCarRestartLineDistance: incidentUpdate.safetyCarRestartLineDistance,
    pitLaneOpen: incidentUpdate.pitLaneOpen,
    pitLaneStatus: incidentUpdate.pitLaneStatus,
    activeIncident: incidentUpdate.activeIncident,
    events: [...battleEvents, ...vscEvents, ...incidentUpdate.events].slice(0, 24),
    radioMessages: [...battleRadio, ...vscRadio, ...incidentUpdate.radioMessages].slice(0, 30),
    cars,
    checksum: checksumFor(tick, cars, weather, {
      raceControl: incidentUpdate.raceControl,
      safetyCarPhase: incidentUpdate.safetyCarPhase,
      safetyCarPhaseElapsedSeconds: incidentUpdate.safetyCarPhaseElapsedSeconds,
      safetyCarDistance: incidentUpdate.safetyCarDistance,
      pitLaneOpen: incidentUpdate.pitLaneOpen,
    }),
  };
}

export function setCarPace(snapshot: RaceSnapshot, carId: string, mode: PaceMode): RaceSnapshot {
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, paceMode: mode } : car),
    radioMessages: appendRadio(snapshot, carId, `Pace mode ${mode}. Confirm.`, mode === "ATTACK" ? "WARNING" : "NORMAL", "pace"),
  };
}

export function setCarTyreMode(snapshot: RaceSnapshot, carId: string, mode: TyreMode): RaceSnapshot {
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, tyreMode: mode } : car),
    radioMessages: appendRadio(snapshot, carId, `Tyre instruction ${mode}.`, "NORMAL", "tyre"),
  };
}

export function setCarEnergyMode(snapshot: RaceSnapshot, carId: string, mode: EnergyMode): RaceSnapshot {
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId ? { ...car, energyMode: mode } : car),
    radioMessages: appendRadio(snapshot, carId, `Energy mode ${mode}.`, mode === "ATTACK" ? "WARNING" : "NORMAL", "energy"),
  };
}

export function setCarPit(snapshot: RaceSnapshot, carId: string, compound: TyreCompound): RaceSnapshot {
  const cars = snapshot.cars.map((car) => car.carId === carId && car.pitStatus === "TRACK" ? reserveTyreSet(car, compound) : car);
  const scheduled = cars.find((car) => car.carId === carId)?.scheduledPitCompound === compound;
  return {
    ...snapshot,
    cars,
    radioMessages: appendRadio(snapshot, carId, scheduled ? `Box this lap. Fit ${compound}.` : `No fresh ${compound} set available. Stay out.`, scheduled ? "WARNING" : "URGENT", scheduled ? "box" : "no-tyres"),
  };
}

export function cancelCarPit(snapshot: RaceSnapshot, carId: string): RaceSnapshot {
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => car.carId === carId && car.pitStatus === "TRACK" ? releaseReservedTyreSet(car) : car),
    radioMessages: appendRadio(snapshot, carId, "Stay out. Stay out.", "NORMAL", "stay-out"),
  };
}

export function setCarStartingTyre(snapshot: RaceSnapshot, carId: string, compound: TyreCompound): RaceSnapshot {
  if (snapshot.elapsedTime > 0 || snapshot.status === "RUNNING") return snapshot;
  return {
    ...snapshot,
    cars: snapshot.cars.map((car) => {
      if (car.carId !== carId || car.tyreCompound === compound) return car;
      const released = car.tyreSets.map((set) => set.id === car.activeTyreSetId ? { ...set, status: "AVAILABLE" as const } : set);
      const nextSet = released.find((set) => set.compound === compound && set.status === "AVAILABLE");
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
  control?: Pick<RaceSnapshot, "raceControl" | "safetyCarPhase" | "safetyCarPhaseElapsedSeconds" | "safetyCarDistance" | "pitLaneOpen">,
): string {
  let hash = 2_166_136_261 ^ tick;
  for (const car of cars) {
    const tyreTemperatures = car.tyreTemperatures ?? uniformTyreTemperatures(car.tyreTemperature);
    const value = Math.round(car.totalDistance * 1_000) ^ Math.round(car.currentSpeed * 100)
      ^ Math.round(car.tyreLife * 100) ^ Math.round(car.fuelRemainingKg * 100) ^ Math.round(car.batteryPercent * 100)
      ^ Math.round(car.vscDeltaSeconds * 1_000) ^ Math.round(car.vscViolationSeconds * 100)
      ^ ((car.safetyCarQueuePosition ?? 0) << 8);
    hash ^= value;
    hash = Math.imul(hash, 16_777_619);
    for (const temperature of [tyreTemperatures.frontLeft, tyreTemperatures.frontRight, tyreTemperatures.rearLeft, tyreTemperatures.rearRight]) {
      hash ^= Math.round(temperature * 100);
      hash = Math.imul(hash, 16_777_619);
    }
    for (const temperature of [
      car.powerUnitTemperature ?? 98,
      car.gearboxTemperature ?? 86,
      car.energyStoreTemperature ?? 43,
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
      control.pitLaneOpen ? 1 : 0,
    ];
    for (const value of values) {
      hash ^= value;
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
