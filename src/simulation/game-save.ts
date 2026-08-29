import type {
  RaceCarState,
  RaceSnapshot,
} from "@/domain/race";
import type {
  CarSetup,
  LiveQualifyingState,
  QualifyingCarState,
  WeekendState,
} from "@/simulation/weekend";
import type { ChampionshipState } from "@/simulation/championship";
import { RELIABILITY_COMPONENTS, type ReliabilityState } from "@/simulation/reliability";

/** Increment this only when the persisted contract changes incompatibly. */
export const GAME_SAVE_SCHEMA_VERSION = 1 as const;
export const CURRENT_GAME_SAVE_SCHEMA_VERSION = GAME_SAVE_SCHEMA_VERSION;

/** Defensive limits for data that may eventually come from files or storage. */
export const MAX_GAME_SAVE_CHARACTERS = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;

export interface GameSaveV1 {
  schemaVersion: typeof GAME_SAVE_SCHEMA_VERSION;
  /** UTC ISO-8601 timestamp supplied by the caller; this module never reads the clock. */
  savedAt: string;
  raceSnapshot: RaceSnapshot;
  weekendState: WeekendState;
  championshipState?: ChampionshipState;
  reliabilityState?: ReliabilityState;
}

export type GameSave = GameSaveV1;

export interface CreateGameSaveInput {
  savedAt: string;
  raceSnapshot: RaceSnapshot;
  weekendState: WeekendState;
  championshipState?: ChampionshipState;
  reliabilityState?: ReliabilityState;
}

export interface GameSaveValidationIssue {
  path: string;
  message: string;
}

export class GameSaveValidationError extends TypeError {
  readonly issues: readonly GameSaveValidationIssue[];

  constructor(issues: readonly GameSaveValidationIssue[]) {
    const summary = issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    super(`Invalid game save${summary ? `: ${summary}` : "."}`);
    this.name = "GameSaveValidationError";
    this.issues = [...issues];
  }
}

export class GameSaveParseError extends SyntaxError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GameSaveParseError";
  }
}

export class UnsupportedGameSaveVersionError extends RangeError {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    super(`Unsupported game save schema version: ${schemaVersion}. Current version is ${GAME_SAVE_SCHEMA_VERSION}.`);
    this.name = "UnsupportedGameSaveVersionError";
    this.schemaVersion = schemaVersion;
  }
}

type UnknownRecord = Record<string, unknown>;
type MutableIssues = GameSaveValidationIssue[];

const RACE_STATUSES = ["READY", "RUNNING", "PAUSED", "FINISHED"] as const;
const RACE_CONTROL_STATUSES = ["GREEN", "YELLOW", "VSC", "SAFETY_CAR", "RED_FLAG"] as const;
const SAFETY_CAR_PHASES = ["NONE", "DEPLOYED", "BUNCHING", "RESTART"] as const;
const WEATHER_CONDITIONS = ["DRY", "CLOUDY", "LIGHT_RAIN", "HEAVY_RAIN"] as const;
const WEEKEND_SESSIONS = ["FP1", "FP2", "FP3", "Q1", "Q2", "Q3", "RACE"] as const;
const COMPLETABLE_WEEKEND_SESSIONS = ["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"] as const;
const QUALIFYING_SESSIONS = ["Q1", "Q2", "Q3"] as const;
const TYRE_COMPOUNDS = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const;
const TYRE_SET_STATUSES = ["AVAILABLE", "FITTED", "RESERVED", "USED"] as const;
const WEEKEND_TYRE_SET_STATUSES = ["NEW", "USED", "FITTED", "RESERVED", "UNAVAILABLE"] as const;
const PACE_MODES = ["ATTACK", "PUSH", "STANDARD", "CONSERVE", "COOL"] as const;
const TYRE_MODES = ["GRIP", "BALANCED", "SAVE", "TEMPERATURE"] as const;
const ENERGY_MODES = ["HARVEST", "CONSERVE", "BALANCED", "ATTACK", "BOOST", "OVERTAKE", "DEFEND", "RECHARGE"] as const;
const ENERGY_STATES = ["NEUTRAL", "HARVESTING", "DEPLOYING", "OVERTAKE", "DEFENDING", "CLIPPING"] as const;
const COOLING_MODES = ["NORMAL", "LIFT_AND_COAST", "MAX_COOLING"] as const;
const ACTIVE_AERO_MODES = ["CORNER", "STRAIGHT", "PARTIAL"] as const;
const BATTLE_STATUSES = ["CLEAR", "ATTACKING", "DEFENDING", "SIDE_BY_SIDE"] as const;
const RACING_LINE_MODES = ["GRID", "RACING", "ATTACK", "DEFEND"] as const;
const PIT_STATUSES = ["TRACK", "PIT_ENTRY", "PIT_LANE", "PIT_STOP", "PIT_EXIT"] as const;
const PIT_STOP_ISSUES = ["NONE", "SLOW_RELEASE", "WHEEL_GUN", "DOUBLE_STACK"] as const;
const STRATEGY_INTENTS = ["HOLD", "EXTEND", "UNDERCUT", "OVERCUT", "WEATHER", "CHEAP_STOP", "TYRE_LIMIT"] as const;
const INCIDENT_STATUSES = ["RUNNING", "SPUN", "DAMAGED", "RETIRED"] as const;
const DAMAGE_SCENARIOS = ["CONTINUE_SLOW", "STOP_AND_REJOIN", "STOP_AND_RETIRE", "PIT_AND_RETIRE"] as const;
const CHAMPIONSHIP_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;
const ROUND_CLASSIFICATION_STATUSES = ["FINISHED", "RETIRED"] as const;
const VSC_COMPLIANCE_STATUSES = ["COMPLIANT", "WARNING", "VIOLATION"] as const;
const PIT_LANE_STATUSES = ["OPEN", "CLOSED"] as const;
const STEWARD_STRICTNESS = ["LENIENT", "BALANCED", "STRICT"] as const;
const TEAM_ORDER_TYPES = ["NONE", "HOLD_POSITION", "SWAP_CARS"] as const;
const QUALIFYING_PHASES = ["GARAGE", "OUT_LAP", "PUSH_LAP", "IN_LAP", "ABORTED_LAP", "PIT_ENTRY"] as const;
const QUALIFYING_SESSION_STATUSES = ["READY", "RUNNING", "CHECKERED"] as const;
const QUALIFYING_OUT_LAP_MODES = ["SLOW", "BALANCED", "FAST"] as const;
const QUALIFYING_ATTACK_MODES = ["SAFE", "NORMAL", "ATTACK", "MAXIMUM"] as const;
const QUALIFYING_ENERGY_MODES = ["CHARGE", "QUALI"] as const;
const QUALIFYING_TRAFFIC_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const QUALIFYING_RELEASE_REQUESTS = ["NONE", "WAIT_FOR_GAP", "HOLD"] as const;
const QUALIFYING_TRAFFIC_RESPONSES = ["MAINTAIN_GAP", "CREATE_GAP", "LET_PASS", "OVERTAKE_OUT_LAP"] as const;
const QUALIFYING_FUEL_PLANS = ["ONE_LAP", "TWO_LAPS", "TWO_LAPS_MARGIN"] as const;
const QUALIFYING_TRAFFIC_DECISIONS = ["NONE", "YIELD", "TRAFFIC", "ABORTED"] as const;
const QUALIFYING_RUN_NOTES = ["NO TIME", "CLEAN", "TOW", "TRAFFIC", "TRACK LIMITS", "LOCK-UP", "ABORTED"] as const;
const SECTOR_TONES = ["NEUTRAL", "INVALID", "PURPLE", "GREEN", "YELLOW"] as const;

function addIssue(issues: MutableIssues, path: string, message: string): void {
  issues.push({ path, message });
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function expectRecord(value: unknown, path: string, issues: MutableIssues): UnknownRecord | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be a plain object");
    return null;
  }
  return value;
}

