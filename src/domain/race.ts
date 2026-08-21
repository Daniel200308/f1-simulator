import type { EnergyMode, EnergySystemState } from "@/domain/energy";

export type RaceStatus = "READY" | "RUNNING" | "PAUSED" | "FINISHED";
export type PaceMode = "ATTACK" | "PUSH" | "STANDARD" | "CONSERVE" | "COOL";
export type TyreMode = "GRIP" | "BALANCED" | "SAVE" | "TEMPERATURE";
export type { EnergyDeploymentMode, EnergyMode, EnergySystemState, RechargeMode } from "@/domain/energy";
export type CoolingMode = "NORMAL" | "LIFT_AND_COAST" | "MAX_COOLING";
export type EnergyState = "NEUTRAL" | "HARVESTING" | "DEPLOYING" | "OVERTAKE" | "DEFENDING" | "CLIPPING";
export type ActiveAeroMode = "CORNER" | "STRAIGHT" | "PARTIAL";
export type BattleStatus = "CLEAR" | "ATTACKING" | "DEFENDING" | "SIDE_BY_SIDE";
export type RacingLineMode = "GRID" | "RACING" | "ATTACK" | "DEFEND";
export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type TyreSetStatus = "AVAILABLE" | "FITTED" | "RESERVED" | "USED";
export type WeekendTyreSetStatus = "NEW" | "USED" | "FITTED" | "RESERVED" | "UNAVAILABLE";
export type PitStopIssue = "NONE" | "SLOW_RELEASE" | "WHEEL_GUN" | "DOUBLE_STACK";
export type StrategyIntent = "HOLD" | "EXTEND" | "UNDERCUT" | "OVERCUT" | "WEATHER" | "CHEAP_STOP" | "TYRE_LIMIT";
export interface AiDecisionTrace {
  intent: string;
  objective: string;
  targetCarId: string | null;
  pitReason: string | null;
  plannedPitLap: number | null;
  reasons: readonly string[];
  confidence: number;
  decidedAt: number;
}

export interface RaceReliabilityInput {
  conditionPercent: number;
  failureRiskPercent: number;
  performanceDeratePercent: number;
  limitingComponent: string;
}
export type TeamOrderType = "NONE" | "HOLD_POSITION" | "SWAP_CARS";
export type PitStatus = "TRACK" | "PIT_ENTRY" | "PIT_LANE" | "PIT_STOP" | "PIT_EXIT";
export type WeatherCondition = "DRY" | "CLOUDY" | "LIGHT_RAIN" | "HEAVY_RAIN";
export type RaceControlStatus = "GREEN" | "YELLOW" | "VSC" | "SAFETY_CAR" | "RED_FLAG";
export type SafetyCarPhase = "NONE" | "DEPLOYED" | "BUNCHING" | "RESTART";
export type RedFlagPhase = "NONE" | "SUSPENDED" | "RESTART_FORMATION" | "RESTART_COUNTDOWN";
export type RedFlagRestartType = "STANDING" | "ROLLING";
export type VscComplianceStatus = "COMPLIANT" | "WARNING" | "VIOLATION";
export type PitLaneProcedureStatus = "OPEN" | "CLOSED";
export type IncidentStatus = "RUNNING" | "SPUN" | "DAMAGED" | "RETIRED";
/** Short-lived driver reactions that sit between normal pace and a full incident. */
export type DriverMoment = "NONE" | "LOW_GRIP" | "LOCK_UP" | "REAR_SNAP" | "SPRAY" | "SPIN_RECOVERY";
export type InfringementType =
  | "PIT_SPEEDING"
  | "UNSAFE_RELEASE"
  | "UNSAFE_CONDITION"
  | "CAUSING_COLLISION"
  | "FORCING_OFF_TRACK"
  | "MULTIPLE_DEFENSIVE_MOVES"
  | "MOVING_UNDER_BRAKING"
  | "DANGEROUS_REJOIN"
  | "GAINING_LASTING_ADVANTAGE"
  | "TRACK_LIMITS"
  | "SC_VSC_DELTA"
  | "SC_DELTA"
  | "SC_OVERTAKE"
  | "SC_MAX_GAP"
  | "VSC_OVERTAKE"
  | "JUMP_START"
  | "GRID_POSITION"
  | "YELLOW_FLAG"
  | "PIT_ENTRY_LINE"
  | "PIT_EXIT_LINE"
  | "PIT_EXIT_RED_LIGHT"
  | "CLOSED_PIT_ENTRY"
  | "UNNECESSARILY_SLOW"
  | "TYRE_RULE"
  | "IGNORING_BLUE_FLAGS";
