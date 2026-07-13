export type RaceStatus = "READY" | "RUNNING" | "PAUSED" | "FINISHED";
export type PaceMode = "ATTACK" | "PUSH" | "STANDARD" | "CONSERVE" | "COOL";
export type TyreMode = "GRIP" | "BALANCED" | "SAVE" | "TEMPERATURE";
export type EnergyMode = "ATTACK" | "BALANCED" | "DEFEND" | "RECHARGE";
export type CoolingMode = "NORMAL" | "LIFT_AND_COAST" | "MAX_COOLING";
export type EnergyState = "NEUTRAL" | "HARVESTING" | "DEPLOYING" | "OVERTAKE" | "DEFENDING";
export type ActiveAeroMode = "CORNER" | "STRAIGHT" | "PARTIAL";
export type BattleStatus = "CLEAR" | "ATTACKING" | "DEFENDING" | "SIDE_BY_SIDE";
export type RacingLineMode = "GRID" | "RACING" | "ATTACK" | "DEFEND";
export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type TyreSetStatus = "AVAILABLE" | "FITTED" | "RESERVED" | "USED";
export type PitStopIssue = "NONE" | "SLOW_RELEASE" | "WHEEL_GUN" | "DOUBLE_STACK";
export type StrategyIntent = "HOLD" | "EXTEND" | "UNDERCUT" | "WEATHER" | "CHEAP_STOP" | "TYRE_LIMIT";
export type PitStatus = "TRACK" | "PIT_ENTRY" | "PIT_LANE" | "PIT_STOP" | "PIT_EXIT";
export type WeatherCondition = "DRY" | "CLOUDY" | "LIGHT_RAIN" | "HEAVY_RAIN";
export type RaceControlStatus = "GREEN" | "YELLOW" | "VSC" | "SAFETY_CAR";
export type SafetyCarPhase = "NONE" | "DEPLOYED" | "BUNCHING" | "RESTART";
export type VscComplianceStatus = "COMPLIANT" | "WARNING" | "VIOLATION";
export type PitLaneProcedureStatus = "OPEN" | "CLOSED";
export type IncidentStatus = "RUNNING" | "SPUN" | "DAMAGED" | "RETIRED";
export type WeatherSector = 1 | 2 | 3;

export interface WeatherRadarCell {
  id: string;
  row: number;
  column: number;
  x: number;
  y: number;
  rainIntensity: number;
  rainProbability: number;
  etaSeconds: number | null;
}

export interface TrackSurfaceZone {
  id: string;
  index: number;
  startDistance: number;
  endDistance: number;
  sector: WeatherSector;
  rainIntensity: number;
  wetness: number;
  standingWater: number;
  dryingLine: number;
  drainage: number;
  traffic: number;
}

export interface WeatherSectorState {
  sector: WeatherSector;
  rainIntensity: number;
  wetness: number;
  standingWater: number;
  dryingLine: number;
  condition: WeatherCondition;
}

export interface WeatherForecastPoint {
  minutesAhead: number;
  condition: WeatherCondition;
  rainProbability: number;
  rainIntensity: number;
}

export interface RaceEvent {
  id: string;
  elapsedTime: number;
  type: "INCIDENT" | "RACE_CONTROL" | "PIT" | "BATTLE" | "THERMAL";
  message: string;
  /** Explicit attribution for car-specific events; null/omitted means field-wide. */
  carId?: string | null;
}

export interface ActiveIncident {
  carId: string;
  distanceMeters: number;
  cornerNumber: number;
  cornerName: string;
  sector: 1 | 2 | 3;
  status: Exclude<IncidentStatus, "RUNNING">;
}

export interface RadioMessage {
  id: string;
  elapsedTime: number;
  carId: string | null;
  source: "ENGINEER" | "DRIVER" | "RACE CONTROL";
  message: string;
  priority: "NORMAL" | "WARNING" | "URGENT";
}

export interface WeatherState {
  condition: WeatherCondition;
  rainIntensity: number;
  trackWetness: number;
  airTemperature: number;
  trackTemperature: number;
  forecastRainInMinutes: number | null;
  radarCells?: readonly WeatherRadarCell[];
  surfaceZones?: readonly TrackSurfaceZone[];
  sectors?: readonly WeatherSectorState[];
  forecast?: readonly WeatherForecastPoint[];
}

export interface TeamDefinition {
  id: string;
  name: string;
  shortName: string;
  primaryColor: number;
  accentColor: number;
  performance: number;
  isPlayer: boolean;
}

export interface DriverDefinition {
  id: string;
  teamId: string;
  name: string;
  shortName: string;
  number: number;
  pace: number;
  consistency: number;
}

export interface TrackPoint {
  x: number;
  y: number;
}

export type SegmentKind = "STRAIGHT" | "FAST" | "MEDIUM" | "SLOW";

export interface TrackSegment {
  id: string;
  startDistance: number;
  endDistance: number;
  length: number;
  kind: SegmentKind;
  speedLimitKph: number;
  activeAeroAllowed: boolean;
  p1: TrackPoint;
  p2: TrackPoint;
}

export interface CircuitDefinition {
  id: string;
  name: string;
  country: string;
  lengthMeters: number;
  totalLaps: number;
  points: readonly TrackPoint[];
  segments: readonly TrackSegment[];
  cumulativeDistances: readonly number[];
}