function expectArray(value: unknown, path: string, issues: MutableIssues): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "must be an array");
    return null;
  }
  return value;
}

function expectString(value: unknown, path: string, issues: MutableIssues, allowEmpty = false): value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    addIssue(issues, path, allowEmpty ? "must be a string" : "must be a non-empty string");
    return false;
  }
  return true;
}

function expectBoolean(value: unknown, path: string, issues: MutableIssues): value is boolean {
  if (typeof value !== "boolean") {
    addIssue(issues, path, "must be a boolean");
    return false;
  }
  return true;
}

interface NumberConstraints {
  integer?: boolean;
  minimum?: number;
  maximum?: number;
}

function expectNumber(value: unknown, path: string, issues: MutableIssues, constraints: NumberConstraints = {}): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addIssue(issues, path, "must be a finite number");
    return false;
  }
  if (constraints.integer && !Number.isInteger(value)) addIssue(issues, path, "must be an integer");
  if (constraints.minimum !== undefined && value < constraints.minimum) addIssue(issues, path, `must be at least ${constraints.minimum}`);
  if (constraints.maximum !== undefined && value > constraints.maximum) addIssue(issues, path, `must be at most ${constraints.maximum}`);
  return true;
}

function expectNullableNumber(value: unknown, path: string, issues: MutableIssues, constraints: NumberConstraints = {}): void {
  if (value !== null) expectNumber(value, path, issues, constraints);
}

function expectNullableString(value: unknown, path: string, issues: MutableIssues): void {
  if (value !== null) expectString(value, path, issues);
}

function expectEnum<const T extends readonly (string | number)[]>(
  value: unknown,
  allowed: T,
  path: string,
  issues: MutableIssues,
): value is T[number] {
  if (!allowed.some((candidate) => candidate === value)) {
    addIssue(issues, path, `must be one of ${allowed.join(", ")}`);
    return false;
  }
  return true;
}

function expectOptionalNumber(record: UnknownRecord, key: string, path: string, issues: MutableIssues, constraints: NumberConstraints = {}): void {
  if (key in record) expectNullableNumber(record[key], `${path}.${key}`, issues, constraints);
}

function expectOptionalBoolean(record: UnknownRecord, key: string, path: string, issues: MutableIssues): void {
  if (key in record) expectBoolean(record[key], `${path}.${key}`, issues);
}

function expectOptionalString(record: UnknownRecord, key: string, path: string, issues: MutableIssues): void {
  if (key in record) expectNullableString(record[key], `${path}.${key}`, issues);
}