export type InvestigationStatus = "NOTED" | "UNDER_INVESTIGATION" | "DECISION_PENDING" | "NO_FURTHER_ACTION" | "DECIDED";
export type StewardStrictness = "LENIENT" | "BALANCED" | "STRICT";
export type PenaltyType =
  | "WARNING"
  | "BLACK_AND_WHITE_FLAG"
  | "TIME_5"
  | "TIME_10"
  | "DRIVE_THROUGH"
  | "STOP_GO_10"
  | "GRID_DROP"
  | "REPRIMAND"
  | "DISQUALIFICATION"
  | "SUSPENSION";
export type PenaltyStatus = "PENDING" | "SERVING" | "SERVED" | "CONVERTED_TO_RACE_TIME" | "ESCALATED" | "EXPIRED";
export type PitServicePhase = "NONE" | "PENALTY_HOLD" | "TYRE_SERVICE" | "RELEASE_HOLD" | "DRIVE_THROUGH" | "STOP_GO_HOLD";
export type WeatherSector = 1 | 2 | 3;
export type WeekendTyreUsage = Readonly<Record<string, Partial<Record<TyreCompound, number>>>>;

/** A physical tyre set that persists from Q1 through race preparation. */
export interface WeekendTyreSet {
  id: string;
  compound: TyreCompound;
  driverId: string;
  status: WeekendTyreSetStatus;
  wearPercent: number;
  heatCycles: number;
  lapsCompleted: number;
  sessionHistory: readonly string[];
}

export type WeekendTyreInventory = Readonly<Record<string, readonly WeekendTyreSet[]>>;

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
  type: "INCIDENT" | "RACE_CONTROL" | "PIT" | "BATTLE" | "THERMAL" | "PENALTY";
  message: string;
  /** Explicit attribution for car-specific events; null/omitted means field-wide. */
  carId?: string | null;
  /** Track sector at the time Race Control issued the notice. */
  sector?: WeatherSector;
}

/** A permanent steward decision; unlike the rolling Race Control feed this survives to classification. */
export interface RacePenalty {
  id: string;
  incidentId: string | null;
  carId: string;
  teamId: string;
  driverId: string;
  infringement: InfringementType;
  type: PenaltyType;
  status: PenaltyStatus;
  /** Hold time at the pit box. DT/SG result conversions live in classificationSeconds. */
  seconds: number;
  classificationSeconds: number;
  reason: string;
  issuedAt: number;
  lapNumber: number;
  /** FIA B1.9.6(c): DT/SG must be served within no more than two line crossings. */
  serviceDeadlineCrossings: number | null;
  lineCrossingsAfterIssue: number;
  servedAt: number | null;
  serviceStartedAt: number | null;
  /** Human-readable evidence shown in the post-race steward sheet. */
  evidence: string;
}

/** Persistent incident dossier used by Race Control, stewards and the timing tower. */
export interface RaceInvestigation {
  id: string;
  incidentId: string;
  carId: string;
  teamId: string;
  driverId: string;
  infringement: InfringementType;
  status: InvestigationStatus;
  reason: string;
  evidence: string;
  severity: number;
  responsibility: number;
  notedAt: number;
  investigationAt: number;
  decisionDueAt: number;
  decidedAt: number | null;
  outcomePenaltyId: string | null;
  /** Fixed guideline result when telemetry gives an exact band; null means NFA. */
  recommendedPenalty?: PenaltyType | null;
  /** Structured, serialisable telemetry retained across worker snapshots/save files. */
  metrics?: Readonly<Record<string, number | string | boolean | null>>;
}

export interface PitSpeedingEvidenceState {
  active: boolean;
  confirmed: boolean;
  startedAt: number;
  entrySpeedKph: number;
  maximumSpeedKph: number;
  excessSpeedSumKph: number;
  sampleCount: number;
  durationSeconds: number;
  distanceMetres: number;
  limiterActive: boolean;
}

export interface TeamOrderState {
  type: TeamOrderType;
  issuedAt: number;
  /** Car ahead when the instruction was issued. */
  leadCarId: string | null;
  /** Car behind when the instruction was issued; this car is released for SWAP_CARS. */
  trailingCarId: string | null;
}