export interface TyreSetState {
  id: string;
  compound: TyreCompound;
  status: TyreSetStatus;
  condition: number;
  lapsUsed: number;
}

/** Live tyre surface temperature for each wheel, in degrees Celsius. */
export interface TyreTemperatureState {
  frontLeft: number;
  frontRight: number;
  rearLeft: number;
  rearRight: number;
}

export interface PendingOvertake {
  opponentCarId: string;
  detectedAt: number;
  positionsGained: number;
}

export interface RaceCarState {
  carId: string;
  teamId: string;
  driverId: string;
  currentLap: number;
  currentSegment: number;
  segmentProgress: number;
  lapDistance: number;
  totalDistance: number;
  totalRaceTime: number;
  currentSpeed: number;
  reactionTime: number;
  gridPosition: number;
  racePosition: number;
  racingLineMode: RacingLineMode;
  trackLineOffset: number;
  gapToLeader: number;
  gapToCarAhead: number;
  gapToCarBehind: number;
  tyreCompound: TyreCompound;
  tyreAgeLaps: number;
  tyreLife: number;
  tyreTemperatures: TyreTemperatureState;
  tyreTemperature: number;
  tyreSets: readonly TyreSetState[];
  activeTyreSetId: string;
  scheduledPitTyreSetId: string | null;
  /** Live carbon-brake temperature at each corner, in degrees Celsius. */
  brakeTemperatures: TyreTemperatureState;
  brakeTemperature: number;
  /** Combined engine/turbo cooling-loop temperature, in degrees Celsius. */
  powerUnitTemperature: number;
  /** Gearbox oil/casing temperature, in degrees Celsius. */
  gearboxTemperature: number;
  /** Hybrid energy-store pack temperature, in degrees Celsius. */
  energyStoreTemperature: number;
  /** Driver-selectable cooling instruction. */
  coolingMode: CoolingMode;
  /** Front brake bias percentage. */
  brakeBiasPercent: number;
  /** Accumulated component stress, from 0 (fresh) to 100 (critical). */
  powerUnitStress: number;
  gearboxStress: number;
  energyStoreStress: number;
  brakeStress: number;
  /** Current speed loss imposed by thermal protection. */
  thermalDeratePercent: number;
  /** Estimated short-term retirement risk caused by heat stress. */
  thermalRiskPercent: number;
  fuelRemainingKg: number;
  paceMode: PaceMode;
  tyreMode: TyreMode;
  energyMode: EnergyMode;
  energyState: EnergyState;
  batteryPercent: number;
  activeAeroMode: ActiveAeroMode;
  overtakeEligible: boolean;
  overtakeActive: boolean;
  boostActive: boolean;
  battleStatus: BattleStatus;
  battleCarId: string | null;
  dirtyAirLoss: number;
  overtakes: number;
  lastOvertakeAt: number | null;
  /** Last counted pass time by opponent, used to reject timing-line rank jitter. */
  overtakeOpponentTimes: Readonly<Record<string, number>>;
  pendingOvertake: PendingOvertake | null;
  pitStatus: PitStatus;
  pitTimer: number;
  pitStopTargetSeconds: number;
  lastPitStopTime: number | null;
  pitStopIssue: PitStopIssue;
  pitStops: number;
  scheduledPitCompound: TyreCompound | null;
  usedTyreCompounds: readonly TyreCompound[];
  strategyIntent: StrategyIntent;
  strategyConfidence: number;
  incidentStatus: IncidentStatus;
  incidentTimer: number;
  damageLevel: number;
  retiredReason: string | null;
  vscDeltaSeconds: number;
  vscViolationSeconds: number;
  vscComplianceStatus: VscComplianceStatus;
  vscViolationCount: number;
  safetyCarQueuePosition: number | null;
  safetyCarGapToTargetMeters: number | null;
  currentSector: 1 | 2 | 3;
  currentLapTime: number;
  currentSectorTime: number;
  lapStartedAt: number;
  sectorStartedAt: number;
  sectorTimes: [number | null, number | null, number | null];
  lastLapTime: number | null;
  bestLapTime: number | null;
  lastLapSectorTimes: [number | null, number | null, number | null];
  finished: boolean;
  finishTime: number | null;
}

export interface RaceSnapshot {
  seed: number;
  tick: number;
  elapsedTime: number;
  status: RaceStatus;
  weather: WeatherState;
  raceControl: RaceControlStatus;
  raceControlTimer: number;
  yellowSector: 1 | 2 | 3 | null;
  safetyCarPhase: SafetyCarPhase;
  safetyCarPhaseElapsedSeconds: number;
  safetyCarDistance: number | null;
  safetyCarSpeed: number;
  safetyCarFieldBunched: boolean;
  safetyCarInPitLane: boolean;
  safetyCarRestartLineDistance: number | null;
  pitLaneOpen: boolean;
  pitLaneStatus: PitLaneProcedureStatus;
  activeIncident: ActiveIncident | null;
  events: readonly RaceEvent[];
  radioMessages: readonly RadioMessage[];
  cars: readonly RaceCarState[];
  checksum: string;
}

export type SimulationSpeed = 1 | 2 | 4 | 8 | 16;