function validateJsonValue(
  value: unknown,
  path: string,
  issues: MutableIssues,
  ancestors = new WeakSet<object>(),
  depth = 0,
): void {
  if (depth > MAX_JSON_DEPTH) {
    addIssue(issues, path, `exceeds the maximum nesting depth of ${MAX_JSON_DEPTH}`);
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) addIssue(issues, path, "contains a non-finite number");
    return;
  }
  if (typeof value !== "object") {
    addIssue(issues, path, `contains non-JSON value ${typeof value}`);
    return;
  }
  if (ancestors.has(value)) {
    addIssue(issues, path, "contains a circular reference");
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, issues, ancestors, depth + 1));
  } else if (!isRecord(value)) {
    addIssue(issues, path, "contains a non-plain object");
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        addIssue(issues, `${path}.${key}`, "uses a forbidden object key");
      }
      validateJsonValue(item, `${path}.${key}`, issues, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function validateNumberTuple(value: unknown, length: number, path: string, issues: MutableIssues, nullable = false): void {
  const tuple = expectArray(value, path, issues);
  if (!tuple) return;
  if (tuple.length !== length) addIssue(issues, path, `must contain exactly ${length} entries`);
  tuple.forEach((item, index) => nullable
    ? expectNullableNumber(item, `${path}[${index}]`, issues)
    : expectNumber(item, `${path}[${index}]`, issues));
}

function validateTyreTemperatures(value: unknown, path: string, issues: MutableIssues): void {
  const temperatures = expectRecord(value, path, issues);
  if (!temperatures) return;
  for (const key of ["frontLeft", "frontRight", "rearLeft", "rearRight"] as const) {
    expectNumber(temperatures[key], `${path}.${key}`, issues);
  }
}

function validateWeatherSurfaceZone(value: unknown, path: string, issues: MutableIssues): void {
  const zone = expectRecord(value, path, issues);
  if (!zone) return;
  expectString(zone.id, `${path}.id`, issues);
  expectNumber(zone.index, `${path}.index`, issues, { integer: true, minimum: 0 });
  expectNumber(zone.startDistance, `${path}.startDistance`, issues, { minimum: 0 });
  expectNumber(zone.endDistance, `${path}.endDistance`, issues, { minimum: 0 });
  expectEnum(zone.sector, [1, 2, 3] as const, `${path}.sector`, issues);
  for (const key of ["rainIntensity", "wetness", "standingWater", "dryingLine", "drainage", "traffic"] as const) {
    expectNumber(zone[key], `${path}.${key}`, issues, { minimum: 0, maximum: 1 });
  }
}

function validateWeather(value: unknown, path: string, issues: MutableIssues): void {
  const weather = expectRecord(value, path, issues);
  if (!weather) return;
  expectEnum(weather.condition, WEATHER_CONDITIONS, `${path}.condition`, issues);
  expectNumber(weather.rainIntensity, `${path}.rainIntensity`, issues, { minimum: 0, maximum: 1 });
  expectNumber(weather.trackWetness, `${path}.trackWetness`, issues, { minimum: 0, maximum: 1 });
  expectNumber(weather.airTemperature, `${path}.airTemperature`, issues);
  expectNumber(weather.trackTemperature, `${path}.trackTemperature`, issues);
  expectNullableNumber(weather.forecastRainInMinutes, `${path}.forecastRainInMinutes`, issues, { minimum: 0 });

  if ("radarCells" in weather) {
    const cells = expectArray(weather.radarCells, `${path}.radarCells`, issues);
    cells?.forEach((cell, index) => {
      const record = expectRecord(cell, `${path}.radarCells[${index}]`, issues);
      if (!record) return;
      expectString(record.id, `${path}.radarCells[${index}].id`, issues);
      for (const key of ["row", "column", "x", "y", "rainIntensity", "rainProbability"] as const) {
        expectNumber(record[key], `${path}.radarCells[${index}].${key}`, issues);
      }
      expectNullableNumber(record.etaSeconds, `${path}.radarCells[${index}].etaSeconds`, issues, { minimum: 0 });
    });
  }
  if ("surfaceZones" in weather) {
    const zones = expectArray(weather.surfaceZones, `${path}.surfaceZones`, issues);
    zones?.forEach((zone, index) => validateWeatherSurfaceZone(zone, `${path}.surfaceZones[${index}]`, issues));
  }
  if ("sectors" in weather) {
    const sectors = expectArray(weather.sectors, `${path}.sectors`, issues);
    sectors?.forEach((sector, index) => {
      const record = expectRecord(sector, `${path}.sectors[${index}]`, issues);
      if (!record) return;
      expectEnum(record.sector, [1, 2, 3] as const, `${path}.sectors[${index}].sector`, issues);
      expectEnum(record.condition, WEATHER_CONDITIONS, `${path}.sectors[${index}].condition`, issues);
      for (const key of ["rainIntensity", "wetness", "standingWater", "dryingLine"] as const) {
        expectNumber(record[key], `${path}.sectors[${index}].${key}`, issues, { minimum: 0, maximum: 1 });
      }
    });
  }
  if ("forecast" in weather) {
    const forecast = expectArray(weather.forecast, `${path}.forecast`, issues);
    forecast?.forEach((point, index) => {
      const record = expectRecord(point, `${path}.forecast[${index}]`, issues);
      if (!record) return;
      expectNumber(record.minutesAhead, `${path}.forecast[${index}].minutesAhead`, issues, { minimum: 0 });
      expectEnum(record.condition, WEATHER_CONDITIONS, `${path}.forecast[${index}].condition`, issues);
      expectNumber(record.rainProbability, `${path}.forecast[${index}].rainProbability`, issues, { minimum: 0, maximum: 1 });
      expectNumber(record.rainIntensity, `${path}.forecast[${index}].rainIntensity`, issues, { minimum: 0, maximum: 1 });
    });
  }
}

function validateEnergySystem(value: unknown, path: string, issues: MutableIssues): void {
  const energy = expectRecord(value, path, issues);
  if (!energy) return;
  for (const key of [
    "stateOfCharge", "storedEnergyMJ", "currentDeployPowerKW", "currentHarvestPowerKW",
    "deployedEnergyThisLapMJ", "harvestedEnergyThisLapMJ", "lastLapDeployedEnergyMJ",
    "lastLapHarvestedEnergyMJ", "totalDeployedEnergyMJ", "totalHarvestedEnergyMJ",
    "batteryTemperatureC", "batteryHealth", "predictedSocAtLapEnd", "targetSocAtLapEnd",
  ] as const) expectNumber(energy[key], `${path}.${key}`, issues);
  expectEnum(energy.deploymentMode, ["HARVEST", "CONSERVE", "BALANCED", "ATTACK", "BOOST", "OVERTAKE"] as const, `${path}.deploymentMode`, issues);
  expectEnum(energy.rechargeMode, ["AUTO", "LOW", "HIGH"] as const, `${path}.rechargeMode`, issues);
  for (const key of ["clippingActive", "deratingActive", "boostActive", "overtakeEligible", "overtakeActive"] as const) {
    expectBoolean(energy[key], `${path}.${key}`, issues);
  }
  expectNullableNumber(energy.overtakeEntitlementLap, `${path}.overtakeEntitlementLap`, issues, { integer: true, minimum: 0 });
  expectEnum(energy.thermalBand, ["COLD", "OPTIMAL", "WARM", "HOT", "CRITICAL"] as const, `${path}.thermalBand`, issues);
  expectString(energy.modeReason, `${path}.modeReason`, issues, true);
}

function validateRaceCar(value: unknown, path: string, issues: MutableIssues): RaceCarState | null {
  const car = expectRecord(value, path, issues);
  if (!car) return null;
  for (const key of ["carId", "teamId", "driverId", "activeTyreSetId"] as const) expectString(car[key], `${path}.${key}`, issues);
  if ("circuitId" in car) expectString(car.circuitId, `${path}.circuitId`, issues);
  expectNullableString(car.scheduledPitTyreSetId, `${path}.scheduledPitTyreSetId`, issues);
  expectNullableString(car.battleCarId, `${path}.battleCarId`, issues);
  expectNullableString(car.retiredReason, `${path}.retiredReason`, issues);
  expectEnum(car.racingLineMode, RACING_LINE_MODES, `${path}.racingLineMode`, issues);
  expectEnum(car.tyreCompound, TYRE_COMPOUNDS, `${path}.tyreCompound`, issues);
  expectEnum(car.paceMode, PACE_MODES, `${path}.paceMode`, issues);
  expectEnum(car.tyreMode, TYRE_MODES, `${path}.tyreMode`, issues);
  expectEnum(car.energyMode, ENERGY_MODES, `${path}.energyMode`, issues);
  expectEnum(car.energyState, ENERGY_STATES, `${path}.energyState`, issues);
  expectEnum(car.coolingMode, COOLING_MODES, `${path}.coolingMode`, issues);
  expectEnum(car.activeAeroMode, ACTIVE_AERO_MODES, `${path}.activeAeroMode`, issues);
  expectEnum(car.battleStatus, BATTLE_STATUSES, `${path}.battleStatus`, issues);
  expectEnum(car.pitStatus, PIT_STATUSES, `${path}.pitStatus`, issues);
  expectEnum(car.pitStopIssue, PIT_STOP_ISSUES, `${path}.pitStopIssue`, issues);
  expectEnum(car.strategyIntent, STRATEGY_INTENTS, `${path}.strategyIntent`, issues);
  expectEnum(car.incidentStatus, INCIDENT_STATUSES, `${path}.incidentStatus`, issues);
  if ("damageScenario" in car && car.damageScenario !== null && car.damageScenario !== undefined) {
    expectEnum(car.damageScenario, DAMAGE_SCENARIOS, `${path}.damageScenario`, issues);
  }
  expectEnum(car.vscComplianceStatus, VSC_COMPLIANCE_STATUSES, `${path}.vscComplianceStatus`, issues);

  for (const key of ["currentLap", "gridPosition", "racePosition", "currentSector"] as const) {
    expectNumber(car[key], `${path}.${key}`, issues, { integer: true, minimum: 1 });
  }
  for (const key of ["currentSegment", "overtakes", "pitStops", "vscViolationCount"] as const) {
    expectNumber(car[key], `${path}.${key}`, issues, { integer: true, minimum: 0 });
  }
  expectNumber(car.tyreAgeLaps, `${path}.tyreAgeLaps`, issues, { minimum: 0 });
  const numberKeys = [
    "segmentProgress", "lapDistance", "totalDistance", "totalRaceTime", "currentSpeed", "reactionTime",
    "trackLineOffset", "gapToLeader", "gapToCarAhead", "gapToCarBehind", "tyreLife", "tyreTemperature",
    "brakeTemperature", "powerUnitTemperature", "gearboxTemperature", "energyStoreTemperature",
    "powerUnitStress", "gearboxStress", "energyStoreStress", "brakeStress", "thermalDeratePercent", "thermalRiskPercent",
    "fuelRemainingKg", "setupPerformanceFactor", "eventPerformanceFactor", "batteryPercent", "dirtyAirLoss",
    "pitLaneTimer", "pitTimer", "pitStopTargetSeconds", "damageLevel", "vscDeltaSeconds", "vscViolationSeconds",
    "incidentTimer", "strategyConfidence", "currentLapTime", "currentSectorTime", "lapStartedAt", "sectorStartedAt",
  ] as const;
  for (const key of numberKeys) expectNumber(car[key], `${path}.${key}`, issues);
  for (const key of ["lastOvertakeAt", "lastPitStopTime", "lastPitLaneTime", "safetyCarGapToTargetMeters", "lastLapTime", "bestLapTime", "finishTime"] as const) {
    expectNullableNumber(car[key], `${path}.${key}`, issues);
  }
  for (const key of ["overtakeEligible", "overtakeActive", "boostActive", "finished"] as const) expectBoolean(car[key], `${path}.${key}`, issues);
  expectOptionalBoolean(car, "energyAutoEnabled", path, issues);
  for (const key of ["driverMomentTimer", "lastDriverMomentAt", "incidentStartedAt", "lastIncidentAt", "pitLimiterFaultSeconds", "lastPitStopCompletedAt", "damageScenarioTimer", "damageScenarioStartedAt"] as const) {
    expectOptionalNumber(car, key, path, issues);
  }
  expectOptionalNumber(car, "reliabilityConditionPercent", path, issues, { minimum: 0, maximum: 100 });
  expectOptionalNumber(car, "reliabilityRiskPercent", path, issues, { minimum: 0, maximum: 100 });
  expectOptionalNumber(car, "reliabilityDeratePercent", path, issues, { minimum: 0, maximum: 100 });
  expectOptionalString(car, "reliabilityLimitingComponent", path, issues);
  expectOptionalNumber(car, "reliabilityFailureDistance", path, issues, { minimum: 0 });
  expectOptionalString(car, "reliabilityFailureComponent", path, issues);
  for (const key of ["trackLimitsWarnings", "blueFlagSeconds", "blueFlagWarnings", "penaltyHoldSeconds", "penaltyHoldElapsedSeconds", "pitTyreServiceTargetSeconds", "pitTyreServiceElapsedSeconds", "lastPenaltyHoldSeconds", "lastPenaltyServedAt"] as const) {
    expectOptionalNumber(car, key, path, issues);
  }
  for (const key of ["blueFlagActive", "servePenaltyRequested"] as const) expectOptionalBoolean(car, key, path, issues);
  for (const key of ["penaltyServiceId"] as const) expectOptionalString(car, key, path, issues);
  if ("aiDecision" in car && car.aiDecision !== undefined) {
    const decision = expectRecord(car.aiDecision, `${path}.aiDecision`, issues);
    if (decision) {
      expectString(decision.intent, `${path}.aiDecision.intent`, issues);
      expectString(decision.objective, `${path}.aiDecision.objective`, issues);
      expectNullableString(decision.targetCarId, `${path}.aiDecision.targetCarId`, issues);
      expectNullableString(decision.pitReason, `${path}.aiDecision.pitReason`, issues);
      expectNullableNumber(decision.plannedPitLap, `${path}.aiDecision.plannedPitLap`, issues, { integer: true, minimum: 1 });
      expectNumber(decision.confidence, `${path}.aiDecision.confidence`, issues, { minimum: 0, maximum: 1 });
      expectNumber(decision.decidedAt, `${path}.aiDecision.decidedAt`, issues, { minimum: 0 });
      const reasons = expectArray(decision.reasons, `${path}.aiDecision.reasons`, issues);
      reasons?.forEach((reason, index) => expectString(reason, `${path}.aiDecision.reasons[${index}]`, issues));
    }
  }

  validateTyreTemperatures(car.tyreTemperatures, `${path}.tyreTemperatures`, issues);
  validateTyreTemperatures(car.brakeTemperatures, `${path}.brakeTemperatures`, issues);
  validateNumberTuple(car.sectorTimes, 3, `${path}.sectorTimes`, issues, true);
  validateNumberTuple(car.lastLapSectorTimes, 3, `${path}.lastLapSectorTimes`, issues, true);

  const tyreSets = expectArray(car.tyreSets, `${path}.tyreSets`, issues);
  tyreSets?.forEach((set, index) => {
    const record = expectRecord(set, `${path}.tyreSets[${index}]`, issues);
    if (!record) return;
    expectString(record.id, `${path}.tyreSets[${index}].id`, issues);
    expectEnum(record.compound, TYRE_COMPOUNDS, `${path}.tyreSets[${index}].compound`, issues);
    expectEnum(record.status, TYRE_SET_STATUSES, `${path}.tyreSets[${index}].status`, issues);
    expectNumber(record.condition, `${path}.tyreSets[${index}].condition`, issues);
    expectNumber(record.lapsUsed, `${path}.tyreSets[${index}].lapsUsed`, issues, { minimum: 0 });
  });
  const usedCompounds = expectArray(car.usedTyreCompounds, `${path}.usedTyreCompounds`, issues);
  usedCompounds?.forEach((compound, index) => expectEnum(compound, TYRE_COMPOUNDS, `${path}.usedTyreCompounds[${index}]`, issues));

  const opponentTimes = expectRecord(car.overtakeOpponentTimes, `${path}.overtakeOpponentTimes`, issues);
  if (opponentTimes) Object.entries(opponentTimes).forEach(([key, time]) => expectNumber(time, `${path}.overtakeOpponentTimes.${key}`, issues));
  if (car.pendingOvertake !== null) {
    const pending = expectRecord(car.pendingOvertake, `${path}.pendingOvertake`, issues);
    if (pending) {
      expectString(pending.opponentCarId, `${path}.pendingOvertake.opponentCarId`, issues);
      expectNumber(pending.detectedAt, `${path}.pendingOvertake.detectedAt`, issues);
      expectNumber(pending.positionsGained, `${path}.pendingOvertake.positionsGained`, issues, { integer: true, minimum: 1 });
    }
  }
  if ("energySystem" in car && car.energySystem !== undefined) validateEnergySystem(car.energySystem, `${path}.energySystem`, issues);
  return car as unknown as RaceCarState;
}

function validateRaceSnapshot(value: unknown, path: string, issues: MutableIssues): RaceSnapshot | null {
  const snapshot = expectRecord(value, path, issues);
  if (!snapshot) return null;
  expectString(snapshot.circuitId, `${path}.circuitId`, issues);
  expectString(snapshot.playerTeamId, `${path}.playerTeamId`, issues);
  expectString(snapshot.checksum, `${path}.checksum`, issues, true);
  expectNumber(snapshot.seed, `${path}.seed`, issues, { integer: true });
  expectNumber(snapshot.tick, `${path}.tick`, issues, { integer: true, minimum: 0 });
  expectNumber(snapshot.elapsedTime, `${path}.elapsedTime`, issues, { minimum: 0 });
  expectEnum(snapshot.status, RACE_STATUSES, `${path}.status`, issues);
  expectEnum(snapshot.raceControl, RACE_CONTROL_STATUSES, `${path}.raceControl`, issues);
  expectEnum(snapshot.safetyCarPhase, SAFETY_CAR_PHASES, `${path}.safetyCarPhase`, issues);
  expectEnum(snapshot.pitLaneStatus, PIT_LANE_STATUSES, `${path}.pitLaneStatus`, issues);
  expectEnum(snapshot.stewardStrictness, STEWARD_STRICTNESS, `${path}.stewardStrictness`, issues);
  expectNullableNumber(snapshot.yellowSector, `${path}.yellowSector`, issues, { integer: true, minimum: 1, maximum: 3 });
  for (const key of [
    "raceControlTimer", "safetyCarPhaseElapsedSeconds", "safetyCarSpeed", "scheduledSafetyCarDistance",
  ] as const) expectNumber(snapshot[key], `${path}.${key}`, issues, { minimum: 0 });
  for (const key of ["safetyCarDistance", "safetyCarDeploymentDistance", "safetyCarEndingStartDistance", "safetyCarPitEntryDistance", "safetyCarRestartLineDistance"] as const) {
    expectNullableNumber(snapshot[key], `${path}.${key}`, issues, { minimum: 0 });
  }
  expectEnum(snapshot.safetyCarTargetLaps, [1, 2] as const, `${path}.safetyCarTargetLaps`, issues);
  expectNumber(snapshot.safetyCarDeployments, `${path}.safetyCarDeployments`, issues, { integer: true, minimum: 0 });
  for (const key of ["safetyCarFieldBunched", "safetyCarInPitLane", "safetyCarLappedCarsMayOvertake", "pitLaneOpen"] as const) {
    expectBoolean(snapshot[key], `${path}.${key}`, issues);
  }
  validateWeather(snapshot.weather, `${path}.weather`, issues);

  const teamOrder = expectRecord(snapshot.teamOrder, `${path}.teamOrder`, issues);
  if (teamOrder) {
    expectEnum(teamOrder.type, TEAM_ORDER_TYPES, `${path}.teamOrder.type`, issues);
    expectNumber(teamOrder.issuedAt, `${path}.teamOrder.issuedAt`, issues, { minimum: 0 });
    expectNullableString(teamOrder.leadCarId, `${path}.teamOrder.leadCarId`, issues);
    expectNullableString(teamOrder.trailingCarId, `${path}.teamOrder.trailingCarId`, issues);
  }

  const cars = expectArray(snapshot.cars, `${path}.cars`, issues);
  const validatedCars = cars?.map((car, index) => validateRaceCar(car, `${path}.cars[${index}]`, issues)).filter((car): car is RaceCarState => car !== null) ?? [];
  if (cars?.length === 0) addIssue(issues, `${path}.cars`, "must contain at least one car");
  const carIds = validatedCars.map((car) => car.carId);
  if (new Set(carIds).size !== carIds.length) addIssue(issues, `${path}.cars`, "contains duplicate carId values");
  validatedCars.forEach((car, index) => {
    if (car.circuitId !== undefined && car.circuitId !== snapshot.circuitId) {
      addIssue(issues, `${path}.cars[${index}].circuitId`, "must match raceSnapshot.circuitId");
    }
  });

  for (const key of ["safetyCarWaveBy", "investigations", "penalties", "events", "radioMessages"] as const) {
    expectArray(snapshot[key], `${path}.${key}`, issues);
  }
  const waveBy = Array.isArray(snapshot.safetyCarWaveBy) ? snapshot.safetyCarWaveBy : [];
  waveBy.forEach((item, index) => {
    const record = expectRecord(item, `${path}.safetyCarWaveBy[${index}]`, issues);
    if (!record) return;
    expectString(record.carId, `${path}.safetyCarWaveBy[${index}].carId`, issues);
    expectNumber(record.startDistance, `${path}.safetyCarWaveBy[${index}].startDistance`, issues, { minimum: 0 });
    expectNumber(record.targetDistance, `${path}.safetyCarWaveBy[${index}].targetDistance`, issues, { minimum: 0 });
    expectBoolean(record.completed, `${path}.safetyCarWaveBy[${index}].completed`, issues);
  });
  return snapshot as unknown as RaceSnapshot;
}

function validateCarSetup(value: unknown, path: string, issues: MutableIssues): void {
  const setup = expectRecord(value, path, issues);
  if (!setup) return;
  for (const key of ["frontWing", "rearWing", "suspension", "rideHeight", "differential", "cooling"] satisfies readonly (keyof CarSetup)[]) {
    expectNumber(setup[key], `${path}.${key}`, issues, { minimum: -50, maximum: 50 });
  }
}

function validateWeekendTyreInventory(value: unknown, path: string, issues: MutableIssues): void {
  const inventory = expectRecord(value, path, issues);
  if (!inventory) return;
  Object.entries(inventory).forEach(([carId, sets]) => {
    const tyreSets = expectArray(sets, `${path}.${carId}`, issues);
    tyreSets?.forEach((set, index) => {
      const record = expectRecord(set, `${path}.${carId}[${index}]`, issues);
      if (!record) return;
      expectString(record.id, `${path}.${carId}[${index}].id`, issues);
      expectString(record.driverId, `${path}.${carId}[${index}].driverId`, issues);
      expectEnum(record.compound, TYRE_COMPOUNDS, `${path}.${carId}[${index}].compound`, issues);
      expectEnum(record.status, WEEKEND_TYRE_SET_STATUSES, `${path}.${carId}[${index}].status`, issues);
      expectNumber(record.wearPercent, `${path}.${carId}[${index}].wearPercent`, issues, { minimum: 0, maximum: 100 });
      expectNumber(record.heatCycles, `${path}.${carId}[${index}].heatCycles`, issues, { integer: true, minimum: 0 });
      expectNumber(record.lapsCompleted, `${path}.${carId}[${index}].lapsCompleted`, issues, { integer: true, minimum: 0 });
      const history = expectArray(record.sessionHistory, `${path}.${carId}[${index}].sessionHistory`, issues);
      history?.forEach((session, historyIndex) => expectString(session, `${path}.${carId}[${index}].sessionHistory[${historyIndex}]`, issues));
      if (record.driverId !== carId) addIssue(issues, `${path}.${carId}[${index}].driverId`, "must match its inventory owner");
    });
  });
}

function validateQualifyingTiming(value: unknown, path: string, issues: MutableIssues): void {
  const timing = expectRecord(value, path, issues);
  if (!timing) return;
  validateNumberTuple(timing.currentSectorTimes, 3, `${path}.currentSectorTimes`, issues, true);
  validateNumberTuple(timing.personalBestSectorTimes, 3, `${path}.personalBestSectorTimes`, issues, true);
  const tones = expectArray(timing.currentSectorTones, `${path}.currentSectorTones`, issues);
  if (tones?.length !== 3) addIssue(issues, `${path}.currentSectorTones`, "must contain exactly 3 entries");
  tones?.forEach((tone, index) => expectEnum(tone, SECTOR_TONES, `${path}.currentSectorTones[${index}]`, issues));
  expectNullableNumber(timing.currentLapTimeSeconds, `${path}.currentLapTimeSeconds`, issues);
  expectNullableNumber(timing.personalBestLapTimeSeconds, `${path}.personalBestLapTimeSeconds`, issues);
  expectBoolean(timing.currentLapValid, `${path}.currentLapValid`, issues);
  expectBoolean(timing.currentLapCompetitive, `${path}.currentLapCompetitive`, issues);
}

function validateQualifyingCar(value: unknown, path: string, issues: MutableIssues): QualifyingCarState | null {
  const car = expectRecord(value, path, issues);
  if (!car) return null;
  expectString(car.carId, `${path}.carId`, issues);
  expectEnum(car.phase, QUALIFYING_PHASES, `${path}.phase`, issues);
  expectEnum(car.selectedCompound, TYRE_COMPOUNDS, `${path}.selectedCompound`, issues);
  expectNullableString(car.selectedTyreSetId, `${path}.selectedTyreSetId`, issues);
  expectEnum(car.outLapMode, QUALIFYING_OUT_LAP_MODES, `${path}.outLapMode`, issues);
  expectEnum(car.attackMode, QUALIFYING_ATTACK_MODES, `${path}.attackMode`, issues);
  expectEnum(car.energyMode, QUALIFYING_ENERGY_MODES, `${path}.energyMode`, issues);
  expectEnum(car.releaseRequest, QUALIFYING_RELEASE_REQUESTS, `${path}.releaseRequest`, issues);
  expectEnum(car.trafficResponse, QUALIFYING_TRAFFIC_RESPONSES, `${path}.trafficResponse`, issues);
  expectEnum(car.fuelPlan, QUALIFYING_FUEL_PLANS, `${path}.fuelPlan`, issues);
  expectEnum(car.trafficLevel, QUALIFYING_TRAFFIC_LEVELS, `${path}.trafficLevel`, issues);
  expectEnum(car.trafficDecisionState, QUALIFYING_TRAFFIC_DECISIONS, `${path}.trafficDecisionState`, issues);
  expectEnum(car.lastRunNote, QUALIFYING_RUN_NOTES, `${path}.lastRunNote`, issues);
  const numberKeys = [
    "phaseRemainingSeconds", "phaseDurationSeconds", "fittedRunStartCompletedRuns", "tyreTemperatureC",
    "tyreConditionPercent", "currentSpeedKph", "previousSpeedKph", "energyPercent", "phaseStartProgress",
    "fuelLoadKg", "flyingLapsRemaining", "yieldingDurationSeconds", "yieldCooldownSeconds", "flyingConflictSeconds",
    "completedRuns", "trafficPenaltySeconds", "provisionalTrafficAppliedSeconds",
  ] as const;
  for (const key of numberKeys) expectNumber(car[key], `${path}.${key}`, issues);
  for (const key of ["releaseRequestedAtSeconds", "gapAheadSeconds", "gapBehindSeconds", "trafficConflictGapSeconds", "bestLapSeconds", "lastLapSeconds"] as const) {
    expectNullableNumber(car[key], `${path}.${key}`, issues);
  }
  for (const key of ["yieldingToCarId", "trafficConflictCarId", "trafficDecisionMessage"] as const) expectNullableString(car[key], `${path}.${key}`, issues);
  for (const key of ["yielding", "impedingInvestigation"] as const) expectBoolean(car[key], `${path}.${key}`, issues);
  validateTyreTemperatures(car.tyreTemperatures, `${path}.tyreTemperatures`, issues);
  validateQualifyingTiming(car.timing, `${path}.timing`, issues);
  if (car.provisionalSectorTargets !== null) validateNumberTuple(car.provisionalSectorTargets, 3, `${path}.provisionalSectorTargets`, issues);
  if (car.provisionalLapOutcome !== null) expectEnum(car.provisionalLapOutcome, QUALIFYING_RUN_NOTES, `${path}.provisionalLapOutcome`, issues);
  return car as unknown as QualifyingCarState;
}

function validateLiveQualifying(value: unknown, path: string, issues: MutableIssues): LiveQualifyingState | null {
  const live = expectRecord(value, path, issues);
  if (!live) return null;
  expectEnum(live.session, QUALIFYING_SESSIONS, `${path}.session`, issues);
  expectEnum(live.status, QUALIFYING_SESSION_STATUSES, `${path}.status`, issues);
  for (const key of ["elapsedSeconds", "remainingSeconds", "durationSeconds", "trackEvolutionPercent"] as const) {
    expectNumber(live[key], `${path}.${key}`, issues, { minimum: 0 });
  }
  expectEnum(live.speed, [1, 2, 4, 8, 16] as const, `${path}.speed`, issues);
  expectBoolean(live.paused, `${path}.paused`, issues);
  const cars = expectRecord(live.cars, `${path}.cars`, issues);
  if (cars) Object.entries(cars).forEach(([carId, car]) => {
    const validated = validateQualifyingCar(car, `${path}.cars.${carId}`, issues);
    if (validated && validated.carId !== carId) addIssue(issues, `${path}.cars.${carId}.carId`, "must match its record key");
  });
  const timing = expectRecord(live.timing, `${path}.timing`, issues);
  if (timing) {
    validateNumberTuple(timing.bestSectorTimes, 3, `${path}.timing.bestSectorTimes`, issues, true);
    const ids = expectArray(timing.bestSectorDriverIds, `${path}.timing.bestSectorDriverIds`, issues);
    if (ids?.length !== 3) addIssue(issues, `${path}.timing.bestSectorDriverIds`, "must contain exactly 3 entries");
    ids?.forEach((id, index) => {
      if (id !== null) expectString(id, `${path}.timing.bestSectorDriverIds[${index}]`, issues);
    });
    expectNullableNumber(timing.bestLapTimeSeconds, `${path}.timing.bestLapTimeSeconds`, issues);
    expectNullableString(timing.bestLapDriverId, `${path}.timing.bestLapDriverId`, issues);
  }
  return live as unknown as LiveQualifyingState;
}

function validateWeekendState(value: unknown, path: string, issues: MutableIssues): WeekendState | null {
  const weekend = expectRecord(value, path, issues);
  if (!weekend) return null;
  expectNumber(weekend.seed, `${path}.seed`, issues, { integer: true });
  expectString(weekend.circuitId, `${path}.circuitId`, issues);
  expectString(weekend.playerTeamId, `${path}.playerTeamId`, issues);
  expectEnum(weekend.currentSession, WEEKEND_SESSIONS, `${path}.currentSession`, issues);
  expectNumber(weekend.setupKnowledge, `${path}.setupKnowledge`, issues, { minimum: 0, maximum: 100 });

  const completed = expectArray(weekend.completedSessions, `${path}.completedSessions`, issues);
  completed?.forEach((session, index) => expectEnum(session, COMPLETABLE_WEEKEND_SESSIONS, `${path}.completedSessions[${index}]`, issues));
  if (completed && new Set(completed).size !== completed.length) addIssue(issues, `${path}.completedSessions`, "contains duplicate sessions");

  const grid = expectArray(weekend.gridOrder, `${path}.gridOrder`, issues);
  grid?.forEach((carId, index) => expectString(carId, `${path}.gridOrder[${index}]`, issues));
  if (grid && new Set(grid).size !== grid.length) addIssue(issues, `${path}.gridOrder`, "contains duplicate car IDs");

  for (const key of ["setups", "lastRunSetups"] as const) {
    const setups = expectRecord(weekend[key], `${path}.${key}`, issues);
    if (setups) Object.entries(setups).forEach(([carId, setup]) => validateCarSetup(setup, `${path}.${key}.${carId}`, issues));
  }
  const tyreUsage = expectRecord(weekend.tyreUsage, `${path}.tyreUsage`, issues);
  if (tyreUsage) Object.entries(tyreUsage).forEach(([carId, usage]) => {
    const compounds = expectRecord(usage, `${path}.tyreUsage.${carId}`, issues);
    if (!compounds) return;
    Object.entries(compounds).forEach(([compound, count]) => {
      expectEnum(compound, TYRE_COMPOUNDS, `${path}.tyreUsage.${carId}.${compound}`, issues);
      expectNumber(count, `${path}.tyreUsage.${carId}.${compound}`, issues, { integer: true, minimum: 0 });
    });
  });
  validateWeekendTyreInventory(weekend.tyreInventory, `${path}.tyreInventory`, issues);

  const results = expectArray(weekend.results, `${path}.results`, issues);
  results?.forEach((result, index) => {
    const record = expectRecord(result, `${path}.results[${index}]`, issues);
    if (!record) return;
    expectEnum(record.session, COMPLETABLE_WEEKEND_SESSIONS, `${path}.results[${index}].session`, issues);
    expectNumber(record.durationMinutes, `${path}.results[${index}].durationMinutes`, issues, { minimum: 0 });
    const entries = expectArray(record.entries, `${path}.results[${index}].entries`, issues);
    entries?.forEach((entry, entryIndex) => {
      const classification = expectRecord(entry, `${path}.results[${index}].entries[${entryIndex}]`, issues);
      if (!classification) return;
      expectNumber(classification.position, `${path}.results[${index}].entries[${entryIndex}].position`, issues, { integer: true, minimum: 1 });
      expectString(classification.carId, `${path}.results[${index}].entries[${entryIndex}].carId`, issues);
      for (const key of ["bestLapSeconds", "gapSeconds"] as const) expectNumber(classification[key], `${path}.results[${index}].entries[${entryIndex}].${key}`, issues);
      expectNumber(classification.laps, `${path}.results[${index}].entries[${entryIndex}].laps`, issues, { integer: true, minimum: 0 });
      expectEnum(classification.compound, TYRE_COMPOUNDS, `${path}.results[${index}].entries[${entryIndex}].compound`, issues);
      expectBoolean(classification.eliminated, `${path}.results[${index}].entries[${entryIndex}].eliminated`, issues);
      if ("timedLap" in classification) expectBoolean(classification.timedLap, `${path}.results[${index}].entries[${entryIndex}].timedLap`, issues);
    });
  });

  const qualifying = expectArray(weekend.qualifying, `${path}.qualifying`, issues);
  qualifying?.forEach((item, index) => {
    const record = expectRecord(item, `${path}.qualifying[${index}]`, issues);
    if (!record) return;
    expectString(record.carId, `${path}.qualifying[${index}].carId`, issues);
    for (const key of ["q1", "q2", "q3"] as const) expectNullableNumber(record[key], `${path}.qualifying[${index}].${key}`, issues);
    if (record.eliminatedIn !== null) expectEnum(record.eliminatedIn, QUALIFYING_SESSIONS, `${path}.qualifying[${index}].eliminatedIn`, issues);
    expectNullableNumber(record.finalPosition, `${path}.qualifying[${index}].finalPosition`, issues, { integer: true, minimum: 1 });
  });

  const reports = expectArray(weekend.sessionReports, `${path}.sessionReports`, issues);
  reports?.forEach((report, index) => {
    const record = expectRecord(report, `${path}.sessionReports[${index}]`, issues);
    if (!record) return;
    expectEnum(record.session, COMPLETABLE_WEEKEND_SESSIONS, `${path}.sessionReports[${index}].session`, issues);
    expectString(record.title, `${path}.sessionReports[${index}].title`, issues);
    expectString(record.summary, `${path}.sessionReports[${index}].summary`, issues);
    expectArray(record.cars, `${path}.sessionReports[${index}].cars`, issues);
  });

  if (weekend.qualifyingLive !== null) {
    const live = validateLiveQualifying(weekend.qualifyingLive, `${path}.qualifyingLive`, issues);
    if (live && live.session !== weekend.currentSession) addIssue(issues, `${path}.qualifyingLive.session`, "must match weekendState.currentSession");
  }
  return weekend as unknown as WeekendState;
}

function validateChampionshipState(value: unknown, path: string, issues: MutableIssues): ChampionshipState | null {
  const championship = expectRecord(value, path, issues);
  if (!championship) return null;
  expectString(championship.id, `${path}.id`, issues);
  expectNumber(championship.nextRoundIndex, `${path}.nextRoundIndex`, issues, { integer: true, minimum: 0 });
  expectEnum(championship.status, CHAMPIONSHIP_STATUSES, `${path}.status`, issues);
  const schedule = expectArray(championship.schedule, `${path}.schedule`, issues);
  const scheduledByRound = new Map<number, string>();
  schedule?.forEach((item, index) => {
    const round = expectRecord(item, `${path}.schedule[${index}]`, issues);
    if (!round) return;
    if (expectNumber(round.roundNumber, `${path}.schedule[${index}].roundNumber`, issues, { integer: true, minimum: 1 })
      && expectString(round.circuitId, `${path}.schedule[${index}].circuitId`, issues)) {
      if (scheduledByRound.has(round.roundNumber)) addIssue(issues, `${path}.schedule[${index}].roundNumber`, "must be unique");
      scheduledByRound.set(round.roundNumber, round.circuitId);
    }
  });
  if (schedule?.length === 0) addIssue(issues, `${path}.schedule`, "must contain at least one round");
  if (typeof championship.nextRoundIndex === "number" && schedule && championship.nextRoundIndex > schedule.length) {
    addIssue(issues, `${path}.nextRoundIndex`, "must not exceed schedule length");
  }

  const results = expectArray(championship.roundResults, `${path}.roundResults`, issues);
  const resultRounds = new Set<number>();
  results?.forEach((item, index) => {
    const resultPath = `${path}.roundResults[${index}]`;
    const result = expectRecord(item, resultPath, issues);
    if (!result) return;
    const validRound = expectNumber(result.roundNumber, `${resultPath}.roundNumber`, issues, { integer: true, minimum: 1 });
    const validCircuit = expectString(result.circuitId, `${resultPath}.circuitId`, issues);
    expectNullableString(result.fastestLapDriverId, `${resultPath}.fastestLapDriverId`, issues);
    if (validRound) {
      const roundNumber = result.roundNumber as number;
      if (resultRounds.has(roundNumber)) addIssue(issues, `${resultPath}.roundNumber`, "must be unique");
      resultRounds.add(roundNumber);
      if (validCircuit && scheduledByRound.get(roundNumber) !== result.circuitId) addIssue(issues, `${resultPath}.circuitId`, "must match the scheduled circuit");
    }
    const classification = expectArray(result.classification, `${resultPath}.classification`, issues);
    if (classification?.length === 0) addIssue(issues, `${resultPath}.classification`, "must contain at least one driver");
    const positions = new Set<number>();
    const drivers = new Set<string>();
    classification?.forEach((entryValue, entryIndex) => {
      const entryPath = `${resultPath}.classification[${entryIndex}]`;
      const entry = expectRecord(entryValue, entryPath, issues);
      if (!entry) return;
      if (expectNumber(entry.position, `${entryPath}.position`, issues, { integer: true, minimum: 1 })) {
        if (positions.has(entry.position)) addIssue(issues, `${entryPath}.position`, "must be unique within the result");
        positions.add(entry.position);
      }
      if (expectString(entry.driverId, `${entryPath}.driverId`, issues)) {
        if (drivers.has(entry.driverId)) addIssue(issues, `${entryPath}.driverId`, "must be unique within the result");
        drivers.add(entry.driverId);
      }
      expectString(entry.teamId, `${entryPath}.teamId`, issues);
      const status = expectRecord(entry.status, `${entryPath}.status`, issues);
      if (!status || !expectEnum(status.type, ROUND_CLASSIFICATION_STATUSES, `${entryPath}.status.type`, issues)) return;
      if (status.type === "RETIRED") {
        expectBoolean(status.classified, `${entryPath}.status.classified`, issues);
        expectString(status.reason, `${entryPath}.status.reason`, issues);
      }
    });
    if (typeof result.fastestLapDriverId === "string" && !drivers.has(result.fastestLapDriverId)) {
      addIssue(issues, `${resultPath}.fastestLapDriverId`, "must identify a driver in the classification");
    }
  });
  const nextRoundIndex = typeof championship.nextRoundIndex === "number" ? championship.nextRoundIndex : Number.NaN;
  if (schedule && results && nextRoundIndex !== results.length) addIssue(issues, `${path}.nextRoundIndex`, "must equal the number of recorded results");
  if (schedule && championship.status === "COMPLETED" && nextRoundIndex !== schedule.length) addIssue(issues, `${path}.status`, "COMPLETED requires every scheduled round result");
  if (schedule && championship.status === "IN_PROGRESS" && nextRoundIndex >= schedule.length) addIssue(issues, `${path}.status`, "must be COMPLETED after the final round");
  return championship as unknown as ChampionshipState;
}

function validateReliabilityState(value: unknown, path: string, issues: MutableIssues): ReliabilityState | null {
  const reliability = expectRecord(value, path, issues);
  if (!reliability) return null;
  expectNumber(reliability.currentRound, `${path}.currentRound`, issues, { integer: true, minimum: 1 });
  expectNumber(reliability.pendingGridPenaltyPlaces, `${path}.pendingGridPenaltyPlaces`, issues, { integer: true, minimum: 0 });
  expectNumber(reliability.accumulatedGridPenaltyPlaces, `${path}.accumulatedGridPenaltyPlaces`, issues, { integer: true, minimum: 0 });
  if (typeof reliability.pendingGridPenaltyPlaces === "number"
    && typeof reliability.accumulatedGridPenaltyPlaces === "number"
    && reliability.pendingGridPenaltyPlaces > reliability.accumulatedGridPenaltyPlaces) {
    addIssue(issues, `${path}.pendingGridPenaltyPlaces`, "must not exceed the accumulated total");
  }
  const components = expectRecord(reliability.components, `${path}.components`, issues);
  if (components) {
    for (const unknownKind of Object.keys(components)) {
      if (!RELIABILITY_COMPONENTS.includes(unknownKind as (typeof RELIABILITY_COMPONENTS)[number])) addIssue(issues, `${path}.components.${unknownKind}`, "is not a managed component");
    }
    for (const kind of RELIABILITY_COMPONENTS) {
      const componentPath = `${path}.components.${kind}`;
      const component = expectRecord(components[kind], componentPath, issues);
      if (!component) continue;
      if (expectString(component.kind, `${componentPath}.kind`, issues) && component.kind !== kind) addIssue(issues, `${componentPath}.kind`, "must match its component key");
      expectNumber(component.unitNumber, `${componentPath}.unitNumber`, issues, { integer: true, minimum: 1 });
      expectNumber(component.health, `${componentPath}.health`, issues, { minimum: 0, maximum: 100 });
      expectNumber(component.mileageKm, `${componentPath}.mileageKm`, issues, { minimum: 0 });
      for (const key of ["raceCount", "repairCount", "replacementCount"] as const) expectNumber(component[key], `${componentPath}.${key}`, issues, { integer: true, minimum: 0 });
      expectNullableNumber(component.lastServiceRound, `${componentPath}.lastServiceRound`, issues, { integer: true, minimum: 1 });
    }
  }
  return reliability as unknown as ReliabilityState;
}

function collectGameSaveValidationIssues(value: unknown): GameSaveValidationIssue[] {
  const issues: MutableIssues = [];
  validateJsonValue(value, "$", issues);
  const save = expectRecord(value, "$", issues);
  if (!save) return issues;

  const allowedRootKeys = new Set(["schemaVersion", "savedAt", "raceSnapshot", "weekendState", "championshipState", "reliabilityState"]);
  for (const key of Object.keys(save)) {
    if (!allowedRootKeys.has(key)) addIssue(issues, `$.${key}`, "is not part of the GameSaveV1 schema");
  }
  expectEnum(save.schemaVersion, [GAME_SAVE_SCHEMA_VERSION] as const, "$.schemaVersion", issues);
  if (expectString(save.savedAt, "$.savedAt", issues)) {
    const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
    if (!isoUtc.test(save.savedAt) || !Number.isFinite(Date.parse(save.savedAt))) {
      addIssue(issues, "$.savedAt", "must be a valid UTC ISO-8601 timestamp");
    }
  }
  const race = validateRaceSnapshot(save.raceSnapshot, "$.raceSnapshot", issues);
  const weekend = validateWeekendState(save.weekendState, "$.weekendState", issues);
  if ("championshipState" in save) validateChampionshipState(save.championshipState, "$.championshipState", issues);
  if ("reliabilityState" in save) validateReliabilityState(save.reliabilityState, "$.reliabilityState", issues);
  if (race && weekend) {
    if (race.seed !== weekend.seed) addIssue(issues, "$.weekendState.seed", "must match raceSnapshot.seed");
    if (race.playerTeamId !== weekend.playerTeamId) addIssue(issues, "$.weekendState.playerTeamId", "must match raceSnapshot.playerTeamId");
    if (race.circuitId !== weekend.circuitId) addIssue(issues, "$.weekendState.circuitId", "must match raceSnapshot.circuitId");
    if (Array.isArray(race.cars) && Array.isArray(weekend.gridOrder)) {
      const structurallyUsableCars = race.cars.filter((car) => isRecord(car)
        && typeof car.carId === "string"
        && typeof car.teamId === "string") as readonly RaceCarState[];
      const raceCarIds = new Set(structurallyUsableCars.map((car) => car.carId));
      if (weekend.gridOrder.length !== raceCarIds.size || weekend.gridOrder.some((carId) => typeof carId !== "string" || !raceCarIds.has(carId))) {
        addIssue(issues, "$.weekendState.gridOrder", "must contain exactly the raceSnapshot car IDs");
      }
      if (typeof race.playerTeamId === "string" && !structurallyUsableCars.some((car) => car.teamId === race.playerTeamId)) {
        addIssue(issues, "$.raceSnapshot.playerTeamId", "must identify a team represented by at least one race car");
      }
    }
  }
  return issues;
}

/** Returns every detected problem without throwing, suitable for import previews. */
export function gameSaveValidationIssues(value: unknown): readonly GameSaveValidationIssue[] {
  return collectGameSaveValidationIssues(value);
}

export function isGameSaveV1(value: unknown): value is GameSaveV1 {
  return collectGameSaveValidationIssues(value).length === 0;
}

/** Validates and narrows a value, throwing a path-rich error when it is unsafe. */
export function validateGameSave(value: unknown): GameSaveV1 {
  const issues = collectGameSaveValidationIssues(value);
  if (issues.length > 0) throw new GameSaveValidationError(issues);
  const normalized = stripLegacyBrakeBalanceFields(value);
  return normalized as GameSaveV1;
}

/**
 * Single migration entry point. Add a migration for version N here, advance the
 * version, then loop until current. Migrations must return new JSON data and
 * must never mutate the imported value.
 */
export function migrateGameSave(value: unknown): unknown {
  const jsonIssues: MutableIssues = [];
  validateJsonValue(value, "$", jsonIssues);
  if (jsonIssues.length > 0) throw new GameSaveValidationError(jsonIssues);
  const save = expectRecord(value, "$", jsonIssues);
  if (!save) throw new GameSaveValidationError(jsonIssues);
  if (typeof save.schemaVersion !== "number" || !Number.isInteger(save.schemaVersion)) {
    throw new GameSaveValidationError([{ path: "$.schemaVersion", message: "must be an integer" }]);
  }

  switch (save.schemaVersion) {
    case GAME_SAVE_SCHEMA_VERSION:
      return stripLegacyBrakeBalanceFields(save);
    // Future example:
    // case 2: return migrateV2ToV3(save);
    default:
      throw new UnsupportedGameSaveVersionError(save.schemaVersion);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

/** Remove the retired player-facing brake-balance field from legacy saves. */
function stripLegacyBrakeBalanceFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const normalized = stripLegacyBrakeBalanceFields(item);
      changed ||= normalized !== item;
      return normalized;
    });
    return changed ? items : value;
  }
  if (!isRecord(value)) return value;

  let changed = false;
  const entries = Object.entries(value).flatMap(([key, item]) => {
    if (key === "brakeBiasPercent") {
      changed = true;
      return [];
    }
    const normalized = stripLegacyBrakeBalanceFields(item);
    changed ||= normalized !== item;
    return [[key, normalized] as const];
  });
  return changed ? Object.fromEntries(entries) : value;
}