export interface ActiveIncident {
  carId: string;
  distanceMeters: number;
  cornerNumber: number;
  cornerName: string;
  sector: 1 | 2 | 3;
  status: Exclude<IncidentStatus, "RUNNING">;
  cause?: string;
}

/** One-lap wave-by allowance tracked through the Safety Car procedure. */
export interface SafetyCarWaveByState {
  carId: string;
  /** Distance at which Race Control actually released this car, not deployment. */
  startDistance: number;
  /** Moving absolute-distance target for rejoining at the back of the SC queue. */
  targetDistance: number;
  /** Number of laps down when the SC was deployed; one lap is recovered per wave-by. */
  lapsDown?: number;
  /** True only while this car is legally passing the queue and Safety Car. */
  active?: boolean;
  /** Confirms the car has physically crossed ahead of the SC on the track cycle. */
  passedSafetyCar?: boolean;
  completed: boolean;
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
}

export interface DriverDefinition {
  id: string;
  teamId: string;
  name: string;
  shortName: string;
  number: number;
  pace: number;
  consistency: number;
  risk: number;
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

export interface CircuitCorner {
  number: number;
  name: string;
  distanceMeters: number;
}

export interface CircuitStraightZone {
  id: string;
  label: string;
  startRatio: number;
  endRatio: number;
}

export interface CircuitOvertakeZone {
  detectionDistance: number;
  activationDistance: number;
  endDistance: number;
}

export interface CircuitPitLane {
  entryStart: number;
  limiterStart: number;
  boxDistance: number;
  exitEnd: number;
  boxFrontageMeters: number;
}

export interface CircuitDefinition {
  id: string;
  name: string;
  shortName: string;
  location: string;
  country: string;
  lengthMeters: number;
  totalLaps: number;
  turns: number;
  referenceLapSeconds: number;
  points: readonly TrackPoint[];
  segments: readonly TrackSegment[];
  cumulativeDistances: readonly number[];
  corners: readonly CircuitCorner[];
  sectorEnds: readonly [number, number];
  straightZones: readonly CircuitStraightZone[];
  overtakeZone: CircuitOvertakeZone;
  pitLane: CircuitPitLane;
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
  /** Circuit registry key copied onto the car for pure per-car calculations. */
  circuitId?: string;
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
  reliabilityConditionPercent?: number;
  reliabilityRiskPercent?: number;
  reliabilityDeratePercent?: number;
  reliabilityLimitingComponent?: string;
  /** Seed-stable race distance at which a projected component fault becomes terminal. */
  reliabilityFailureDistance?: number | null;
  reliabilityFailureComponent?: string | null;
  fuelRemainingKg: number;
  /** Setup-derived whole-lap performance multiplier carried in from practice. */
  setupPerformanceFactor: number;
  /** Small seed-stable event form; prevents identical finishing orders every race. */
  eventPerformanceFactor: number;
  paceMode: PaceMode;
  tyreMode: TyreMode;
  energyMode: EnergyMode;
  /** AI energy controller switch. Player cars also default to automatic deployment. */
  energyAutoEnabled?: boolean;
  energyState: EnergyState;
  /** Full 2026 electrical energy model. Optional only for legacy save migration. */
  energySystem?: EnergySystemState;
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
  /** Stable multi-sample evidence; avoids single-frame limiter false positives. */
  pitSpeedingEvidence?: PitSpeedingEvidenceState | null;
  /** Seeded AI limiter lapse remaining time. Stored so worker/save migration is deterministic. */
  pitLimiterFaultSeconds?: number;
  /** Total elapsed time from pit entry to pit exit for the active stop. */
  pitLaneTimer: number;
  pitTimer: number;
  pitStopTargetSeconds: number;
  /** Stationary tyre-change time from the most recently completed stop. */
  lastPitStopTime: number | null;
  /** Simulation clock when the tyre service completed, used for the completion signal. */
  lastPitStopCompletedAt?: number | null;
  /** Full pit-lane time from entry line to exit line for the most recently completed stop. */
  lastPitLaneTime: number | null;
  pitStopIssue: PitStopIssue;
  pitStops: number;
  scheduledPitCompound: TyreCompound | null;
  usedTyreCompounds: readonly TyreCompound[];
  strategyIntent: StrategyIntent;
  strategyConfidence: number;
  aiDecision?: AiDecisionTrace;
  incidentStatus: IncidentStatus;
  incidentTimer: number;
  /** Seed-stable, transient handling event used by pace, telemetry, and radio. */
  driverMoment?: DriverMoment;
  driverMomentTimer?: number;
  lastDriverMomentAt?: number | null;
  /** Simulation clock and direction drive the on-map incident animation. */
  incidentStartedAt?: number | null;
  incidentDirection?: -1 | 1;
  /** Cooldown prevents the same driver from repeatedly receiving incidents. */
  lastIncidentAt?: number | null;
  damageLevel: number;
  retiredReason: string | null;
  vscDeltaSeconds: number;
  vscViolationSeconds: number;
  vscComplianceStatus: VscComplianceStatus;
  vscViolationCount: number;
  /** Cumulative track-limit offences; the fourth offence triggers a sanction. */
  trackLimitsWarnings?: number;
  /** A faster, non-lapped car is approaching to lap this car. */
  blueFlagActive?: boolean;
  /** Continuous time spent under the current blue-flag instruction. */
  blueFlagSeconds?: number;
  /** Cumulative ignored blue-flag warnings for stewarding. */
  blueFlagWarnings?: number;
  /** Penalty currently being served through the pit-lane procedure. */
  penaltyServiceId?: string | null;
  penaltyServiceIds?: readonly string[];
  penaltyServiceType?: PenaltyType | null;
  pitServicePhase?: PitServicePhase;
  /** Time during which no work or touching of the car is permitted. */
  penaltyHoldSeconds?: number;
  penaltyHoldElapsedSeconds?: number;
  /** Actual tyre-work target and elapsed time, excluding any penalty hold. */
  pitTyreServiceTargetSeconds?: number;
  pitTyreServiceElapsedSeconds?: number;
  lastPenaltyHoldSeconds?: number;
  lastPenaltyServedAt?: number | null;
  /** Player/AI request to take a DT or SG at the next legal pit entry. */
  servePenaltyRequested?: boolean;
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
  /** Registry key for every distance, timing and rendering calculation. */
  circuitId: string;
  /** Team currently controlled by the human player. */
  playerTeamId: string;
  tick: number;
  elapsedTime: number;
  status: RaceStatus;
  weather: WeatherState;
  raceControl: RaceControlStatus;
  raceControlTimer: number;
  yellowSector: 1 | 2 | 3 | null;
  redFlagPhase?: RedFlagPhase;
  redFlagTimerSeconds?: number;
  redFlagRestartType?: RedFlagRestartType;
  redFlagOrder?: readonly string[];
  redFlagDeployments?: number;
  safetyCarPhase: SafetyCarPhase;
  safetyCarPhaseElapsedSeconds: number;
  safetyCarDistance: number | null;
  safetyCarSpeed: number;
  safetyCarFieldBunched: boolean;
  safetyCarInPitLane: boolean;
  /** Absolute track distance where the current Safety Car deployment began. */
  safetyCarDeploymentDistance: number | null;
  /** Planned number of Safety Car tours before the late-sector-three withdrawal. */
  safetyCarTargetLaps: 1 | 2;
  /** Absolute distance where SC ENDING begins in sector three. */
  safetyCarEndingStartDistance: number | null;
  /** Absolute late-sector-three distance where the Safety Car enters the pit lane. */
  safetyCarPitEntryDistance: number | null;
  safetyCarRestartLineDistance: number | null;
  /** FIA wave-by window on the lap before SC ENDING. */
  safetyCarLappedCarsMayOvertake: boolean;
  safetyCarWaveBy: readonly SafetyCarWaveByState[];
  /** Number of Safety Car deployments completed or currently active this race. */
  safetyCarDeployments: number;
  /** Seeded race distance at which the guaranteed single deployment becomes due. */
  scheduledSafetyCarDistance: number;
  pitLaneOpen: boolean;
  pitLaneStatus: PitLaneProcedureStatus;
  activeIncident: ActiveIncident | null;
  teamOrder: TeamOrderState;
  stewardStrictness: StewardStrictness;
  investigations: readonly RaceInvestigation[];
  /** Permanent steward decisions used by the official post-race classification. */
  penalties: readonly RacePenalty[];
  events: readonly RaceEvent[];
  radioMessages: readonly RadioMessage[];
  cars: readonly RaceCarState[];
  checksum: string;
}

export type SimulationSpeed = 1 | 2 | 4 | 8 | 16;
