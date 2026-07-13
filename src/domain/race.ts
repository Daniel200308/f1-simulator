export type RaceStatus = "READY" | "RUNNING" | "PAUSED" | "FINISHED";
export type PaceMode = "ATTACK" | "PUSH" | "STANDARD" | "CONSERVE" | "COOL";
export type TyreMode = "GRIP" | "BALANCED" | "SAVE" | "TEMPERATURE";
export type RacingLineMode = "GRID" | "RACING" | "ATTACK" | "DEFEND";
export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type PitStatus = "TRACK" | "PIT_ENTRY" | "PIT_LANE" | "PIT_STOP" | "PIT_EXIT";
export type WeatherCondition = "DRY" | "CLOUDY" | "LIGHT_RAIN" | "HEAVY_RAIN";
export type RaceControlStatus = "GREEN" | "YELLOW" | "VSC" | "SAFETY_CAR";
export type SafetyCarPhase = "NONE" | "DEPLOYED" | "BUNCHING" | "RESTART";
export type IncidentStatus = "RUNNING" | "SPUN" | "DAMAGED" | "RETIRED";

export interface RaceEvent {
  id: string;
  elapsedTime: number;
  type: "INCIDENT" | "RACE_CONTROL" | "PIT";
  message: string;
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
  tyreTemperature: number;
  brakeTemperature: number;
  fuelRemainingKg: number;
  paceMode: PaceMode;
  tyreMode: TyreMode;
  pitStatus: PitStatus;
  pitTimer: number;
  pitStops: number;
  scheduledPitCompound: TyreCompound | null;
  incidentStatus: IncidentStatus;
  incidentTimer: number;
  damageLevel: number;
  retiredReason: string | null;
  vscDeltaSeconds: number;
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
  pitLaneOpen: boolean;
  activeIncident: ActiveIncident | null;
  events: readonly RaceEvent[];
  radioMessages: readonly RadioMessage[];
  cars: readonly RaceCarState[];
  checksum: string;
}

export type SimulationSpeed = 1 | 2 | 4 | 8 | 16;