function detachSimulationState(
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GameSaveValidationError([{ path, message: "contains a non-finite number" }]);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new GameSaveValidationError([{ path, message: `contains non-JSON value ${typeof value}` }]);
  }
  if (ancestors.has(value)) {
    throw new GameSaveValidationError([{ path, message: "contains a circular reference" }]);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        if (item === undefined) {
          throw new GameSaveValidationError([{ path: `${path}[${index}]`, message: "contains non-JSON value undefined" }]);
        }
        return detachSimulationState(item, `${path}[${index}]`, ancestors);
      });
    }
    if (!isRecord(value)) {
      throw new GameSaveValidationError([{ path, message: "contains a non-plain object" }]);
    }
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      // Simulation interfaces use optional fields, and some reducers leave those
      // properties present with `undefined`. JSON's object semantics omit them;
      // doing so explicitly here keeps creation loss-aware and deterministic.
      if (item === undefined) return [];
      return [[key, detachSimulationState(item, `${path}.${key}`, ancestors)]];
    }));
  } finally {
    ancestors.delete(value);
  }
}

/** Stable key ordering makes identical state produce byte-identical JSON. */
export function stringifyGameSave(value: unknown): string {
  const save = validateGameSave(value);
  const serialized = JSON.stringify(canonicalize(save));
  if (serialized.length > MAX_GAME_SAVE_CHARACTERS) {
    throw new GameSaveValidationError([{ path: "$", message: `exceeds ${MAX_GAME_SAVE_CHARACTERS} characters` }]);
  }
  return serialized;
}

export function parseGameSave(serialized: string): GameSaveV1 {
  if (typeof serialized !== "string") throw new GameSaveParseError("Game save input must be a JSON string.");
  if (serialized.length > MAX_GAME_SAVE_CHARACTERS) throw new GameSaveParseError(`Game save exceeds ${MAX_GAME_SAVE_CHARACTERS} characters.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new GameSaveParseError("Game save contains malformed JSON.", { cause: error });
  }
  return validateGameSave(migrateGameSave(parsed));
}

/** Creates a detached JSON value; caller-owned simulation state is never mutated. */
export function createGameSave(input: CreateGameSaveInput): GameSaveV1 {
  const candidate: GameSaveV1 = {
    schemaVersion: GAME_SAVE_SCHEMA_VERSION,
    savedAt: input.savedAt,
    raceSnapshot: input.raceSnapshot,
    weekendState: input.weekendState,
    ...(input.championshipState ? { championshipState: input.championshipState } : {}),
    ...(input.reliabilityState ? { reliabilityState: input.reliabilityState } : {}),
  };
  return validateGameSave(detachSimulationState(candidate, "$"));
}

export const createGameSaveV1 = createGameSave;
