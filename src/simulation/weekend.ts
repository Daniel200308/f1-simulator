import type { TyreCompound, TyreTemperatureState, WeekendTyreInventory } from "@/domain/race";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, DRIVERS, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { season2026PracticePenaltySeconds, season2026QualifyingPenaltySeconds, season2026QualifyingStrength } from "@/fixtures/season-2026-performance";
import { qualifyingErrorRisk } from "@/simulation/driver-risk";
import { PIT_BOX_DISTANCE, PIT_ENTRY_START, PIT_EXIT_END } from "@/simulation/engine";
import { buildSessionDriverMessage, buildSessionEngineerMessage } from "@/simulation/message-library";
import { hashNoise, signedNoise } from "@/simulation/random";
import {
  beginQualifyingLapTiming,
  createQualifyingDriverTimingState,
  createQualifyingSessionTimingState,
  finalizeQualifyingLapTiming,
  invalidateQualifyingLapTiming,
  isStrictlyFaster,
  recordProvisionalSector,
  SECTOR_TIME_TOLERANCE_SECONDS,
  type QualifyingDriverTimingState,
  type QualifyingSessionTimingState,
  type SectorToneTuple,
} from "@/simulation/sector-timing";
import { telemetrySpeedAtDistance } from "@/simulation/silverstone-telemetry";
import { pointAtDistance, segmentIndexAtDistance, SILVERSTONE_CIRCUIT, SILVERSTONE_SECTOR_ENDS } from "@/simulation/track";
import {
  completeWeekendTyreRun,
  createWeekendTyreInventory,
  FIA_2026_STANDARD_TYRE_ALLOCATION,
  fitWeekendTyreSet,
  reserveWeekendTyreSet,
  selectableWeekendTyreSets,
  weekendTyreSetById,
  weekendTyreUsageFromInventory,
} from "@/simulation/tyre-allocation";

export type PracticeSession = "FP1" | "FP2" | "FP3";
export type QualifyingSession = "Q1" | "Q2" | "Q3";
export type WeekendSession = PracticeSession | QualifyingSession | "RACE";

export interface CarSetup {
  frontWing: number;
  rearWing: number;
  suspension: number;
  rideHeight: number;
  differential: number;
  cooling: number;
}

export const CAR_SETUP_MINIMUM = -50;
export const CAR_SETUP_MAXIMUM = 50;

const CAR_SETUP_KEYS: readonly (keyof CarSetup)[] = [
  "frontWing",
  "rearWing",
  "suspension",
  "rideHeight",
  "differential",
  "cooling",
];

export interface SetupRecommendationRange {
  minimum: number;
  maximum: number;
  confidence: number;
  sourceSession: PracticeSession;
}

export interface SetupFeedback {
  area: "RUN" | "AERO" | "MECHANICAL" | "THERMAL";
  severity: "INFO" | "WATCH" | "GOOD";
  message: string;
}

export interface WeekendClassificationEntry {
  position: number;
  carId: string;
  bestLapSeconds: number;
  laps: number;
  compound: TyreCompound;
  gapSeconds: number;
  eliminated: boolean;
  timedLap?: boolean;
}

/*
 * An in-lap is a single phase. A car that still has a flying lap left recovers
 * on it and rejoins; a car that is finished takes the same lap to the pit
 * entry. The old COOL_DOWN phase modelled the first case only and duplicated
 * every traffic, yielding and telemetry rule that IN_LAP already had.
 */
export type QualifyingCarPhase = "GARAGE" | "OUT_LAP" | "PUSH_LAP" | "IN_LAP" | "ABORTED_LAP" | "PIT_ENTRY";
export type QualifyingOutLapMode = "SLOW" | "BALANCED" | "FAST";
export type QualifyingAttackMode = "SAFE" | "NORMAL" | "ATTACK" | "MAXIMUM";
export type QualifyingEnergyMode = "CHARGE" | "QUALI";
export type QualifyingTrafficLevel = "LOW" | "MEDIUM" | "HIGH";
export type QualifyingReleaseRequest = "NONE" | "WAIT_FOR_GAP" | "HOLD";
export type QualifyingTrafficResponse = "MAINTAIN_GAP" | "CREATE_GAP" | "LET_PASS" | "OVERTAKE_OUT_LAP";
export type QualifyingFuelPlan = "ONE_LAP" | "TWO_LAPS" | "TWO_LAPS_MARGIN";
export type QualifyingDisplayStatus = "GARAGE" | "OUT LAP" | "FLYING LAP" | "IN LAP" | "ABORTED LAP" | "PIT ENTRY" | "TRAFFIC" | "LAP DELETED";
export type QualifyingTrafficDecisionState = "NONE" | "YIELD" | "TRAFFIC" | "ABORTED";
export type QualifyingSessionStatus = "READY" | "RUNNING" | "CHECKERED";
export type QualifyingSimulationSpeed = 1 | 2 | 4 | 8 | 16;

export interface QualifyingCarState {
  carId: string;
  phase: QualifyingCarPhase;
  phaseRemainingSeconds: number;
  phaseDurationSeconds: number;
  selectedCompound: TyreCompound;
  selectedTyreSetId: string | null;
  fittedRunStartCompletedRuns: number;
  tyreTemperatures: TyreTemperatureState;
  tyreTemperatureC: number;
  tyreConditionPercent: number;
  currentSpeedKph: number;
  previousSpeedKph: number;
  energyPercent: number;
  outLapMode: QualifyingOutLapMode;
  attackMode: QualifyingAttackMode;
  energyMode: QualifyingEnergyMode;
  phaseStartProgress: number;
  /*
   * Set while a car is being held at the end of a phase (for example an out lap
   * waiting for a gap before starting its flying lap). Position is derived from
   * the elapsed phase fraction, so without this pin the extra waiting seconds
   * would recompute a smaller fraction and rewind the marker down the track.
   */
  phaseHoldProgress?: number;
  releaseRequest: QualifyingReleaseRequest;
  releaseRequestedAtSeconds: number | null;
  trafficResponse: QualifyingTrafficResponse;
  fuelPlan: QualifyingFuelPlan;
  fuelLoadKg: number;
  flyingLapsRemaining: number;
  trafficLevel: QualifyingTrafficLevel;
  gapAheadSeconds: number | null;
  gapBehindSeconds: number | null;
  yielding: boolean;
  yieldingToCarId: string | null;
  yieldingDurationSeconds: number;
  yieldCooldownSeconds: number;
  impedingInvestigation: boolean;
  flyingConflictSeconds: number;
  trafficConflictCarId: string | null;
  trafficConflictGapSeconds: number | null;
  trafficDecisionState: QualifyingTrafficDecisionState;
  trafficDecisionMessage: string | null;
  completedRuns: number;
  bestLapSeconds: number | null;
  lastLapSeconds: number | null;
  trafficPenaltySeconds: number;
  lastRunNote: "NO TIME" | "CLEAN" | "TOW" | "TRAFFIC" | "TRACK LIMITS" | "LOCK-UP" | "ABORTED";
  timing: QualifyingDriverTimingState;
  provisionalSectorTargets: readonly [number, number, number] | null;
  provisionalLapOutcome: QualifyingCarState["lastRunNote"] | null;
  provisionalTrafficAppliedSeconds: number;
}

export interface QualifyingReleaseForecast {
  trackCars: number;
  traffic: QualifyingTrafficLevel;
  expectedGapSeconds: number;
  nearestFlyingGapSeconds: number | null;
  targetGapSeconds: number;
  mergeSafe: boolean;
  flyingLapStartsInSeconds: number;
  flyingLapStartsAtSeconds: number;
  finishMarginSeconds: number;
  canFinishBeforeChequered: boolean;
}

export type QualifyingAiRunPriority = "BANKER" | "BUILD" | "AT_RISK" | "FINAL_ATTACK" | "COMPLETE";

export interface QualifyingAiRunPlan {
  priority: QualifyingAiRunPriority;
  position: number | null;
  cutPosition: number | null;
  marginToCutSeconds: number | null;
  targetRuns: number;
  preferFreshTyre: boolean;
  minimumReleaseGapSeconds: number;
  latestSafeReleaseInSeconds: number;
}

export interface LiveQualifyingState {
  session: QualifyingSession;
  status: QualifyingSessionStatus;
  elapsedSeconds: number;
  remainingSeconds: number;
  durationSeconds: number;
  speed: QualifyingSimulationSpeed;
  paused: boolean;
  trackEvolutionPercent: number;
  timing: QualifyingSessionTimingState;
  cars: Readonly<Record<string, QualifyingCarState>>;
}

export interface LiveQualifyingClassificationEntry {
  position: number;
  carId: string;
  bestLapSeconds: number | null;
  gapSeconds: number | null;
  phase: QualifyingCarPhase;
  eliminated: boolean;
}

export interface WeekendSessionResult {
  session: PracticeSession | QualifyingSession;
  durationMinutes: number;
  entries: readonly WeekendClassificationEntry[];
}

export interface WeekendCarReport {
  carId: string;
  position: number | null;
  bestLapSeconds: number | null;
  outcome: "COMPLETE" | "ADVANCED" | "ELIMINATED" | "NO RUN";
  aeroBalancePercent: number;
  mechanicalBalancePercent: number;
  thermalMarginPercent: number;
  tyreConditionPercent: number;
  energyRecoveryPercent: number;
  energyDeploymentPercent: number;
  energyProgramme: "RECOVERY MAP" | "RACE ENERGY" | "QUALIFYING DEPLOY";
  driverMessage: string;
  engineerMessage: string;
}

export interface WeekendSessionReport {
  session: PracticeSession | QualifyingSession;
  title: string;
  summary: string;
  cars: readonly WeekendCarReport[];
}

export interface QualifyingRecord {
  carId: string;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  eliminatedIn: QualifyingSession | null;
  finalPosition: number | null;
}

export interface WeekendState {
  seed: number;
  playerTeamId: string;
  currentSession: WeekendSession;
  completedSessions: readonly (PracticeSession | QualifyingSession)[];
  results: readonly WeekendSessionResult[];
  qualifying: readonly QualifyingRecord[];
  gridOrder: readonly string[];
  setups: Readonly<Record<string, CarSetup>>;
  lastRunSetups: Readonly<Record<string, CarSetup>>;
  setupKnowledge: number;
  tyreUsage: Readonly<Record<string, Partial<Record<TyreCompound, number>>>>;
  tyreInventory: WeekendTyreInventory;
  sessionReports: readonly WeekendSessionReport[];
  qualifyingLive: LiveQualifyingState | null;
}

export interface SessionRule {
  id: WeekendSession;
  group: "PRACTICE" | "QUALIFYING" | "RACE";
  durationMinutes: number | null;
  entrants: number;
  eliminated: number;
  breakBeforeMinutes: number;
}

// FIA 2026 Formula 1 Sporting Regulations, Section B, issue 07 (25 June 2026).
export const STANDARD_WEEKEND_RULES: readonly SessionRule[] = [
  { id: "FP1", group: "PRACTICE", durationMinutes: 60, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
  { id: "FP2", group: "PRACTICE", durationMinutes: 60, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
  { id: "FP3", group: "PRACTICE", durationMinutes: 60, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
  { id: "Q1", group: "QUALIFYING", durationMinutes: 18, entrants: 22, eliminated: 6, breakBeforeMinutes: 0 },
  { id: "Q2", group: "QUALIFYING", durationMinutes: 15, entrants: 16, eliminated: 6, breakBeforeMinutes: 7 },
  { id: "Q3", group: "QUALIFYING", durationMinutes: 13, entrants: 10, eliminated: 0, breakBeforeMinutes: 7 },
  { id: "RACE", group: "RACE", durationMinutes: null, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
] as const;

const SESSION_SEQUENCE: readonly WeekendSession[] = STANDARD_WEEKEND_RULES.map((rule) => rule.id);
const PRACTICE_COMPOUND: Record<PracticeSession, TyreCompound> = { FP1: "HARD", FP2: "MEDIUM", FP3: "SOFT" };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundMillis(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

function optimalSetupFor(seed: number, carId: string): CarSetup {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  const driverPreference = driverIndex % 2 === 0 ? -4 : 4;
  return {
    frontWing: clamp(12 + Math.round(signedNoise(seed, 701 + driverIndex, 13) * 15) + driverPreference, -35, 35),
    rearWing: clamp(5 + Math.round(signedNoise(seed, 704, driverIndex + 3) * 15) - driverPreference, -35, 35),
    suspension: clamp(-2 + Math.round(signedNoise(seed, 702 + driverIndex, 17) * 14) - driverPreference, -35, 35),
    rideHeight: clamp(-4 + Math.round(signedNoise(seed, 705, driverIndex + 7) * 13), -35, 35),
    differential: clamp(8 + Math.round(signedNoise(seed, 706, driverIndex + 11) * 15) + driverPreference, -35, 35),
    cooling: clamp(-5 + Math.round(signedNoise(seed, 703, driverIndex + 19) * 13), -35, 35),
  };
}

function initialSetupFor(seed: number, carId: string, playerTeamId: string): CarSetup {
  const driver = DRIVER_BY_ID.get(carId);
  if (driver?.teamId === playerTeamId) {
    const teamSlot = playerCarIdsFor(playerTeamId).indexOf(carId);
    return teamSlot === 0
      ? { frontWing: -8, rearWing: 6, suspension: 5, rideHeight: -4, differential: -5, cooling: -18 }
      : { frontWing: 6, rearWing: -4, suspension: -10, rideHeight: 7, differential: 15, cooling: 18 };
  }
  const target = optimalSetupFor(seed, carId);
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  return {
    frontWing: clamp(target.frontWing + Math.round(signedNoise(seed, driverIndex + 810, 1) * 7), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM),
    rearWing: clamp(target.rearWing + Math.round(signedNoise(seed, driverIndex + 810, 4) * 7), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM),
    suspension: clamp(target.suspension + Math.round(signedNoise(seed, driverIndex + 810, 2) * 7), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM),
    rideHeight: clamp(target.rideHeight + Math.round(signedNoise(seed, driverIndex + 810, 5) * 7), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM),
    differential: clamp(target.differential + Math.round(signedNoise(seed, driverIndex + 810, 6) * 7), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM),
    cooling: clamp(target.cooling + Math.round(signedNoise(seed, driverIndex + 810, 3) * 7), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM),
  };
}

function setupPenalty(setup: CarSetup, target: CarSetup): number {
  const normalizedDifference = (key: keyof CarSetup) => Math.abs(setup[key] - target[key]) / 10;
  return normalizedDifference("frontWing") * 0.12
    + normalizedDifference("rearWing") * 0.09
    + normalizedDifference("suspension") * 0.09
    + normalizedDifference("rideHeight") * 0.075
    + normalizedDifference("differential") * 0.08
    + normalizedDifference("cooling") * 0.06;
}

export function raceSetupPerformanceFactor(setup: CarSetup, seed = 20_260_712, carId = "ferrari-1"): number {
  return clamp(1 - setupPenalty(setup, optimalSetupFor(seed, carId)) * 0.008, 0.993, 1);
}

function setupFor(state: WeekendState, carId: string): CarSetup {
  return state.setups[carId] ?? initialSetupFor(state.seed, carId, state.playerTeamId);
}

/**
 * How much of a car's qualifying pace is decided by its practice weekend.
 * A well-executed FP programme leaves the car closer to its setup window; a
 * scrappy one leaves performance on the table. The window is deliberately
 * narrow: practice sharpens or blunts a car, it does not reorder the field.
 */
const PRACTICE_READINESS_MAX_GAIN_SECONDS = 0.1;
const PRACTICE_READINESS_MAX_LOSS_SECONDS = 0.14;

/**
 * Rates how well a car used practice, from 0 (nothing learned) to 1 (fully
 * dialled in).
 *
 * This deliberately measures *execution*, not pace. Practice classification is
 * derived from the same performance table as qualifying, so rewarding FP
 * position would amplify the existing hierarchy and let a strong car compound
 * its advantage. What practice actually buys is a setup closer to its optimum
 * and enough completed running to trust it, so those are the inputs.
 */
export function practiceReadinessFor(state: WeekendState, carId: string): number {
  const practiceResults = state.results.filter((result) => !result.session.startsWith("Q"));
  if (practiceResults.length === 0) return 0.5;

  // How close the car's setup sits to its own optimum window. A perfect setup
  // scores 1; roughly two clicks off on every axis scores 0.
  const setupConvergence = clamp(1 - setupPenalty(setupFor(state, carId), optimalSetupFor(state.seed, carId)) / 1.1, 0, 1);

  // Sessions actually completed. Skipping practice leaves the crew guessing.
  const sessionsRun = (["FP1", "FP2", "FP3"] as const)
    .filter((session) => practiceResults.some((result) => result.session === session
      && result.entries.some((entry) => entry.carId === carId && entry.laps > 0))).length;
  const programmeCompletion = sessionsRun / 3;

  // FP3 is the session run in qualifying trim, so completing it matters most.
  const fp3Complete = practiceResults.some((result) => result.session === "FP3"
    && result.entries.some((entry) => entry.carId === carId && entry.laps > 0));

  return clamp(setupConvergence * 0.6 + programmeCompletion * 0.28 + (fp3Complete ? 0.12 : 0), 0, 1);
}

/**
 * Converts practice readiness into a qualifying lap-time delta. Negative is
 * faster, so a strong practice weekend returns a gain.
 */
function practiceReadinessLapDelta(state: WeekendState, carId: string): number {
  const readiness = practiceReadinessFor(state, carId);
  // 0.5 readiness is neutral; above gains, below loses.
  return readiness >= 0.5
    ? -((readiness - 0.5) / 0.5) * PRACTICE_READINESS_MAX_GAIN_SECONDS
    : ((0.5 - readiness) / 0.5) * PRACTICE_READINESS_MAX_LOSS_SECONDS;
}

function driverLapTime(
  state: WeekendState,
  carId: string,
  session: PracticeSession | QualifyingSession,
  run: number,
): number {
  const driver = DRIVER_BY_ID.get(carId);
  const team = driver ? TEAM_BY_ID.get(driver.teamId) : undefined;
  if (!driver || !team) return 99;

  const sessionIndex = SESSION_SEQUENCE.indexOf(session);
  const qualifyingGain = session === "Q1" ? 0.8 : session === "Q2" ? 1.35 : session === "Q3" ? 1.72 : 0;
  const practiceGain = session === "FP1" ? -0.15 : session === "FP2" ? 0.3 : session === "FP3" ? 0.62 : 0;
  const performancePenalty = session.startsWith("Q")
    ? season2026QualifyingPenaltySeconds(carId, session as QualifyingSession)
    : season2026PracticePenaltySeconds(carId);
  // The supplied power table establishes the baseline; strategy, traffic and
  // mistakes may create an upset but cannot routinely erase the whole field.
  const performanceGain = 0.58 - performancePenalty;
  const setupLoss = setupPenalty(setupFor(state, carId), optimalSetupFor(state.seed, carId));
  // Practice only pays off in qualifying, where the setup window matters most.
  const practiceReadinessDelta = session.startsWith("Q") ? practiceReadinessLapDelta(state, carId) : 0;
  const evolution = state.completedSessions.length * 0.08;
  const variationWindow = session === "Q2" ? 0.13 : session === "Q3" ? 0.11 : 0.16;
  const variation = signedNoise(state.seed, DRIVERS.findIndex((candidate) => candidate.id === carId) + sessionIndex * 31, run + 17) * (variationWindow / driver.consistency);
  const base = 91.25 - performanceGain - practiceGain - qualifyingGain - evolution + setupLoss + practiceReadinessDelta + variation;
  return roundMillis(base);
}

function qualifyingAdvanceLimit(session: QualifyingSession): number | null {
  if (session === "Q1") return STANDARD_WEEKEND_RULES.find((rule) => rule.id === "Q2")?.entrants ?? 16;
  if (session === "Q2") return STANDARD_WEEKEND_RULES.find((rule) => rule.id === "Q3")?.entrants ?? 10;
  return null;
}

function hasValidQualifyingTime(entry: WeekendClassificationEntry): boolean {
  return entry.timedLap === true && Number.isFinite(entry.bestLapSeconds) && entry.bestLapSeconds > 0;
}

function qualifyingAdvancers(result: WeekendSessionResult | undefined, nextSession: "Q2" | "Q3"): readonly string[] {
  const requiredSession: QualifyingSession = nextSession === "Q2" ? "Q1" : "Q2";
  if (!result || result.session !== requiredSession) return [];
  const limit = STANDARD_WEEKEND_RULES.find((rule) => rule.id === nextSession)?.entrants ?? 0;
  return [...result.entries]
    .sort((a, b) => a.position - b.position || a.bestLapSeconds - b.bestLapSeconds)
    .filter((entry) => hasValidQualifyingTime(entry) && !entry.eliminated)
    .slice(0, limit)
    .map((entry) => entry.carId);
}

function latestQualifyingResult(state: WeekendState, session: QualifyingSession): WeekendSessionResult | undefined {
  for (let index = state.results.length - 1; index >= 0; index -= 1) {
    const result = state.results[index];
    if (result.session === session) return result;
  }
  return undefined;
}

function qualifyingEntrantsFor(state: WeekendState, session: QualifyingSession): readonly string[] {
  if (session === "Q1") return DRIVERS.map((driver) => driver.id);
  const previousSession: QualifyingSession = session === "Q2" ? "Q1" : "Q2";
  return qualifyingAdvancers(
    latestQualifyingResult(state, previousSession),
    session,
  );
}

function qualifyingDurationSeconds(session: QualifyingSession): number {
  return (STANDARD_WEEKEND_RULES.find((rule) => rule.id === session)?.durationMinutes ?? 0) * 60;
}

const QUALIFYING_BLANKET_TEMPERATURE_C = 82;
const QUALIFYING_MAX_TRAFFIC_LOSS_SECONDS = 1.65;
const QUALIFYING_MAX_SLIPSTREAM_GAIN_SECONDS = 0.12;

function uniformQualifyingTyreTemperatures(temperature: number): TyreTemperatureState {
  return { frontLeft: temperature, frontRight: temperature, rearLeft: temperature, rearRight: temperature };
}

function averageQualifyingTyreTemperature(temperatures: TyreTemperatureState): number {
  return (temperatures.frontLeft + temperatures.frontRight + temperatures.rearLeft + temperatures.rearRight) / 4;
}

function buildSilverstoneSectorTimeFractions(): readonly [number, number, number] {
  const sectorSeconds = [0, 0, 0];
  const sampleDistance = 20;
  for (let distance = 0; distance < SILVERSTONE_CIRCUIT.lengthMeters; distance += sampleDistance) {
    const midpoint = distance + sampleDistance / 2;
    const sectorIndex = midpoint < SILVERSTONE_SECTOR_ENDS[0] ? 0 : midpoint < SILVERSTONE_SECTOR_ENDS[1] ? 1 : 2;
    sectorSeconds[sectorIndex] += Math.min(sampleDistance, SILVERSTONE_CIRCUIT.lengthMeters - distance) / (telemetrySpeedAtDistance(midpoint) / 3.6);
  }
  const total = sectorSeconds.reduce((sum, value) => sum + value, 0);
  return [sectorSeconds[0] / total, sectorSeconds[1] / total, sectorSeconds[2] / total];
}

const SILVERSTONE_SECTOR_TIME_FRACTIONS = buildSilverstoneSectorTimeFractions();
const SILVERSTONE_SECTOR_COMPLETION_FRACTIONS = [
  SILVERSTONE_SECTOR_TIME_FRACTIONS[0],
  SILVERSTONE_SECTOR_TIME_FRACTIONS[0] + SILVERSTONE_SECTOR_TIME_FRACTIONS[1],
  1,
] as const;

// An out lap begins in the pit lane rather than at the timing line. Showing S3
// shortly before the phase changes leaves enough screen time for the complete
// non-competitive lap to be read before the flying-lap clock is reset.
const OUT_LAP_SECTOR_COMPLETION_FRACTIONS = [0.31, 0.66, 0.96] as const;

function qualifyingSectorTargets(
  state: WeekendState,
  car: QualifyingCarState,
  lapSeconds: number,
): readonly [number, number, number] {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === car.carId));
  const run = car.completedRuns;
  const firstBias = signedNoise(state.seed, 2_940 + driverIndex, run * 3 + 1) * 0.18;
  const secondBias = signedNoise(state.seed, 2_941 + driverIndex, run * 3 + 2) * 0.24;
  const sectorOne = roundMillis(lapSeconds * SILVERSTONE_SECTOR_TIME_FRACTIONS[0] + firstBias);
  const sectorTwo = roundMillis(lapSeconds * SILVERSTONE_SECTOR_TIME_FRACTIONS[1] + secondBias);
  const sectorThree = roundMillis(lapSeconds - sectorOne - sectorTwo);
  return [sectorOne, sectorTwo, sectorThree];
}

function qualifyingOutLapSectorTargets(
  state: WeekendState,
  car: QualifyingCarState,
  lapSeconds: number,
): readonly [number, number, number] {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === car.carId));
  const run = car.completedRuns;
  const firstBias = signedNoise(state.seed, 3_140 + driverIndex, run * 3 + 1) * 0.72;
  const secondBias = signedNoise(state.seed, 3_141 + driverIndex, run * 3 + 2) * 0.88;
  const sectorOne = roundMillis(lapSeconds * SILVERSTONE_SECTOR_TIME_FRACTIONS[0] + firstBias);
  const sectorTwo = roundMillis(lapSeconds * SILVERSTONE_SECTOR_TIME_FRACTIONS[1] + secondBias);
  const sectorThree = roundMillis(lapSeconds - sectorOne - sectorTwo);
  return [sectorOne, sectorTwo, sectorThree];
}

function updateQualifyingLapSectorTiming(
  car: QualifyingCarState,
  live: LiveQualifyingState,
  remainingSeconds: number,
  trafficPenaltySeconds: number,
  completionFractions: readonly [number, number, number] = SILVERSTONE_SECTOR_COMPLETION_FRACTIONS,
): QualifyingCarState {
  if (!car.provisionalSectorTargets) return car;
  const lapProgress = clamp(1 - remainingSeconds / Math.max(1, car.phaseDurationSeconds), 0, 1);
  let timing = car.timing;
  let trafficApplied = car.provisionalTrafficAppliedSeconds;
  for (let index = 0; index < 3; index += 1) {
    if (timing.currentSectorTimes[index] !== null || lapProgress + 0.000001 < completionFractions[index]) continue;
    // Traffic can contain a small straight-line tow as well as dirty-air loss.
    // Apply the signed delta at the next timing loop so the three provisional
    // sectors still add up to the exact final lap effect.
    const trafficDelta = trafficPenaltySeconds - trafficApplied;
    timing = recordProvisionalSector(
      timing,
      live.timing,
      index as 0 | 1 | 2,
      car.provisionalSectorTargets[index] + trafficDelta,
    );
    trafficApplied = trafficPenaltySeconds;
  }
  return {
    ...car,
    timing: {
      ...timing,
      currentLapTimeSeconds: roundMillis(Math.min(car.phaseDurationSeconds, car.phaseDurationSeconds - remainingSeconds)),
    },
    provisionalTrafficAppliedSeconds: trafficApplied,
  };
}

function reconcileLiveQualifyingSectorTones(
  cars: Readonly<Record<string, QualifyingCarState>>,
  sessionTiming: QualifyingSessionTimingState,
): Readonly<Record<string, QualifyingCarState>> {
  const effectiveBest = [...sessionTiming.bestSectorTimes] as [number | null, number | null, number | null];
  const effectiveHolder = [...sessionTiming.bestSectorDriverIds] as [string | null, string | null, string | null];
  for (const [carId, car] of Object.entries(cars)) {
    if (!car.timing.currentLapValid || !car.timing.currentLapCompetitive) continue;
    car.timing.currentSectorTimes.forEach((time, index) => {
      if (time !== null && isStrictlyFaster(time, effectiveBest[index])) {
        effectiveBest[index] = time;
        effectiveHolder[index] = carId;
      }
    });
  }

  return Object.fromEntries(Object.entries(cars).map(([carId, car]) => {
    const tones = car.timing.currentSectorTimes.map((time, index) => {
      if (time === null || !car.timing.currentLapCompetitive) return "NEUTRAL";
      if (!car.timing.currentLapValid) return "INVALID";
      if (effectiveHolder[index] === carId && effectiveBest[index] !== null && Math.abs(time - effectiveBest[index]!) <= SECTOR_TIME_TOLERANCE_SECONDS) return "PURPLE";
      const personalBest = car.timing.personalBestSectorTimes[index];
      if (personalBest === null || time <= personalBest + SECTOR_TIME_TOLERANCE_SECONDS) return "GREEN";
      return "YELLOW";
    }) as SectorToneTuple;
    return [carId, { ...car, timing: { ...car.timing, currentSectorTones: tones } }];
  }));
}

function initialQualifyingCar(carId: string): QualifyingCarState {
  return {
    carId,
    phase: "GARAGE",
    phaseRemainingSeconds: 0,
    phaseDurationSeconds: 0,
    selectedCompound: "SOFT",
    selectedTyreSetId: null,
    fittedRunStartCompletedRuns: 0,
    tyreTemperatures: uniformQualifyingTyreTemperatures(QUALIFYING_BLANKET_TEMPERATURE_C),
    tyreTemperatureC: QUALIFYING_BLANKET_TEMPERATURE_C,
    tyreConditionPercent: 100,
    currentSpeedKph: 0,
    previousSpeedKph: 0,
    energyPercent: 100,
    outLapMode: "BALANCED",
    attackMode: "NORMAL",
    energyMode: "CHARGE",
    phaseStartProgress: 0,
    releaseRequest: "HOLD",
    releaseRequestedAtSeconds: null,
    trafficResponse: "MAINTAIN_GAP",
    fuelPlan: "ONE_LAP",
    fuelLoadKg: 1.8,
    flyingLapsRemaining: 0,
    trafficLevel: "LOW",
    gapAheadSeconds: null,
    gapBehindSeconds: null,
    yielding: false,
    yieldingToCarId: null,
    yieldingDurationSeconds: 0,
    yieldCooldownSeconds: 0,
    impedingInvestigation: false,
    flyingConflictSeconds: 0,
    trafficConflictCarId: null,
    trafficConflictGapSeconds: null,
    trafficDecisionState: "NONE",
    trafficDecisionMessage: null,
    completedRuns: 0,
    bestLapSeconds: null,
    lastLapSeconds: null,
    trafficPenaltySeconds: 0,
    lastRunNote: "NO TIME",
    timing: createQualifyingDriverTimingState(),
    provisionalSectorTargets: null,
    provisionalLapOutcome: null,
    provisionalTrafficAppliedSeconds: 0,
  };
}

function prepareQualifyingSession(state: WeekendState, session: QualifyingSession): LiveQualifyingState {
  const entrants = qualifyingEntrantsFor(state, session);
  const durationSeconds = qualifyingDurationSeconds(session);
  return {
    session,
    status: "READY",
    elapsedSeconds: 0,
    remainingSeconds: durationSeconds,
    durationSeconds,
    speed: 1,
    paused: false,
    trackEvolutionPercent: 0,
    timing: createQualifyingSessionTimingState(),
    cars: Object.fromEntries(entrants.map((carId) => [carId, initialQualifyingCar(carId)])),
  };
}

function reconcileQualifyingEntrants(state: WeekendState, live: LiveQualifyingState): LiveQualifyingState {
  const entrantIds = qualifyingEntrantsFor(state, live.session);
  const currentIds = Object.keys(live.cars);
  const alreadyValid = entrantIds.length === currentIds.length
    && entrantIds.every((carId, index) => currentIds[index] === carId);
  if (alreadyValid) return live;
  return {
    ...live,
    cars: Object.fromEntries(entrantIds.map((carId) => [carId, live.cars[carId] ?? initialQualifyingCar(carId)])),
  };
}

function qualifyingPhaseProgress(car: QualifyingCarState): number {
  if (car.phaseHoldProgress !== undefined) return clamp(car.phaseHoldProgress, 0, 1);
  if (car.phaseDurationSeconds <= 0) return 0;
  return clamp(1 - car.phaseRemainingSeconds / car.phaseDurationSeconds, 0, 1);
}

const QUALIFYING_PIT_ENTRY_PROGRESS = PIT_ENTRY_START / SILVERSTONE_CIRCUIT.lengthMeters;
const QUALIFYING_FULL_IN_LAP_SECONDS = 69;
const QUALIFYING_PIT_ENTRY_SECONDS = 7;

function normalizeQualifyingProgress(value: number): number {
  return ((value % 1) + 1) % 1;
}

function forwardQualifyingProgress(from: number, to: number): number {
  return normalizeQualifyingProgress(to - from);
}

function startQualifyingReturn(
  car: QualifyingCarState,
  startProgress: number,
  lastRunNote: QualifyingCarState["lastRunNote"] = car.lastRunNote,
  resetCurrentTiming = false,
): QualifyingCarState {
  const normalizedStart = normalizeQualifyingProgress(startProgress);
  const distanceToPitEntry = forwardQualifyingProgress(normalizedStart, QUALIFYING_PIT_ENTRY_PROGRESS);
  const durationSeconds = Math.max(3, Math.round(distanceToPitEntry * QUALIFYING_FULL_IN_LAP_SECONDS));
  return {
    ...car,
    phase: lastRunNote === "ABORTED" ? "ABORTED_LAP" : "IN_LAP",
    // The car is committed to the pit lane, so it has no flying laps left to
    // run. This is also what distinguishes a returning in-lap from a recovery
    // in-lap, which keeps its remaining attempts.
    flyingLapsRemaining: 0,
    phaseDurationSeconds: durationSeconds,
    phaseRemainingSeconds: durationSeconds,
    phaseStartProgress: normalizedStart,
    lastRunNote,
    trafficPenaltySeconds: 0,
    yielding: false,
    yieldingToCarId: null,
    yieldingDurationSeconds: 0,
    yieldCooldownSeconds: 0,
    flyingConflictSeconds: 0,
    trafficConflictCarId: lastRunNote === "ABORTED" ? car.trafficConflictCarId : null,
    trafficConflictGapSeconds: lastRunNote === "ABORTED" ? car.trafficConflictGapSeconds : null,
    trafficDecisionState: lastRunNote === "ABORTED" ? "ABORTED" : "NONE",
    trafficDecisionMessage: lastRunNote === "ABORTED" ? "Traffic conflict — lap aborted" : null,
    energyMode: "CHARGE",
    timing: resetCurrentTiming ? beginQualifyingLapTiming(car.timing, false) : car.timing,
    provisionalSectorTargets: null,
    provisionalLapOutcome: lastRunNote === "ABORTED" ? "ABORTED" : null,
    provisionalTrafficAppliedSeconds: 0,
  };
}

/**
 * True while an in-lap is being used to recover between two flying laps. Such a
 * car stays on the racing line and will rejoin, so it keeps flying-lap traffic
 * duties; a returning in-lap is heading for the pit entry instead.
 */
export function isQualifyingRecoveryLap(car: QualifyingCarState): boolean {
  return car.phase === "IN_LAP" && car.flyingLapsRemaining > 0;
}

/** Baseline recovery-lap length before traffic spacing is applied. */
const QUALIFYING_RECOVERY_LAP_SECONDS = 64;
/** Recovery laps hold at least this gap to each other so they do not convoy. */
const QUALIFYING_RECOVERY_SPACING_SECONDS = 5;
/** A flying lap needs roughly this long, so a recovery lap may not eat into it. */
const QUALIFYING_FLYING_LAP_RESERVE_SECONDS = 96;
/**
 * A recovery lap must not rejoin the timing line inside this window of a car
 * that is already on a flying lap, otherwise it arrives in its path.
 */
const QUALIFYING_RECOVERY_FLYING_CLEARANCE_SECONDS = 5;

/**
 * Starts the recovery in-lap between two flying laps and lengthens it so the
 * car neither rejoins into a flying car's path nor bunches up with other
 * recovering cars. Extending the lap is the tool a real driver has here: the
 * lap is a cruise, so time is spent rather than pace.
 */
function beginQualifyingRecoveryLap(
  state: WeekendState,
  live: LiveQualifyingState,
  car: QualifyingCarState,
): QualifyingCarState {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === car.carId));
  const jitter = Math.round(hashNoise(state.seed, 2_540 + driverIndex, car.completedRuns) * 6);
  const baseDuration = QUALIFYING_RECOVERY_LAP_SECONDS + jitter;

  // The car may only be held out while a second attempt still fits. Deciding
  // the budget first means spacing can never cost the car its lap.
  const spacingBudgetSeconds = Math.max(
    0,
    live.remainingSeconds - QUALIFYING_FLYING_LAP_RESERVE_SECONDS - baseDuration,
  );
  if (spacingBudgetSeconds <= 0) {
    return {
      ...car,
      phase: "IN_LAP",
      phaseDurationSeconds: baseDuration,
      phaseRemainingSeconds: baseDuration,
      phaseStartProgress: 0,
      energyMode: "CHARGE",
    };
  }

  let durationSeconds = baseDuration;
  for (const other of Object.values(live.cars)) {
    if (other.carId === car.carId) continue;
    // Never rejoin into the path of a car that is already on a flying lap.
    if (other.phase === "PUSH_LAP") {
      const otherFinishesInSeconds = other.phaseRemainingSeconds;
      if (Math.abs(durationSeconds - otherFinishesInSeconds) < QUALIFYING_RECOVERY_FLYING_CLEARANCE_SECONDS) {
        durationSeconds = otherFinishesInSeconds + QUALIFYING_RECOVERY_FLYING_CLEARANCE_SECONDS;
      }
      continue;
    }
    // Space recovery laps against each other, and against out laps that would
    // start a flying lap at the same moment, so they do not form a convoy.
    const otherRejoinSeconds = isQualifyingRecoveryLap(other) || other.phase === "OUT_LAP"
      ? other.phaseRemainingSeconds
      : null;
    if (otherRejoinSeconds !== null && Math.abs(durationSeconds - otherRejoinSeconds) < QUALIFYING_RECOVERY_SPACING_SECONDS) {
      durationSeconds = otherRejoinSeconds + QUALIFYING_RECOVERY_SPACING_SECONDS;
    }
  }

  durationSeconds = clamp(Math.round(durationSeconds), baseDuration, Math.round(baseDuration + spacingBudgetSeconds));

  return {
    ...car,
    phase: "IN_LAP",
    phaseDurationSeconds: durationSeconds,
    phaseRemainingSeconds: durationSeconds,
    phaseStartProgress: 0,
    energyMode: "CHARGE",
  };
}

/**
 * Re-times an in-progress recovery lap so the car does not reach the timing
 * line alongside a flying car or another recovering car. Returns the number of
 * seconds the lap should still take.
 *
 * Only extension is allowed: a car may cruise for longer, but it cannot
 * conjure pace to arrive earlier. The clearance is applied inside the time the
 * session has left, so protecting the gap never costs the car its attempt.
 */
function recoveryLapRemainingSeconds(
  live: LiveQualifyingState,
  car: QualifyingCarState,
  remaining: number,
): number {
  if (remaining <= 0) return remaining;
  /*
   * The car may only wait inside the time that still leaves its own flying lap
   * intact. Holding it out past that point would trade a real attempt for a
   * cosmetic gap, which is a worse outcome than the gap itself.
   */
  const budget = live.remainingSeconds - QUALIFYING_FLYING_LAP_RESERVE_SECONDS - remaining;
  if (budget <= 0) return remaining;

  // Stable ordering keeps the resolution identical regardless of map order.
  const others = Object.values(live.cars)
    .filter((other) => other.carId !== car.carId)
    .sort((left, right) => left.phaseRemainingSeconds - right.phaseRemainingSeconds || left.carId.localeCompare(right.carId));
  const ceiling = remaining + budget;
  let adjusted = remaining;

  /*
   * Pushing the arrival back past one car can move it into another's window, so
   * the gap is resolved by repetition until it holds against every car. The
   * pass count is bounded because each pass only ever moves the arrival later
   * and the ceiling caps it.
   */
  /*
   * Both constraints push the arrival later, so they are resolved together and
   * repeated until nothing moves. Moving away from a flying car can land on
   * another recovery lap's slot and vice versa; iterating settles that.
   *
   * A flying car is cleared on whichever side this car would arrive, because it
   * owns the line. Between two recovery laps only the later one drops back:
   * matching a car that arrives *later* would drag this one forward onto its
   * slot, which is what locked pairs onto the same second.
   */
  for (let pass = 0; pass < others.length + 2; pass += 1) {
    let moved = false;
    for (const other of others) {
      const flying = other.phase === "PUSH_LAP";
      const clearance = flying
        ? QUALIFYING_RECOVERY_FLYING_CLEARANCE_SECONDS
        : isQualifyingRecoveryLap(other) || other.phase === "OUT_LAP"
          ? QUALIFYING_RECOVERY_SPACING_SECONDS
          : 0;
      if (clearance === 0) continue;
      if (Math.abs(adjusted - other.phaseRemainingSeconds) >= clearance) continue;
      /*
       * Ties and near-ties are broken by car id so both cars in a pair reach the
       * same verdict and exactly one of them moves. Without this the pair either
       * both hold (staying locked together) or both move (staying locked at a
       * new offset).
       */
      if (!flying) {
        const thisCarGivesWay = other.phaseRemainingSeconds < adjusted
          || (other.phaseRemainingSeconds === adjusted && other.carId.localeCompare(car.carId) < 0);
        if (!thisCarGivesWay) continue;
      }
      // Round up so a fractional adjustment cannot collapse back onto the same
      // whole second it was trying to escape.
      const separated = Math.ceil(other.phaseRemainingSeconds + clearance);
      if (separated <= adjusted || separated > ceiling) continue;
      adjusted = separated;
      moved = true;
    }
    if (!moved) break;
  }

  /*
   * Clearing a flying car can land exactly on another recovery lap's arrival,
   * because that constraint is allowed to move the car past a slot it would
   * otherwise have respected. One final sweep nudges the arrival off any
   * occupied second, which is the case that produced locked pairs.
   */
  const occupied = (candidate: number): boolean => others.some((other) =>
    (isQualifyingRecoveryLap(other) || other.phase === "OUT_LAP")
    && Math.abs(candidate - other.phaseRemainingSeconds) < QUALIFYING_RECOVERY_SPACING_SECONDS);
  for (let nudge = 0; nudge < others.length && occupied(adjusted); nudge += 1) {
    const next = adjusted + QUALIFYING_RECOVERY_SPACING_SECONDS;
    if (next > ceiling) break;
    adjusted = next;
  }

  return clamp(Math.round(adjusted), remaining, Math.round(ceiling));
}

function qualifyingOutLapDuration(state: WeekendState, car: QualifyingCarState): number {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === car.carId));
  const modeBase = car.outLapMode === "SLOW" ? 116 : car.outLapMode === "FAST" ? 99 : 107;
  return modeBase + Math.round(hashNoise(state.seed, 2_310 + driverIndex, car.completedRuns) * 5);
}

function qualifyingFuelPlanLaps(plan: QualifyingFuelPlan): number {
  return plan === "ONE_LAP" ? 1 : 2;
}

function qualifyingFuelLoadKg(plan: QualifyingFuelPlan): number {
  return plan === "ONE_LAP" ? 1.8 : plan === "TWO_LAPS" ? 3.55 : 4.2;
}

function qualifyingTrackProgress(car: QualifyingCarState): number | null {
  const progress = qualifyingPhaseProgress(car);
  if (car.phase === "GARAGE") return null;
  if (car.phase === "OUT_LAP") {
    if (progress < 0.12) return null;
    const trackProgress = (progress - 0.12) / 0.88;
    return clamp((PIT_EXIT_END + (SILVERSTONE_CIRCUIT.lengthMeters - PIT_EXIT_END) * trackProgress) / SILVERSTONE_CIRCUIT.lengthMeters, 0, 1);
  }
  if (car.phase === "PUSH_LAP") return progress;
  if (car.phase === "PIT_ENTRY") return null;
  // A recovery in-lap continues around to the timing line; a returning in-lap
  // runs only as far as the pit entry.
  if (isQualifyingRecoveryLap(car)) return clamp(car.phaseStartProgress + (1 - car.phaseStartProgress) * progress, 0, 1);
  const distanceToPitEntry = forwardQualifyingProgress(car.phaseStartProgress, QUALIFYING_PIT_ENTRY_PROGRESS);
  return normalizeQualifyingProgress(car.phaseStartProgress + distanceToPitEntry * progress);
}

function qualifyingDistanceForTelemetry(car: QualifyingCarState): { distanceMeters: number; pitLane: boolean } | null {
  const progress = qualifyingPhaseProgress(car);
  if (car.phase === "GARAGE") return null;
  if (car.phase === "OUT_LAP" && progress < 0.12) {
    return {
      distanceMeters: PIT_BOX_DISTANCE + (SILVERSTONE_CIRCUIT.lengthMeters + PIT_EXIT_END - PIT_BOX_DISTANCE) * (progress / 0.12),
      pitLane: true,
    };
  }
  if (car.phase === "PIT_ENTRY") {
    return {
      distanceMeters: PIT_ENTRY_START + (PIT_BOX_DISTANCE - PIT_ENTRY_START) * progress,
      pitLane: true,
    };
  }
  const trackProgress = qualifyingTrackProgress(car);
  return trackProgress === null ? null : { distanceMeters: trackProgress * SILVERSTONE_CIRCUIT.lengthMeters, pitLane: false };
}

function qualifyingSpeedTarget(car: QualifyingCarState): number {
  const telemetry = qualifyingDistanceForTelemetry(car);
  if (!telemetry) return 0;
  if (telemetry.pitLane) return 80;
  const reference = telemetrySpeedAtDistance(telemetry.distanceMeters);
  const normalPaceFactor = car.phase === "PUSH_LAP"
    ? car.attackMode === "SAFE" ? 0.985 : car.attackMode === "ATTACK" ? 1.008 : car.attackMode === "MAXIMUM" ? 1.014 : 1
    : car.phase === "OUT_LAP"
      ? car.outLapMode === "SLOW" ? 0.65 : car.outLapMode === "FAST" ? 0.78 : 0.71
      : isQualifyingRecoveryLap(car) ? 0.6
        : car.phase === "ABORTED_LAP" ? 0.54
          : car.phase === "PIT_ENTRY" ? 0.42 : 0.68;
  const paceFactor = car.yielding ? Math.min(normalPaceFactor, 0.52) : normalPaceFactor;
  const minimum = car.phase === "PUSH_LAP" ? 72 : 58;
  return clamp(reference * paceFactor, minimum, car.phase === "PUSH_LAP" ? 330 : 292);
}

function qualifyingCornerThermalLoad(distanceMeters: number): { intensity: number; hotterSide: "LEFT" | "RIGHT" | null } {
  const before = pointAtDistance(distanceMeters - 32);
  const centre = pointAtDistance(distanceMeters);
  const after = pointAtDistance(distanceMeters + 32);
  const incomingX = centre.x - before.x;
  const incomingY = centre.y - before.y;
  const outgoingX = after.x - centre.x;
  const outgoingY = after.y - centre.y;
  const signedAngle = Math.atan2(incomingX * outgoingY - incomingY * outgoingX, incomingX * outgoingX + incomingY * outgoingY);
  const intensity = clamp(Math.abs(signedAngle) / 0.24, 0, 1);
  return intensity < 0.025 ? { intensity: 0, hotterSide: null } : { intensity, hotterSide: signedAngle > 0 ? "LEFT" : "RIGHT" };
}

function advanceQualifyingTyreTemperatures(car: QualifyingCarState, nextSpeedKph: number): TyreTemperatureState {
  const telemetry = qualifyingDistanceForTelemetry(car);
  if (!telemetry) {
    const blend = 0.16;
    const blanket = QUALIFYING_BLANKET_TEMPERATURE_C;
    return {
      frontLeft: car.tyreTemperatures.frontLeft + (blanket - car.tyreTemperatures.frontLeft) * blend,
      frontRight: car.tyreTemperatures.frontRight + (blanket - car.tyreTemperatures.frontRight) * blend,
      rearLeft: car.tyreTemperatures.rearLeft + (blanket - car.tyreTemperatures.rearLeft) * blend,
      rearRight: car.tyreTemperatures.rearRight + (blanket - car.tyreTemperatures.rearRight) * blend,
    };
  }

  const segment = SILVERSTONE_CIRCUIT.segments[segmentIndexAtDistance(telemetry.distanceMeters)];
  const corner = qualifyingCornerThermalLoad(telemetry.distanceMeters);
  const brakingHeat = clamp(Math.max(0, car.currentSpeedKph - nextSpeedKph) * 0.038, 0, 9);
  const tractionHeat = clamp(Math.max(0, nextSpeedKph - car.currentSpeedKph) * 0.027, 0, 7);
  const speedHeat = clamp((nextSpeedKph - 170) * 0.024, -3.6, 4.2);
  const phaseTarget = car.phase === "PUSH_LAP"
    ? 101 + (car.attackMode === "MAXIMUM" ? 3 : car.attackMode === "ATTACK" ? 1.5 : car.attackMode === "SAFE" ? -2 : 0)
    : car.phase === "OUT_LAP"
      ? car.outLapMode === "FAST" ? 98 : car.outLapMode === "SLOW" ? 90 : 94
      : isQualifyingRecoveryLap(car) ? 79 : 76;
  const segmentOffset = segment.kind === "FAST" ? 2.4 : segment.kind === "MEDIUM" ? 1 : segment.kind === "SLOW" ? -0.6 : -2.4;
  const cornerHeat = corner.intensity * (3 + nextSpeedKph * 0.024);
  const leftOffset = corner.hotterSide === "LEFT" ? cornerHeat : corner.hotterSide === "RIGHT" ? -cornerHeat * 0.3 : 0;
  const rightOffset = corner.hotterSide === "RIGHT" ? cornerHeat : corner.hotterSide === "LEFT" ? -cornerHeat * 0.3 : 0;
  const baseTarget = phaseTarget + segmentOffset + speedHeat;
  const targets: TyreTemperatureState = {
    frontLeft: baseTarget + brakingHeat + tractionHeat * 0.2 + leftOffset + 0.9,
    frontRight: baseTarget + brakingHeat + tractionHeat * 0.2 + rightOffset + 0.35,
    rearLeft: baseTarget + brakingHeat * 0.32 + tractionHeat + leftOffset * 0.88 - 0.2,
    rearRight: baseTarget + brakingHeat * 0.32 + tractionHeat + rightOffset * 0.88 - 0.65,
  };
  const response = telemetry.pitLane ? 0.055 : car.phase === "PUSH_LAP" ? 0.15 : car.phase === "OUT_LAP" ? 0.12 : 0.105;
  const advance = (current: number, target: number) => clamp(current + (clamp(target, 58, 125) - current) * response, 58, 125);
  return {
    frontLeft: advance(car.tyreTemperatures.frontLeft, targets.frontLeft),
    frontRight: advance(car.tyreTemperatures.frontRight, targets.frontRight),
    rearLeft: advance(car.tyreTemperatures.rearLeft, targets.rearLeft),
    rearRight: advance(car.tyreTemperatures.rearRight, targets.rearRight),
  };
}

export interface QualifyingTrafficDecision {
  level: QualifyingTrafficLevel;
  gapAheadSeconds: number | null;
  gapBehindSeconds: number | null;
  yielding: boolean;
  yieldingToCarId: string | null;
  yieldingDurationSeconds: number;
  yieldCooldownSeconds: number;
  approachingFlyingGapSeconds: number | null;
  spacingFactor: number;
  flyingConflictCarId: string | null;
  flyingConflictGapSeconds: number | null;
}

const QUALIFYING_YIELD_APPROACH_SECONDS = 5.5;
const QUALIFYING_YIELD_SAFE_GAP_SECONDS = 2.7;
const QUALIFYING_YIELD_MAX_SECONDS = 22;

function distanceTimeGap(distanceMeters: number, speedKph: number): number {
  return distanceMeters / clamp(speedKph / 3.6, 55, 92);
}

export function qualifyingTrafficDecision(live: LiveQualifyingState, car: QualifyingCarState): QualifyingTrafficDecision {
  const progress = qualifyingTrackProgress(car);
  if (progress === null) {
    return {
      level: "LOW",
      gapAheadSeconds: null,
      gapBehindSeconds: null,
      yielding: false,
      yieldingToCarId: null,
      yieldingDurationSeconds: 0,
      yieldCooldownSeconds: Math.max(0, car.yieldCooldownSeconds - 1),
      approachingFlyingGapSeconds: null,
      spacingFactor: 1,
      flyingConflictCarId: null,
      flyingConflictGapSeconds: null,
    };
  }
  let gapAheadMeters = Number.POSITIVE_INFINITY;
  let gapBehindMeters = Number.POSITIVE_INFINITY;
  let nearestAhead: QualifyingCarState | null = null;
  let nearestBehind: QualifyingCarState | null = null;
  const flyingBehind: { car: QualifyingCarState; gapSeconds: number }[] = [];
  for (const other of Object.values(live.cars)) {
    if (other.carId === car.carId) continue;
    const otherProgress = qualifyingTrackProgress(other);
    if (otherProgress === null) continue;
    const ahead = ((otherProgress - progress + 1) % 1) * SILVERSTONE_CIRCUIT.lengthMeters;
    const behind = ((progress - otherProgress + 1) % 1) * SILVERSTONE_CIRCUIT.lengthMeters;
    if (ahead > 1 && ahead < gapAheadMeters) {
      gapAheadMeters = ahead;
      nearestAhead = other;
    }
    if (behind > 1 && behind < gapBehindMeters) {
      gapBehindMeters = behind;
      nearestBehind = other;
    }
    if (other.phase === "PUSH_LAP" && behind < SILVERSTONE_CIRCUIT.lengthMeters * 0.5) {
      flyingBehind.push({ car: other, gapSeconds: distanceTimeGap(behind, other.currentSpeedKph) });
    }
  }
  flyingBehind.sort((a, b) => a.gapSeconds - b.gapSeconds || a.car.carId.localeCompare(b.car.carId));
  const gapAheadSeconds = Number.isFinite(gapAheadMeters) ? distanceTimeGap(gapAheadMeters, car.currentSpeedKph) : null;
  const gapBehindSeconds = Number.isFinite(gapBehindMeters) ? distanceTimeGap(gapBehindMeters, nearestBehind?.currentSpeedKph ?? car.currentSpeedKph) : null;
  const onTrackCars = Object.values(live.cars).filter((candidate) => qualifyingTrackProgress(candidate) !== null).length;
  const blocked = car.phase === "PUSH_LAP" && gapAheadSeconds !== null && gapAheadSeconds < 2.8;
  const level: QualifyingTrafficLevel = blocked && gapAheadSeconds! < 1.25
    ? "HIGH"
    : blocked || onTrackCars >= 10 ? "MEDIUM" : "LOW";

  const eligibleToYield = car.phase === "OUT_LAP" || car.phase === "IN_LAP" || car.phase === "ABORTED_LAP";
  let yieldingToCarId: string | null = null;
  let yieldingDurationSeconds = 0;
  let yieldCooldownSeconds = Math.max(0, car.yieldCooldownSeconds - 1);
  let approachingFlyingGapSeconds: number | null = null;
  const currentTarget = car.yieldingToCarId ? live.cars[car.yieldingToCarId] : null;
  const currentTargetProgress = currentTarget ? qualifyingTrackProgress(currentTarget) : null;

  if (eligibleToYield && currentTarget?.phase === "PUSH_LAP" && currentTargetProgress !== null && car.yieldingDurationSeconds < QUALIFYING_YIELD_MAX_SECONDS) {
    const targetBehindMeters = normalizeQualifyingProgress(progress - currentTargetProgress) * SILVERSTONE_CIRCUIT.lengthMeters;
    const targetAheadMeters = normalizeQualifyingProgress(currentTargetProgress - progress) * SILVERSTONE_CIRCUIT.lengthMeters;
    const targetBehind = targetBehindMeters < SILVERSTONE_CIRCUIT.lengthMeters * 0.5;
    const targetGapSeconds = distanceTimeGap(targetBehind ? targetBehindMeters : targetAheadMeters, currentTarget.currentSpeedKph);
    const stillApproaching = targetBehind && targetGapSeconds <= QUALIFYING_YIELD_APPROACH_SECONDS + 1.5;
    const passedButNotClear = !targetBehind && targetGapSeconds < QUALIFYING_YIELD_SAFE_GAP_SECONDS;
    if (stillApproaching || passedButNotClear) {
      yieldingToCarId = currentTarget.carId;
      yieldingDurationSeconds = car.yieldingDurationSeconds + 1;
      approachingFlyingGapSeconds = targetGapSeconds;
      yieldCooldownSeconds = 0;
    }
  }

  if (!yieldingToCarId && eligibleToYield && live.status === "RUNNING" && car.yieldingToCarId === null && yieldCooldownSeconds === 0) {
    const approachThreshold = car.trafficResponse === "LET_PASS" ? 6.5 : QUALIFYING_YIELD_APPROACH_SECONDS;
    const nearestFlying = flyingBehind.find((candidate) => candidate.gapSeconds <= approachThreshold);
    if (nearestFlying) {
      yieldingToCarId = nearestFlying.car.carId;
      yieldingDurationSeconds = 1;
      approachingFlyingGapSeconds = nearestFlying.gapSeconds;
    }
  }

  if (car.yieldingToCarId && !yieldingToCarId) {
    yieldingDurationSeconds = 0;
    yieldCooldownSeconds = 5;
  }

  let spacingFactor = 1;
  if (gapAheadSeconds !== null && nearestAhead) {
    const prioritisedPass = car.phase === "PUSH_LAP" && nearestAhead.yieldingToCarId === car.carId;
    const flyingPriorityBlock = car.phase !== "PUSH_LAP" && nearestAhead.phase === "PUSH_LAP";
    if (flyingPriorityBlock && gapAheadSeconds <= 1) spacingFactor = 0.35;
    else if (flyingPriorityBlock && gapAheadSeconds < 2) spacingFactor = 0.55;
    else if (flyingPriorityBlock && gapAheadSeconds < 3) spacingFactor = 0.75;
    else if (!prioritisedPass && gapAheadSeconds < 0.2) spacingFactor = 0.55;
    else if (!prioritisedPass && gapAheadSeconds < 0.4) spacingFactor = 0.72;
    else if (!prioritisedPass && gapAheadSeconds < 0.75) spacingFactor = 0.86;
  }

  const flyingConflict = car.phase === "PUSH_LAP"
    && nearestAhead?.phase === "PUSH_LAP"
    && gapAheadSeconds !== null
    && gapAheadSeconds <= 1
    && nearestAhead.timing.currentLapValid
    && nearestAhead.lastRunNote !== "TRACK LIMITS";

  return {
    level,
    gapAheadSeconds,
    gapBehindSeconds,
    yielding: yieldingToCarId !== null,
    yieldingToCarId,
    yieldingDurationSeconds,
    yieldCooldownSeconds,
    approachingFlyingGapSeconds,
    spacingFactor,
    flyingConflictCarId: flyingConflict ? nearestAhead!.carId : null,
    flyingConflictGapSeconds: flyingConflict ? gapAheadSeconds : null,
  };
}

function qualifyingTargetGapSeconds(live: LiveQualifyingState): number {
  const remainingRatio = live.remainingSeconds / Math.max(1, live.durationSeconds);
  if (live.remainingSeconds <= 95) return 2;
  if (live.remainingSeconds <= 190) return 2.6;
  if (remainingRatio <= 0.3) return 2.75;
  return live.session === "Q3" ? 3.8 : 4.2;
}

function predictedPitExitGaps(live: LiveQualifyingState, outLapDurationSeconds: number): {
  nearestGapSeconds: number;
  nearestFlyingGapSeconds: number | null;
  mergeSafe: boolean;
} {
  const arrivalSeconds = outLapDurationSeconds * 0.12;
  const pitExitProgress = PIT_EXIT_END / SILVERSTONE_CIRCUIT.lengthMeters;
  let nearestTimeGap = 12;
  let nearestFlyingGap = Number.POSITIVE_INFINITY;
  let mergeSafe = true;
  for (const other of Object.values(live.cars)) {
    if (other.phase === "GARAGE") continue;
    const phaseProgress = qualifyingPhaseProgress(other);
    if (other.phase === "OUT_LAP" && phaseProgress < 0.12) {
      const otherExitSeconds = Math.max(0, (0.12 - phaseProgress) * other.phaseDurationSeconds);
      const pitExitGap = Math.abs(arrivalSeconds - otherExitSeconds);
      nearestTimeGap = Math.min(nearestTimeGap, pitExitGap);
      if (pitExitGap < 1.2) mergeSafe = false;
      continue;
    }

    // Cars can leave the pit exit several seconds apart yet converge at the
    // timing line because their preparation laps use different pace modes.
    // Compare the projected flying-lap start times before approving a release.
    const nextFlyingStartSeconds = other.phase === "OUT_LAP"
      ? other.phaseRemainingSeconds
      : isQualifyingRecoveryLap(other)
        ? other.phaseRemainingSeconds
        : null;
    if (nextFlyingStartSeconds !== null) {
      const startGapSeconds = Math.abs(outLapDurationSeconds - nextFlyingStartSeconds);
      nearestFlyingGap = Math.min(nearestFlyingGap, startGapSeconds);
      const protectedStartGap = live.remainingSeconds <= 95 ? 0.8 : live.remainingSeconds <= 190 ? 0.95 : 1.05;
      if (startGapSeconds < protectedStartGap) mergeSafe = false;
    }

    const progress = qualifyingTrackProgress(other);
    if (progress === null) continue;
    const projectedMeters = Math.max(52, other.currentSpeedKph / 3.6) * arrivalSeconds;
    const projectedProgress = (progress + projectedMeters / SILVERSTONE_CIRCUIT.lengthMeters) % 1;
    const aheadMeters = ((projectedProgress - pitExitProgress + 1) % 1) * SILVERSTONE_CIRCUIT.lengthMeters;
    const behindMeters = ((pitExitProgress - projectedProgress + 1) % 1) * SILVERSTONE_CIRCUIT.lengthMeters;
    const aheadGapSeconds = distanceTimeGap(aheadMeters, other.currentSpeedKph);
    const behindGapSeconds = distanceTimeGap(behindMeters, other.currentSpeedKph);
    nearestTimeGap = Math.min(nearestTimeGap, aheadGapSeconds, behindGapSeconds);
    if (Math.min(aheadGapSeconds, behindGapSeconds) < 0.8) mergeSafe = false;
    if (other.phase === "PUSH_LAP") {
      nearestFlyingGap = Math.min(nearestFlyingGap, aheadGapSeconds, behindGapSeconds);
      if (behindGapSeconds < 5.5 || aheadGapSeconds < 3) mergeSafe = false;
    }
  }
  return {
    nearestGapSeconds: clamp(nearestTimeGap, 0.2, 12),
    nearestFlyingGapSeconds: Number.isFinite(nearestFlyingGap) ? clamp(nearestFlyingGap, 0.2, 12) : null,
    mergeSafe,
  };
}

export function qualifyingReleaseForecast(state: WeekendState, carId: string): QualifyingReleaseForecast | null {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car) return null;
  const trackCars = Object.values(live.cars).filter((candidate) => candidate.phase !== "GARAGE").length;
  const outLapDuration = qualifyingOutLapDuration(state, car);
  const predictedGaps = trackCars === 0
    ? { nearestGapSeconds: 12, nearestFlyingGapSeconds: null, mergeSafe: true }
    : predictedPitExitGaps(live, outLapDuration);
  const expectedGapSeconds = predictedGaps.nearestGapSeconds;
  const targetGapSeconds = qualifyingTargetGapSeconds(live);
  const traffic: QualifyingTrafficLevel = expectedGapSeconds < targetGapSeconds * 0.56
    ? "HIGH"
    : expectedGapSeconds < targetGapSeconds ? "MEDIUM" : "LOW";
  const flyingLapStartsInSeconds = outLapDuration;
  const estimatedLap = clamp(driverLapTime(state, car.carId, live.session, car.completedRuns), 84, 96);
  const finishMarginSeconds = roundMillis(live.remainingSeconds - flyingLapStartsInSeconds - estimatedLap);
  return {
    trackCars,
    traffic,
    expectedGapSeconds: roundMillis(expectedGapSeconds),
    nearestFlyingGapSeconds: predictedGaps.nearestFlyingGapSeconds === null ? null : roundMillis(predictedGaps.nearestFlyingGapSeconds),
    targetGapSeconds,
    mergeSafe: predictedGaps.mergeSafe,
    flyingLapStartsInSeconds,
    flyingLapStartsAtSeconds: live.elapsedSeconds + flyingLapStartsInSeconds,
    finishMarginSeconds,
    canFinishBeforeChequered: finishMarginSeconds >= 0,
  };
}

function startQualifyingRun(state: WeekendState, car: QualifyingCarState, durationSeconds: number): QualifyingCarState {
  return {
    ...car,
    phase: "OUT_LAP",
    phaseDurationSeconds: durationSeconds,
    phaseRemainingSeconds: durationSeconds,
    phaseStartProgress: 0,
    energyMode: "CHARGE",
    tyreTemperatures: uniformQualifyingTyreTemperatures(QUALIFYING_BLANKET_TEMPERATURE_C),
    tyreTemperatureC: QUALIFYING_BLANKET_TEMPERATURE_C,
    currentSpeedKph: 0,
    previousSpeedKph: 0,
    trafficPenaltySeconds: 0,
    trafficLevel: "LOW",
    gapAheadSeconds: null,
    gapBehindSeconds: null,
    yielding: false,
    yieldingToCarId: null,
    yieldingDurationSeconds: 0,
    yieldCooldownSeconds: 0,
    fittedRunStartCompletedRuns: car.completedRuns,
    flyingConflictSeconds: 0,
    trafficConflictCarId: null,
    trafficConflictGapSeconds: null,
    trafficDecisionState: "NONE",
    trafficDecisionMessage: null,
    releaseRequest: "NONE",
    releaseRequestedAtSeconds: null,
    fuelLoadKg: qualifyingFuelLoadKg(car.fuelPlan),
    flyingLapsRemaining: qualifyingFuelPlanLaps(car.fuelPlan),
    lastRunNote: "NO TIME",
    timing: beginQualifyingLapTiming(car.timing, false),
    provisionalSectorTargets: qualifyingOutLapSectorTargets(state, car, durationSeconds),
    provisionalLapOutcome: null,
    provisionalTrafficAppliedSeconds: 0,
  };
}

function qualifyingAiRunPlanFor(state: WeekendState, live: LiveQualifyingState, car: QualifyingCarState): QualifyingAiRunPlan {
  const originalOrder = Object.keys(live.cars);
  const classified = Object.values(live.cars).sort((left, right) => {
    if (left.bestLapSeconds === null && right.bestLapSeconds === null) return originalOrder.indexOf(left.carId) - originalOrder.indexOf(right.carId);
    if (left.bestLapSeconds === null) return 1;
    if (right.bestLapSeconds === null) return -1;
    return left.bestLapSeconds - right.bestLapSeconds || originalOrder.indexOf(left.carId) - originalOrder.indexOf(right.carId);
  });
  const position = classified.findIndex((candidate) => candidate.carId === car.carId) + 1 || null;
  const cutPosition = qualifyingAdvanceLimit(live.session);
  const cutCar = cutPosition === null ? null : classified[cutPosition - 1] ?? null;
  const marginToCutSeconds = car.bestLapSeconds === null || cutCar?.bestLapSeconds === null || cutCar === null
    ? null
    : roundMillis(cutCar.bestLapSeconds - car.bestLapSeconds);
  const estimatedLapSeconds = clamp(driverLapTime(state, car.carId, live.session, car.completedRuns), 84, 96);
  const latestSafeReleaseInSeconds = Math.ceil(qualifyingOutLapDuration(state, car) + estimatedLapSeconds + 8);
  const finalWindow = live.remainingSeconds <= latestSafeReleaseInSeconds + 42;
  const belowCut = cutPosition !== null && position !== null && position > cutPosition;
  const vulnerable = car.bestLapSeconds === null || belowCut || (marginToCutSeconds !== null && marginToCutSeconds < 0.32);
  const comfortablySafe = car.bestLapSeconds !== null
    && cutPosition !== null
    && position !== null
    && position <= Math.max(1, cutPosition - 2)
    && marginToCutSeconds !== null
    && marginToCutSeconds >= 0.58;
  const driverIndex = Math.max(0, DRIVERS.findIndex((candidate) => candidate.id === car.carId));
  const extraRunSample = hashNoise(state.seed, 2_006 + driverIndex, SESSION_SEQUENCE.indexOf(live.session));
  const targetRuns = live.session === "Q3"
    ? 2
    : vulnerable && car.completedRuns > 0 && extraRunSample > 0.55 ? 3 : 2;
  const priority: QualifyingAiRunPriority = car.completedRuns >= targetRuns
    ? "COMPLETE"
    : finalWindow && vulnerable
      ? "FINAL_ATTACK"
      : car.bestLapSeconds === null
        ? "BANKER"
        : vulnerable
          ? "AT_RISK"
          : "BUILD";
  const baseGap = qualifyingTargetGapSeconds(live);
  const gapFactor = priority === "FINAL_ATTACK" ? 0.68 : priority === "AT_RISK" ? 0.82 : comfortablySafe ? 1.08 : 1;
  return {
    priority,
    position,
    cutPosition,
    marginToCutSeconds,
    targetRuns,
    preferFreshTyre: live.session !== "Q1" || priority === "AT_RISK" || priority === "FINAL_ATTACK" || car.completedRuns === 0,
    minimumReleaseGapSeconds: roundMillis(baseGap * gapFactor),
    latestSafeReleaseInSeconds,
  };
}

export function qualifyingAiRunPlan(state: WeekendState, carId: string): QualifyingAiRunPlan | null {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  return live && car ? qualifyingAiRunPlanFor(state, live, car) : null;
}

function aiReleaseTime(state: WeekendState, live: LiveQualifyingState, carId: string, run: number): number {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  const sessionIndex = SESSION_SEQUENCE.indexOf(live.session);
  const paceRank = season2026QualifyingStrength(carId);
  const runTarget = qualifyingAiRunPlanFor(state, live, live.cars[carId]).targetRuns;
  const windows = live.session === "Q1"
    ? runTarget === 3 ? [[28, 135], [390, 555], [770, 905]] : [[65, 205], [720, 910]]
    : live.session === "Q2" ? [[42, 190], [590, 735]] : [[28, 165], [480, 615]];
  const [start, end] = windows[Math.min(run, windows.length - 1)];
  const personalJitter = hashNoise(state.seed, 2_020 + driverIndex * 13, sessionIndex * 7 + run);
  const strategicBias = run === 0 ? paceRank * 34 : paceRank * 18;
  return Math.round(clamp(start + (end - start) * personalJitter + strategicBias, 0, live.durationSeconds - 150));
}

function aiCompoundFor(state: WeekendState, live: LiveQualifyingState, carId: string, run: number): TyreCompound {
  if (live.session !== "Q1" || run > 0) return "SOFT";
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  return hashNoise(state.seed, 2_090 + driverIndex, SESSION_SEQUENCE.indexOf(live.session)) > 0.76 ? "MEDIUM" : "SOFT";
}

function qualifyingLapFor(
  state: WeekendState,
  live: LiveQualifyingState,
  car: QualifyingCarState,
): { lapSeconds: number; note: QualifyingCarState["lastRunNote"] } {
  const baseline = driverLapTime(state, car.carId, live.session, car.completedRuns);
  const evolutionGain = (live.trackEvolutionPercent / 100) * 0.58;
  const compoundPenalty = car.selectedCompound === "SOFT" ? 0 : car.selectedCompound === "MEDIUM" ? 0.48 : 0.94;
  const temperaturePenalty = Math.abs(car.tyreTemperatureC - 94) * 0.018;
  const energyPenalty = Math.max(0, 78 - car.energyPercent) * 0.009;
  const fuelPenalty = Math.max(0, car.fuelLoadKg - 1.8) * 0.036;
  const attackAdjustment = car.attackMode === "SAFE" ? 0.34 : car.attackMode === "ATTACK" ? -0.16 : car.attackMode === "MAXIMUM" ? -0.28 : 0;
  const attackRisk = car.attackMode === "SAFE" ? 0.003 : car.attackMode === "ATTACK" ? 0.017 : car.attackMode === "MAXIMUM" ? 0.035 : 0.008;
  const driver = DRIVER_BY_ID.get(car.carId)!;
  const intrinsicRisk = qualifyingErrorRisk(driver.risk);
  const sampleIndex = live.elapsedSeconds + car.completedRuns * 17;
  const invalidationSample = hashNoise(state.seed, 2_260 + DRIVERS.findIndex((candidate) => candidate.id === car.carId), sampleIndex);
  const mistakeSample = hashNoise(state.seed, 2_420 + DRIVERS.findIndex((candidate) => candidate.id === car.carId), sampleIndex + 9);
  const invalidated = invalidationSample < attackRisk + intrinsicRisk * 0.35;
  const lockUp = !invalidated && mistakeSample < attackRisk * 0.72 + intrinsicRisk;
  const mistakePenalty = lockUp ? 0.65 + mistakeSample * 18 : 0;
  const lapSeconds = invalidated
    ? baseline + 4.5
    : baseline - evolutionGain + compoundPenalty + temperaturePenalty + energyPenalty + fuelPenalty + attackAdjustment + mistakePenalty + car.trafficPenaltySeconds;
  return {
    lapSeconds: roundMillis(lapSeconds),
    note: invalidated ? "TRACK LIMITS" : lockUp ? "LOCK-UP" : car.trafficPenaltySeconds <= -0.08 ? "TOW" : car.trafficPenaltySeconds >= 0.12 ? "TRAFFIC" : "CLEAN",
  };
}

function qualifyingTrafficLapDelta(car: QualifyingCarState, traffic: QualifyingTrafficDecision): number {
  if (car.phase !== "PUSH_LAP" || traffic.gapAheadSeconds === null || traffic.gapAheadSeconds >= 2.8) return 0;
  const telemetry = qualifyingDistanceForTelemetry(car);
  if (!telemetry || telemetry.pitLane) return 0;
  const segment = SILVERSTONE_CIRCUIT.segments[segmentIndexAtDistance(telemetry.distanceMeters)];
  const gap = traffic.gapAheadSeconds;

  if (gap <= 1) {
    // A sub-one-second tow helps on a straight, but the following car still
    // loses more through disturbed air and compromised corner approach. The
    // lap continues; the accumulated timing loss replaces the old auto-abort.
    const proximity = clamp(1 - gap, 0, 1);
    const load = segment.kind === "FAST" ? 1.25 : segment.kind === "MEDIUM" ? 1.1 : segment.kind === "SLOW" ? 0.94 : 0.72;
    const dirtyAirLoss = (0.11 + proximity * 0.14) * load;
    const towGain = segment.kind === "STRAIGHT" ? (0.01 + proximity * 0.007) : 0;
    return Math.max(0.07, dirtyAirLoss - towGain);
  }

  const proximity = clamp((2.8 - gap) / 1.8, 0, 1);
  const dirtyAirLoss = segment.kind === "FAST"
    ? 0.013 * proximity
    : segment.kind === "MEDIUM"
      ? 0.009 * proximity
      : segment.kind === "SLOW" ? 0.006 * proximity : 0.0015 * proximity;
  const towWindow = clamp(1 - Math.abs(gap - 1.65) / 0.85, 0, 1);
  const slipstreamGain = segment.kind === "STRAIGHT" ? 0.008 * towWindow : 0;
  return dirtyAirLoss - slipstreamGain;
}

function updateQualifyingCarOneSecond(
  state: WeekendState,
  live: LiveQualifyingState,
  car: QualifyingCarState,
): { car: QualifyingCarState; consumedCompound: TyreCompound | null; fittedTyreSetId?: string | null; sessionTiming?: QualifyingSessionTimingState } {
  const playerCar = playerCarIdsFor(state.playerTeamId).includes(car.carId);
  if (car.phase === "GARAGE") {
    const tyreTemperatures = advanceQualifyingTyreTemperatures(car, 0);
    const recovered = {
      ...car,
      tyreTemperatures,
      tyreTemperatureC: averageQualifyingTyreTemperature(tyreTemperatures),
      previousSpeedKph: car.currentSpeedKph,
      currentSpeedKph: 0,
      energyPercent: Math.min(100, car.energyPercent + 0.22),
    };
    const forecast = qualifyingReleaseForecast({ ...state, qualifyingLive: live }, car.carId);
    const waitedSeconds = car.releaseRequestedAtSeconds === null ? 0 : live.elapsedSeconds - car.releaseRequestedAtSeconds;
    const gapReady = Boolean(forecast?.mergeSafe && (
      forecast.expectedGapSeconds >= forecast.targetGapSeconds
      || (waitedSeconds >= 30 && forecast.expectedGapSeconds >= forecast.targetGapSeconds * 0.72)
      || live.remainingSeconds < 150
    ));
    const playerSelectedSet = weekendTyreSetById(state.tyreInventory, car.carId, recovered.selectedTyreSetId);
    if (playerCar && playerSelectedSet && (playerSelectedSet.status === "NEW" || playerSelectedSet.status === "USED") && car.releaseRequest === "WAIT_FOR_GAP" && live.status === "RUNNING" && forecast?.canFinishBeforeChequered && gapReady) {
      return { car: startQualifyingRun(state, recovered, qualifyingOutLapDuration(state, recovered)), consumedCompound: recovered.selectedCompound, fittedTyreSetId: playerSelectedSet.id };
    }
    const runPlan = qualifyingAiRunPlanFor(state, live, recovered);
    const releaseAt = aiReleaseTime(state, live, car.carId, car.completedRuns);
    const runTarget = runPlan.targetRuns;
    const enoughTime = Boolean(forecast?.canFinishBeforeChequered);
    const strategicWait = 7 + Math.round(hashNoise(state.seed, 2_037 + DRIVERS.findIndex((driver) => driver.id === car.carId), car.completedRuns) * 18);
    const trafficWindowOpen = Boolean(forecast?.mergeSafe && (
      forecast.expectedGapSeconds >= runPlan.minimumReleaseGapSeconds
      || (live.elapsedSeconds >= releaseAt + strategicWait && forecast.expectedGapSeconds >= runPlan.minimumReleaseGapSeconds * 0.86)
      || (runPlan.priority === "FINAL_ATTACK" && forecast.expectedGapSeconds >= runPlan.minimumReleaseGapSeconds * 0.84)
    ));
    const pitExitProtection = 0.12;
    const pitExitBusy = Object.values(live.cars).some((candidate) => candidate.carId !== car.carId
      && candidate.phase === "OUT_LAP"
      && qualifyingPhaseProgress(candidate) < pitExitProtection);
    const releaseWindowReached = live.elapsedSeconds >= releaseAt
      || (runPlan.priority === "FINAL_ATTACK" && live.remainingSeconds <= runPlan.latestSafeReleaseInSeconds + 32);
    if (!playerCar && live.status === "RUNNING" && car.completedRuns < runTarget && enoughTime && releaseWindowReached && trafficWindowOpen && !pitExitBusy) {
      const preferredCompound = aiCompoundFor(state, live, car.carId, car.completedRuns);
      const preferredSets = selectableWeekendTyreSets(state.tyreInventory, car.carId, preferredCompound);
      const selectedSet = runPlan.preferFreshTyre
        ? preferredSets.find((set) => set.status === "NEW") ?? preferredSets[0] ?? selectableWeekendTyreSets(state.tyreInventory, car.carId)[0]
        : preferredSets.find((set) => set.status === "USED" && set.wearPercent <= 18) ?? preferredSets.find((set) => set.status === "NEW") ?? preferredSets[0] ?? selectableWeekendTyreSets(state.tyreInventory, car.carId)[0];
      if (!selectedSet) return { car: recovered, consumedCompound: null };
      const selectedCompound = selectedSet.compound;
      const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === car.carId));
      const outLapMode: QualifyingOutLapMode = hashNoise(state.seed, 2_130 + driverIndex, car.completedRuns) > 0.76 ? "FAST" : hashNoise(state.seed, 2_131 + driverIndex, car.completedRuns) < 0.16 ? "SLOW" : "BALANCED";
      const attackSample = hashNoise(state.seed, 2_132 + driverIndex, car.completedRuns);
      const attackMode: QualifyingAttackMode = runPlan.priority === "FINAL_ATTACK"
        ? attackSample > 0.58 ? "MAXIMUM" : "ATTACK"
        : runPlan.priority === "AT_RISK" || live.session === "Q3" || car.completedRuns > 0
          ? "ATTACK"
          : attackSample > 0.9 ? "ATTACK" : "NORMAL";
      const fuelPlan: QualifyingFuelPlan = live.session === "Q3"
        ? "ONE_LAP"
        : hashNoise(state.seed, 2_133 + driverIndex, car.completedRuns) > 0.6 ? "TWO_LAPS" : "ONE_LAP";
      const prepared = {
        ...recovered,
        selectedCompound,
        selectedTyreSetId: selectedSet.id,
        tyreConditionPercent: 100 - selectedSet.wearPercent,
        outLapMode,
        attackMode,
        fuelPlan,
      };
      return { car: startQualifyingRun(state, prepared, qualifyingOutLapDuration(state, prepared)), consumedCompound: selectedCompound, fittedTyreSetId: selectedSet.id };
    }
    return { car: recovered, consumedCompound: null };
  }

  const traffic = qualifyingTrafficDecision(live, car);
  const targetGapSeconds = qualifyingTargetGapSeconds(live);
  const aiCreatingGap = !playerCar
    && car.phase === "OUT_LAP"
    && qualifyingPhaseProgress(car) > 0.58
    && traffic.gapAheadSeconds !== null
    && traffic.gapAheadSeconds < targetGapSeconds
    && live.remainingSeconds > 95;
  const trafficResponseStep = car.trafficResponse === "CREATE_GAP" && car.phase !== "PUSH_LAP"
    ? 0.68
    : car.trafficResponse === "LET_PASS" && traffic.gapBehindSeconds !== null && traffic.gapBehindSeconds < 3.5
      ? 0.42
      : car.trafficResponse === "OVERTAKE_OUT_LAP" && car.phase === "OUT_LAP" ? 1 : 1;
  const automaticGapStep = aiCreatingGap
    ? clamp((traffic.gapAheadSeconds ?? targetGapSeconds) / targetGapSeconds, 0.34, 0.72)
    : 1;
  const phaseStep = traffic.yielding
    ? Math.min(0.48, trafficResponseStep, automaticGapStep, traffic.spacingFactor)
    : Math.min(trafficResponseStep, automaticGapStep, traffic.spacingFactor);
  const remaining = Math.max(0, car.phaseRemainingSeconds - phaseStep);
  const investigationSample = hashNoise(state.seed, 2_730 + DRIVERS.findIndex((driver) => driver.id === car.carId), live.elapsedSeconds + car.completedRuns * 31);
  const impedingInvestigation = car.impedingInvestigation || Boolean(traffic.yielding && traffic.approachingFlyingGapSeconds !== null && traffic.approachingFlyingGapSeconds < 0.48 && investigationSample < 0.012);
  const trafficState = {
    trafficLevel: traffic.level,
    gapAheadSeconds: traffic.gapAheadSeconds,
    gapBehindSeconds: traffic.gapBehindSeconds,
    yielding: traffic.yielding,
    yieldingToCarId: traffic.yieldingToCarId,
    yieldingDurationSeconds: traffic.yieldingDurationSeconds,
    yieldCooldownSeconds: traffic.yieldCooldownSeconds,
    impedingInvestigation,
    flyingConflictSeconds: traffic.flyingConflictCarId ? car.flyingConflictSeconds + 1 : 0,
    trafficConflictCarId: car.phase === "ABORTED_LAP" ? car.trafficConflictCarId : traffic.flyingConflictCarId,
    trafficConflictGapSeconds: car.phase === "ABORTED_LAP" ? car.trafficConflictGapSeconds : traffic.flyingConflictGapSeconds,
    trafficDecisionState: car.phase === "ABORTED_LAP" ? "ABORTED" as const : traffic.yielding ? "YIELD" as const : traffic.flyingConflictCarId ? "TRAFFIC" as const : "NONE" as const,
    trafficDecisionMessage: car.phase === "ABORTED_LAP" ? car.trafficDecisionMessage : traffic.yielding
      ? `Yielding to ${DRIVER_BY_ID.get(traffic.yieldingToCarId ?? "")?.shortName ?? "flying car"}`
      : traffic.flyingConflictGapSeconds !== null ? `Traffic conflict · gap ${traffic.flyingConflictGapSeconds.toFixed(1)}s` : null,
  };
  const speedTarget = qualifyingSpeedTarget({ ...car, ...trafficState, phaseRemainingSeconds: remaining });
  const speedResponse = speedTarget < car.currentSpeedKph ? (traffic.yielding ? 0.24 : 0.76) : (car.yielding ? 0.22 : 0.4);
  const currentSpeedKph = clamp(car.currentSpeedKph + (speedTarget - car.currentSpeedKph) * speedResponse, 0, 335);
  const tyreTemperatures = advanceQualifyingTyreTemperatures({ ...car, phaseRemainingSeconds: remaining }, currentSpeedKph);
  const telemetryState = {
    previousSpeedKph: car.currentSpeedKph,
    currentSpeedKph,
    tyreTemperatures,
    tyreTemperatureC: averageQualifyingTyreTemperature(tyreTemperatures),
  };
  if (car.phase === "OUT_LAP") {
    const energyChange = car.outLapMode === "FAST" ? 0.08 : car.outLapMode === "SLOW" ? 0.24 : 0.16;
    const warmed = updateQualifyingLapSectorTiming({
      ...car,
      ...trafficState,
      ...telemetryState,
      phaseRemainingSeconds: remaining,
      /*
       * Once a hold is applied it stays until the phase changes: the car is
       * parked at the end of its preparation lap waiting for a gap, so its
       * marker must not drift while it waits.
       */
      phaseHoldProgress: car.phaseHoldProgress,
      energyPercent: clamp(car.energyPercent + energyChange, 0, 100),
      energyMode: "CHARGE" as const,
    }, live, remaining, 0, OUT_LAP_SECTOR_COMPLETION_FRACTIONS);
    if (remaining > 0) return { car: warmed, consumedCompound: null };
    /*
     * Hold the car for one more second of running before it starts the flying
     * lap. `phaseHoldProgress` pins the marker at the point already reached, so
     * the extra second does not rewind the elapsed phase fraction and slide the
     * car backwards down the lap.
     */
    const holdAtLine = () => ({
      car: {
        ...warmed,
        phaseRemainingSeconds: 1,
        /*
         * The lap has run its full length by the time a hold is applied, so the
         * marker is pinned as close to the phase end as it can get without
         * reaching exactly 1, which would wrap the normalised track position back
         * to the start line. The pin also has to sit at or ahead of the fraction
         * the lap already reached, or the marker would step back by a hair. An
         * existing pin is preserved so repeated held seconds cannot drift.
         */
        phaseHoldProgress: car.phaseHoldProgress ?? 0.99995,
      },
      consumedCompound: null,
    });
    if (warmed.yielding && live.status === "RUNNING") return holdAtLine();
    if (!playerCar
      && traffic.gapAheadSeconds !== null
      && traffic.gapAheadSeconds < targetGapSeconds * 0.82
      && live.remainingSeconds > 95) {
      return holdAtLine();
    }
    if (live.status === "CHECKERED") {
      return { car: startQualifyingReturn(warmed, 0), consumedCompound: null };
    }
    const projectedLap = qualifyingLapFor(state, live, warmed);
    const provisionalSectorTargets = qualifyingSectorTargets(state, warmed, projectedLap.lapSeconds);
    const pushDuration = clamp(projectedLap.lapSeconds, 84, 96);
    return {
      car: {
        ...warmed,
        phase: "PUSH_LAP",
        phaseDurationSeconds: pushDuration,
        phaseRemainingSeconds: pushDuration,
        phaseStartProgress: 0,
        energyMode: "QUALI",
        yielding: false,
        yieldingToCarId: null,
        yieldingDurationSeconds: 0,
        yieldCooldownSeconds: 0,
        trafficPenaltySeconds: 0,
        timing: beginQualifyingLapTiming(warmed.timing, true),
        provisionalSectorTargets,
        provisionalLapOutcome: projectedLap.note,
        provisionalTrafficAppliedSeconds: 0,
      },
      consumedCompound: null,
    };
  }

  if (car.phase === "PUSH_LAP") {
    const trafficDelta = qualifyingTrafficLapDelta(car, traffic);
    const deployRate = car.attackMode === "SAFE" ? 0.22 : car.attackMode === "ATTACK" ? 0.34 : car.attackMode === "MAXIMUM" ? 0.4 : 0.28;
    const nextTrafficPenalty = roundMillis(Math.min(
      QUALIFYING_MAX_TRAFFIC_LOSS_SECONDS,
      Math.max(-QUALIFYING_MAX_SLIPSTREAM_GAIN_SECONDS, car.trafficPenaltySeconds + trafficDelta),
    ));
    const pushing = updateQualifyingLapSectorTiming({
      ...car,
      ...trafficState,
      ...telemetryState,
      phaseRemainingSeconds: remaining,
      energyPercent: clamp(car.energyPercent - deployRate, 0, 100),
      energyMode: "QUALI" as const,
      trafficPenaltySeconds: nextTrafficPenalty,
    }, live, remaining, nextTrafficPenalty);
    if (remaining > 0) return { car: pushing, consumedCompound: null };
    const provisionalNote = pushing.provisionalLapOutcome ?? qualifyingLapFor(state, live, pushing).note;
    const note = provisionalNote === "TRACK LIMITS" || provisionalNote === "LOCK-UP"
      ? provisionalNote
      : pushing.trafficPenaltySeconds >= 0.12 ? "TRAFFIC" : provisionalNote;
    const validLap = note !== "TRACK LIMITS";
    const timingBeforeFinal = validLap ? pushing.timing : invalidateQualifyingLapTiming(pushing.timing);
    const sectorLapSeconds = roundMillis(timingBeforeFinal.currentSectorTimes.reduce((sum: number, time) => sum + (time ?? 0), 0));
    const finalized = finalizeQualifyingLapTiming(pushing.carId, timingBeforeFinal, live.timing, sectorLapSeconds);
    const flyingLapsRemaining = Math.max(0, car.flyingLapsRemaining - 1);
    const completedLap = {
      ...pushing,
      tyreConditionPercent: clamp(car.tyreConditionPercent - (car.selectedCompound === "SOFT" ? 6.5 : 4.5) * (car.attackMode === "MAXIMUM" ? 1.18 : car.attackMode === "SAFE" ? 0.82 : 1), 0, 100),
      completedRuns: car.completedRuns + 1,
      flyingLapsRemaining,
      fuelLoadKg: Math.max(0.65, car.fuelLoadKg - 1.55),
      lastLapSeconds: sectorLapSeconds,
      bestLapSeconds: finalized.driverTiming.personalBestLapTimeSeconds,
      lastRunNote: note,
      timing: finalized.driverTiming,
    };
    return {
      car: flyingLapsRemaining > 0 && live.status === "RUNNING"
        ? beginQualifyingRecoveryLap(state, live, completedLap)
        : startQualifyingReturn(completedLap, 0),
      consumedCompound: null,
      sessionTiming: finalized.sessionTiming,
    };
  }

  if (isQualifyingRecoveryLap(car)) {
    /*
     * A recovery lap is re-timed every second, not just when it starts. Flying
     * laps begin and end while this car is circulating, so a one-off estimate
     * goes stale immediately. Stretching the lap is what a driver does here:
     * the lap is a cruise, so waiting costs nothing but time.
     */
    const adjustedRemaining = recoveryLapRemainingSeconds(live, car, remaining);
    /*
     * Position is derived from `phaseStartProgress` plus elapsed phase fraction,
     * so simply extending the clock would recompute a *smaller* fraction and
     * teleport the marker backwards. Re-anchor the phase at the distance already
     * covered instead: the car keeps its place on track and spends the extra
     * time covering what is left.
     */
    const stretched = adjustedRemaining > remaining;
    const reanchoredStart = stretched
      ? qualifyingTrackProgress(car) ?? car.phaseStartProgress
      : car.phaseStartProgress;
    const cooled = {
      ...car,
      ...trafficState,
      ...telemetryState,
      phaseStartProgress: reanchoredStart,
      phaseDurationSeconds: stretched ? adjustedRemaining : car.phaseDurationSeconds,
      phaseRemainingSeconds: adjustedRemaining,
      energyPercent: clamp(car.energyPercent + 0.34, 0, 100),
      energyMode: "CHARGE" as const,
    };
    if (adjustedRemaining > 0) return { car: cooled, consumedCompound: null };
    if (cooled.flyingLapsRemaining > 0 && live.status === "RUNNING") {
      const projectedLap = qualifyingLapFor(state, live, cooled);
      const provisionalSectorTargets = qualifyingSectorTargets(state, cooled, projectedLap.lapSeconds);
      const pushDuration = clamp(projectedLap.lapSeconds, 84, 96);
      return {
        car: {
          ...cooled,
          phase: "PUSH_LAP",
          phaseDurationSeconds: pushDuration,
          phaseRemainingSeconds: pushDuration,
          phaseStartProgress: 0,
          energyMode: "QUALI",
          yielding: false,
          yieldingToCarId: null,
          yieldingDurationSeconds: 0,
          yieldCooldownSeconds: 0,
          trafficPenaltySeconds: 0,
          timing: beginQualifyingLapTiming(cooled.timing, true),
          provisionalSectorTargets,
          provisionalLapOutcome: projectedLap.note,
          provisionalTrafficAppliedSeconds: 0,
        },
        consumedCompound: null,
      };
    }
    return { car: startQualifyingReturn(cooled, 0), consumedCompound: null };
  }

  const returning = {
    ...car,
    ...trafficState,
    ...telemetryState,
    phaseRemainingSeconds: remaining,
    energyPercent: clamp(car.energyPercent + 0.2, 0, 100),
    energyMode: "CHARGE" as const,
  };
  if (remaining > 0) return { car: returning, consumedCompound: null };
  if (car.phase === "IN_LAP" || car.phase === "ABORTED_LAP") {
    return {
      car: {
        ...returning,
        phase: "PIT_ENTRY",
        phaseDurationSeconds: QUALIFYING_PIT_ENTRY_SECONDS,
        phaseRemainingSeconds: QUALIFYING_PIT_ENTRY_SECONDS,
        phaseStartProgress: QUALIFYING_PIT_ENTRY_PROGRESS,
        currentSpeedKph: 80,
      },
      consumedCompound: null,
    };
  }
  return {
    car: {
      ...returning,
      phase: "GARAGE",
      phaseDurationSeconds: 0,
      phaseRemainingSeconds: 0,
      phaseStartProgress: 0,
      currentSpeedKph: 0,
      previousSpeedKph: 80,
      selectedTyreSetId: null,
      releaseRequest: "HOLD",
    },
    consumedCompound: null,
  };
}

function classify(
  state: WeekendState,
  session: PracticeSession | QualifyingSession,
  carIds: readonly string[],
  eliminatedCount: number,
): WeekendSessionResult {
  const rule = STANDARD_WEEKEND_RULES.find((candidate) => candidate.id === session)!;
  const compound: TyreCompound = session.startsWith("Q") ? "SOFT" : PRACTICE_COMPOUND[session as PracticeSession];
  const entries = carIds.map((carId, index) => {
    const runs = session.startsWith("Q") ? 2 : 3;
    const bestLapSeconds = Math.min(...Array.from({ length: runs }, (_, run) => driverLapTime(state, carId, session, run)));
    const laps = session.startsWith("Q")
      ? 6 + Math.floor(hashNoise(state.seed, index + 210, SESSION_SEQUENCE.indexOf(session)) * 4)
      : 20 + Math.floor(hashNoise(state.seed, index + 110, SESSION_SEQUENCE.indexOf(session)) * 11);
    return { carId, bestLapSeconds, laps, compound };
  }).sort((a, b) => a.bestLapSeconds - b.bestLapSeconds || carIds.indexOf(a.carId) - carIds.indexOf(b.carId));
  const leader = entries[0]?.bestLapSeconds ?? 0;
  const advanceLimit = session.startsWith("Q") ? qualifyingAdvanceLimit(session as QualifyingSession) : null;

  return {
    session,
    durationMinutes: rule.durationMinutes ?? 0,
    entries: entries.map((entry, index) => ({
      ...entry,
      position: index + 1,
      gapSeconds: roundMillis(entry.bestLapSeconds - leader),
      eliminated: eliminatedCount > 0 && advanceLimit !== null && index >= advanceLimit,
      timedLap: session.startsWith("Q") ? true : undefined,
    })),
  };
}

function incrementTyreUsage(
  tyreUsage: WeekendState["tyreUsage"],
  carIds: readonly string[],
  compound: TyreCompound,
): WeekendState["tyreUsage"] {
  return Object.fromEntries(DRIVERS.map((driver) => {
    const current = tyreUsage[driver.id] ?? {};
    return [driver.id, carIds.includes(driver.id)
      ? { ...current, [compound]: Math.min(FIA_2026_STANDARD_TYRE_ALLOCATION[compound], (current[compound] ?? 0) + 1) }
      : current];
  }));
}

function qualifyingRecords(results: readonly WeekendSessionResult[]): QualifyingRecord[] {
  const bySession = new Map(results.filter((result) => result.session.startsWith("Q")).map((result) => [result.session, result]));
  const q1 = bySession.get("Q1");
  const q2 = bySession.get("Q2");
  const q3 = bySession.get("Q3");
  const finalOrder = q3
    ? [
        ...q3.entries,
        ...(q2?.entries.filter((entry) => entry.eliminated) ?? []),
        ...(q1?.entries.filter((entry) => entry.eliminated) ?? []),
      ]
    : [];

  return DRIVERS.map((driver) => ({
    carId: driver.id,
    q1: q1?.entries.find((entry) => entry.carId === driver.id && hasValidQualifyingTime(entry))?.bestLapSeconds ?? null,
    q2: q2?.entries.find((entry) => entry.carId === driver.id && hasValidQualifyingTime(entry))?.bestLapSeconds ?? null,
    q3: q3?.entries.find((entry) => entry.carId === driver.id && hasValidQualifyingTime(entry))?.bestLapSeconds ?? null,
    eliminatedIn: q1?.entries.find((entry) => entry.carId === driver.id)?.eliminated
      ? "Q1"
      : q2?.entries.find((entry) => entry.carId === driver.id)?.eliminated
        ? "Q2"
        : null,
    finalPosition: finalOrder.findIndex((entry) => entry.carId === driver.id) + 1 || null,
  }));
}

export function createWeekendState(seed: number, playerTeamId = DEFAULT_PLAYER_TEAM_ID): WeekendState {
  if (!TEAM_BY_ID.has(playerTeamId)) throw new RangeError(`Unknown player team: ${playerTeamId}.`);
  const setups = Object.fromEntries(DRIVERS.map((driver) => [driver.id, initialSetupFor(seed, driver.id, playerTeamId)]));
  const tyreUsage = Object.fromEntries(DRIVERS.map((driver) => [driver.id, {}]));
  const tyreInventory = createWeekendTyreInventory(DRIVERS.map((driver) => driver.id));
  return {
    seed,
    playerTeamId,
    currentSession: "FP1",
    completedSessions: [],
    results: [],
    qualifying: DRIVERS.map((driver) => ({ carId: driver.id, q1: null, q2: null, q3: null, eliminatedIn: null, finalPosition: null })),
    gridOrder: DRIVERS.map((driver) => driver.id),
    setups,
    lastRunSetups: Object.fromEntries(Object.entries(setups).map(([carId, setup]) => [carId, { ...setup }])),
    setupKnowledge: 0,
    tyreUsage,
    tyreInventory,
    sessionReports: [],
    qualifyingLive: null,
  };
}

function sessionReportFor(state: WeekendState, result: WeekendSessionResult): WeekendSessionReport {
  const qualifying = result.session.startsWith("Q");
  const reports = playerCarIdsFor(state.playerTeamId).map((carId): WeekendCarReport => {
    const driver = DRIVER_BY_ID.get(carId)!;
    const carIndex = DRIVERS.findIndex((candidate) => candidate.id === carId);
    const sessionIndex = SESSION_SEQUENCE.indexOf(result.session);
    const entry = result.entries.find((candidate) => candidate.carId === carId);
    const hasTimedLap = Boolean(entry && entry.timedLap !== false);
    const setup = state.setups[carId];
    const target = optimalSetupFor(state.seed, carId);
    const aeroDifference = (setup.frontWing - target.frontWing + setup.rearWing - target.rearWing) / 20;
    const mechanicalDifference = (setup.suspension - target.suspension + setup.rideHeight - target.rideHeight + setup.differential - target.differential) / 30;
    const coolingDifference = (setup.cooling - target.cooling) / 10;
    const aeroBalancePercent = Math.round(clamp(100 - Math.abs(aeroDifference) * 18, 28, 100));
    const mechanicalBalancePercent = Math.round(clamp(100 - Math.abs(mechanicalDifference) * 20, 25, 100));
    const thermalMarginPercent = Math.round(clamp(100 - Math.abs(coolingDifference) * 22, 24, 100));
    const tyreConditionPercent = entry
      ? Math.round(clamp(100 - entry.laps * (result.session === "FP3" || qualifying ? 1.05 : result.session === "FP2" ? 0.72 : 0.52), 38, 96))
      : 100;
    const energyProgramme: WeekendCarReport["energyProgramme"] = qualifying
      ? "QUALIFYING DEPLOY"
      : result.session === "FP1" ? "RECOVERY MAP" : result.session === "FP2" ? "RACE ENERGY" : "QUALIFYING DEPLOY";
    const energyRecoveryPercent = Math.round(clamp(
      energyProgramme === "RECOVERY MAP" ? 84 : energyProgramme === "RACE ENERGY" ? 72 : 46,
      0,
      100,
    ));
    const energyDeploymentPercent = Math.round(clamp(
      (energyProgramme === "QUALIFYING DEPLOY" ? 91 : energyProgramme === "RACE ENERGY" ? 75 : 58)
        - Math.abs(coolingDifference) * 4
        + signedNoise(state.seed, carIndex + 1_440, sessionIndex + 31) * 4,
      0,
      100,
    ));
    const outcome: WeekendCarReport["outcome"] = !hasTimedLap
      ? qualifying ? "ELIMINATED" : "NO RUN"
      : entry!.eliminated ? "ELIMINATED" : qualifying && result.session !== "Q3" ? "ADVANCED" : "COMPLETE";
    const dominantDifference = Math.max(Math.abs(aeroDifference), Math.abs(mechanicalDifference), Math.abs(coolingDifference));
    const balanceIssue = dominantDifference === 0
      ? "a stable mechanical platform"
      : Math.abs(coolingDifference) === dominantDifference
        ? coolingDifference < 0 ? "restricted cooling margin" : "excess cooling drag"
        : Math.abs(aeroDifference) === dominantDifference
          ? aeroDifference < 0 ? "high-speed understeer" : "straight-line drag"
          : mechanicalDifference < 0 ? "platform movement through direction changes" : "rear instability over kerbs";
    const messageContext = {
      seed: state.seed,
      carIndex,
      sessionIndex,
      session: result.session,
      phase: qualifying ? "QUALIFYING" as const : "PRACTICE" as const,
      outcome,
      driverShortName: driver.shortName,
      position: hasTimedLap ? entry?.position ?? null : null,
      laps: entry?.laps ?? 0,
      gapSeconds: entry?.gapSeconds ?? 0,
      balanceIssue,
      tyreConditionPercent,
      energyRecoveryPercent,
      energyDeploymentPercent,
      energyProgramme,
      aeroBalancePercent,
      mechanicalBalancePercent,
      thermalMarginPercent,
      bestLapSeconds: hasTimedLap ? entry?.bestLapSeconds ?? null : null,
    };
    const driverMessage = buildSessionDriverMessage(messageContext);
    const engineerMessage = buildSessionEngineerMessage(messageContext);
    return {
      carId,
      position: hasTimedLap ? entry?.position ?? null : null,
      bestLapSeconds: hasTimedLap ? entry?.bestLapSeconds ?? null : null,
      outcome,
      aeroBalancePercent,
      mechanicalBalancePercent,
      thermalMarginPercent,
      tyreConditionPercent,
      energyRecoveryPercent,
      energyDeploymentPercent,
      energyProgramme,
      driverMessage,
      engineerMessage,
    };
  });
  const activeReports = reports.filter((report) => report.position !== null);
  const bestPosition = activeReports.length ? Math.min(...activeReports.map((report) => report.position!)) : null;
  return {
    session: result.session,
    title: qualifying ? `${result.session} QUALIFYING REPORT` : `${result.session} RUN REPORT`,
    summary: bestPosition === null
      ? "No player car recorded a timed lap in this segment."
      : qualifying
        ? `Best car P${bestPosition}. The lap and balance notes point to the next decision.`
        : `Best car P${bestPosition}. Both drivers have given us a clear direction for the next setup step.`,
    cars: reports,
  };
}

function balanceFeedback(area: SetupFeedback["area"], difference: number, lowMessage: string, highMessage: string, goodMessage: string): SetupFeedback {
  if (difference <= -1) return { area, severity: Math.abs(difference) >= 2 ? "WATCH" : "INFO", message: lowMessage };
  if (difference >= 1) return { area, severity: Math.abs(difference) >= 2 ? "WATCH" : "INFO", message: highMessage };
  return { area, severity: "GOOD", message: goodMessage };
}

export function setupFeedbackFor(state: WeekendState, carId: string): readonly SetupFeedback[] {
  const driver = DRIVER_BY_ID.get(carId);
  const completedPractice = state.completedSessions.filter((session): session is PracticeSession => session.startsWith("FP"));
  if (!driver || completedPractice.length === 0) {
    return [{ area: "RUN", severity: "INFO", message: "Run the FP1 baseline first. No target values are pre-solved; use the driver debrief to choose the next change." }];
  }

  // Debrief only the configuration that actually completed the most recent
  // practice run. Moving a slider must not reveal the hidden target instantly.
  const setup = state.lastRunSetups[carId] ?? setupFor(state, carId);
  const target = optimalSetupFor(state.seed, carId);
  const latestPractice = [...state.results].reverse().find((result) => result.session.startsWith("FP"));
  const entry = latestPractice?.entries.find((candidate) => candidate.carId === carId);
  const runFeedback: SetupFeedback = {
    area: "RUN",
    severity: entry && entry.position > 10 ? "WATCH" : "INFO",
    message: entry
      ? `${latestPractice?.session} debrief · ${driver.shortName} was P${entry.position}, ${entry.position === 1 ? "setting the reference" : `${entry.gapSeconds.toFixed(3)}s from the reference`}. ${completedPractice.length === 1 ? "Use the comments below to prepare FP2." : completedPractice.length === 2 ? "Compare the FP2 response with the first run before committing for FP3." : "Final practice data is ready for qualifying."}`
      : `${driver.shortName} completed the run programme; timing correlation is still incomplete.`,
  };

  const aero = balanceFeedback(
    "AERO",
    (setup.frontWing - target.frontWing) / 10,
    `${driver.shortName} reports high-speed front wash through Copse and Maggotts. More front load should help, with a straight-line cost.`,
    `${driver.shortName} has a sharp front end but is losing efficiency on the Hangar Straight. Trim front load carefully.`,
    `${driver.shortName} reports a predictable high-speed front balance. Aero is inside the current confidence window.`,
  );
  const mechanical = balanceFeedback(
    "MECHANICAL",
    (setup.suspension - target.suspension) / 10,
    `${driver.shortName} feels the platform moving in direction changes and the rear takes time to settle. A firmer response may help.`,
    `${driver.shortName} reports snap oversteer over kerbs and traction loss from slower corners. The platform may be too stiff.`,
    `${driver.shortName} is comfortable over kerbs and through rapid direction changes. Mechanical balance is stable.`,
  );
  const thermal = balanceFeedback(
    "THERMAL",
    (setup.cooling - target.cooling) / 10,
    `${driver.shortName} is seeing rising temperatures late in the run. Open the cooling margin or shorten the push phase.`,
    `${driver.shortName} has safe temperatures but the car is paying an avoidable drag penalty. Cooling margin looks conservative.`,
    `${driver.shortName} reports stable temperatures across the representative run. Cooling is in range.`,
  );

  return [runFeedback, aero, mechanical, thermal];
}

function boundedSetupBand(centre: number, halfWidth: number): Pick<SetupRecommendationRange, "minimum" | "maximum"> {
  const fullWidth = halfWidth * 2;
  let minimum = Math.round(centre - halfWidth);
  let maximum = minimum + fullWidth;
  if (minimum < CAR_SETUP_MINIMUM) {
    minimum = CAR_SETUP_MINIMUM;
    maximum = CAR_SETUP_MINIMUM + fullWidth;
  }
  if (maximum > CAR_SETUP_MAXIMUM) {
    maximum = CAR_SETUP_MAXIMUM;
    minimum = CAR_SETUP_MAXIMUM - fullWidth;
  }
  return { minimum, maximum };
}

/** Returns an intentionally imperfect telemetry band. It narrows with knowledge without revealing the exact optimum. */
export function setupRecommendationFor(state: WeekendState, carId: string, key: keyof CarSetup): SetupRecommendationRange | null {
  const completedPractice = state.completedSessions.filter((session): session is PracticeSession => session.startsWith("FP"));
  const sourceSession = completedPractice.at(-1);
  if (!sourceSession || !DRIVER_BY_ID.has(carId)) return null;
  const target = optimalSetupFor(state.seed, carId)[key];
  const practiceCount = completedPractice.length;
  const carIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  const keyIndex = CAR_SETUP_KEYS.indexOf(key);
  const halfWidth = practiceCount === 1 ? 20 : practiceCount === 2 ? 15 : 11;
  const measurementUncertainty = practiceCount === 1 ? 8 : practiceCount === 2 ? 5 : 3;
  const measuredCentre = target + Math.round(signedNoise(state.seed, 1_620 + carIndex * 7 + keyIndex, practiceCount * 19) * measurementUncertainty);
  const band = boundedSetupBand(measuredCentre, halfWidth);
  return {
    ...band,
    confidence: practiceCount === 1 ? 48 : practiceCount === 2 ? 63 : 78,
    sourceSession,
  };
}

export function setWeekendCarSetup(state: WeekendState, carId: string, setup: Partial<CarSetup>): WeekendState {
  if (!DRIVER_BY_ID.has(carId)) return state;
  if (state.currentSession.startsWith("Q") || state.currentSession === "RACE") return state;
  const current = setupFor(state, carId);
  const rounded = (value: number | undefined, fallback: number) => clamp(Math.round(value ?? fallback), CAR_SETUP_MINIMUM, CAR_SETUP_MAXIMUM);
  return {
    ...state,
    setups: {
      ...state.setups,
      [carId]: {
        frontWing: rounded(setup.frontWing, current.frontWing),
        rearWing: rounded(setup.rearWing, current.rearWing),
        suspension: rounded(setup.suspension, current.suspension),
        rideHeight: rounded(setup.rideHeight, current.rideHeight),
        differential: rounded(setup.differential, current.differential),
        cooling: rounded(setup.cooling, current.cooling),
      },
    },
  };
}

function completeWeekendSession(
  state: WeekendState,
  result: WeekendSessionResult,
  usedTyres: WeekendState["tyreUsage"] | null = null,
): WeekendState {
  const session = result.session;
  const sessionReport = sessionReportFor(state, result);
  const results = [...state.results, result];
  const completedSessions = [...state.completedSessions, session];
  const nextSession = SESSION_SEQUENCE[SESSION_SEQUENCE.indexOf(session) + 1] ?? "RACE";
  const compound: TyreCompound = session.startsWith("Q") ? "SOFT" : PRACTICE_COMPOUND[session as PracticeSession];
  const entrants = result.entries.map((entry) => entry.carId);
  let tyreInventory = state.tyreInventory;
  if (session.startsWith("Q") && usedTyres === null) {
    for (const carId of entrants) {
      const set = selectableWeekendTyreSets(tyreInventory, carId, compound)[0];
      if (!set) continue;
      tyreInventory = fitWeekendTyreSet(tyreInventory, carId, set.id, session);
      tyreInventory = completeWeekendTyreRun(tyreInventory, carId, set.id, session, 90, 1);
    }
  }
  const tyreUsage = session.startsWith("Q")
    ? weekendTyreUsageFromInventory(tyreInventory)
    : usedTyres ?? incrementTyreUsage(state.tyreUsage, entrants, compound);
  const qualifying = qualifyingRecords(results);
  const finalGrid = nextSession === "RACE"
    ? [...qualifying].sort((a, b) => (a.finalPosition ?? 99) - (b.finalPosition ?? 99)).map((record) => record.carId)
    : state.gridOrder;
  const completed: WeekendState = {
    ...state,
    currentSession: nextSession,
    completedSessions,
    results,
    qualifying,
    gridOrder: finalGrid,
    lastRunSetups: session.startsWith("FP")
      ? Object.fromEntries(Object.entries(state.setups).map(([carId, setup]) => [carId, { ...setup }]))
      : state.lastRunSetups,
    setupKnowledge: session.startsWith("FP") ? clamp(state.setupKnowledge + 30, 0, 100) : state.setupKnowledge,
    tyreUsage,
    tyreInventory,
    sessionReports: [...state.sessionReports, sessionReport],
    qualifyingLive: null,
  };
  return nextSession.startsWith("Q")
    ? { ...completed, qualifyingLive: prepareQualifyingSession(completed, nextSession as QualifyingSession) }
    : completed;
}

function liveQualifyingResult(state: WeekendState, live: LiveQualifyingState): WeekendSessionResult {
  const rule = STANDARD_WEEKEND_RULES.find((candidate) => candidate.id === live.session)!;
  const originalOrder = Object.keys(live.cars);
  const sorted = Object.values(live.cars).sort((a, b) => {
    if (a.bestLapSeconds === null && b.bestLapSeconds === null) return originalOrder.indexOf(a.carId) - originalOrder.indexOf(b.carId);
    if (a.bestLapSeconds === null) return 1;
    if (b.bestLapSeconds === null) return -1;
    return a.bestLapSeconds - b.bestLapSeconds || originalOrder.indexOf(a.carId) - originalOrder.indexOf(b.carId);
  });
  const leader = sorted.find((car) => car.bestLapSeconds !== null)?.bestLapSeconds ?? 0;
  const advanceLimit = qualifyingAdvanceLimit(live.session);
  return {
    session: live.session,
    durationMinutes: rule.durationMinutes ?? 0,
    entries: sorted.map((car, index) => ({
      carId: car.carId,
      position: index + 1,
      bestLapSeconds: car.bestLapSeconds ?? 999 + index / 1_000,
      laps: car.completedRuns * 3,
      compound: car.selectedCompound,
      gapSeconds: car.bestLapSeconds === null ? 0 : roundMillis(car.bestLapSeconds - leader),
      eliminated: advanceLimit !== null && (car.bestLapSeconds === null || index >= advanceLimit),
      timedLap: car.bestLapSeconds !== null,
    })),
  };
}

export function liveQualifyingClassification(state: WeekendState): readonly LiveQualifyingClassificationEntry[] {
  const live = state.qualifyingLive;
  if (!live) return [];
  const originalOrder = Object.keys(live.cars);
  const sorted = Object.values(live.cars).sort((a, b) => {
    if (a.bestLapSeconds === null && b.bestLapSeconds === null) return originalOrder.indexOf(a.carId) - originalOrder.indexOf(b.carId);
    if (a.bestLapSeconds === null) return 1;
    if (b.bestLapSeconds === null) return -1;
    return a.bestLapSeconds - b.bestLapSeconds || originalOrder.indexOf(a.carId) - originalOrder.indexOf(b.carId);
  });
  const leader = sorted.find((car) => car.bestLapSeconds !== null)?.bestLapSeconds ?? null;
  const advanceLimit = qualifyingAdvanceLimit(live.session);
  const cutPosition = advanceLimit === null ? null : Math.min(advanceLimit, sorted.length);
  return sorted.map((car, index) => ({
    position: index + 1,
    carId: car.carId,
    bestLapSeconds: car.bestLapSeconds,
    gapSeconds: leader === null || car.bestLapSeconds === null ? null : roundMillis(car.bestLapSeconds - leader),
    phase: car.phase,
    eliminated: advanceLimit !== null && (car.bestLapSeconds === null || (cutPosition !== null && index + 1 > cutPosition)),
  }));
}

export function qualifyingCutPosition(state: WeekendState): number | null {
  const live = state.qualifyingLive;
  if (!live) return null;
  const advanceLimit = qualifyingAdvanceLimit(live.session);
  return advanceLimit === null ? null : Math.min(advanceLimit, Object.keys(live.cars).length);
}

export function qualifyingCarProgress(car: QualifyingCarState): number {
  return qualifyingPhaseProgress(car);
}

export function qualifyingDisplayStatus(car: QualifyingCarState): QualifyingDisplayStatus {
  if (car.phase === "IN_LAP" && car.lastRunNote === "TRACK LIMITS") return "LAP DELETED";
  if (car.phase === "PUSH_LAP" && car.trafficLevel === "HIGH") return "TRAFFIC";
  if (car.phase === "OUT_LAP") return "OUT LAP";
  if (car.phase === "PUSH_LAP") return "FLYING LAP";
  if (car.phase === "IN_LAP") return "IN LAP";
  if (car.phase === "ABORTED_LAP") return "ABORTED LAP";
  if (car.phase === "PIT_ENTRY") return "PIT ENTRY";
  return "GARAGE";
}

export function startLiveQualifying(state: WeekendState): WeekendState {
  if (!state.currentSession.startsWith("Q")) return state;
  const session = state.currentSession as QualifyingSession;
  const prepared = state.qualifyingLive?.session === session
    ? state.qualifyingLive
    : prepareQualifyingSession(state, session);
  const qualifyingLive = reconcileQualifyingEntrants(state, prepared);
  if (qualifyingLive.status !== "READY") return state;
  return { ...state, qualifyingLive: { ...qualifyingLive, status: "RUNNING", paused: false } };
}

export function setLiveQualifyingSpeed(state: WeekendState, speed: QualifyingSimulationSpeed): WeekendState {
  if (!state.qualifyingLive) return state;
  return { ...state, qualifyingLive: { ...state.qualifyingLive, speed } };
}

export function toggleLiveQualifyingPause(state: WeekendState): WeekendState {
  const live = state.qualifyingLive;
  if (!live || live.status === "READY") return state;
  return { ...state, qualifyingLive: { ...live, paused: !live.paused } };
}

export function setQualifyingCompound(state: WeekendState, carId: string, compound: TyreCompound): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || car.phase !== "GARAGE" || live.status === "CHECKERED") return state;
  if (!(["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as readonly TyreCompound[]).includes(compound)) return state;
  const selectedSet = selectableWeekendTyreSets(state.tyreInventory, carId, compound)[0] ?? null;
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: {
        ...live.cars,
        [carId]: {
          ...car,
          selectedCompound: compound,
          selectedTyreSetId: selectedSet?.id ?? null,
          tyreConditionPercent: selectedSet ? 100 - selectedSet.wearPercent : car.tyreConditionPercent,
        },
      },
    },
  };
}

export function setQualifyingTyreSet(state: WeekendState, carId: string, tyreSetId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  const set = weekendTyreSetById(state.tyreInventory, carId, tyreSetId);
  if (!live || !car || car.phase !== "GARAGE" || live.status === "CHECKERED" || !set) return state;
  if (!playerCarIdsFor(state.playerTeamId).includes(carId) || (set.status !== "NEW" && set.status !== "USED")) return state;
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: {
        ...live.cars,
        [carId]: {
          ...car,
          selectedCompound: set.compound,
          selectedTyreSetId: set.id,
          tyreConditionPercent: 100 - set.wearPercent,
        },
      },
    },
  };
}

export function reserveRacePreparationTyreSet(state: WeekendState, carId: string, tyreSetId: string): WeekendState {
  if (state.currentSession !== "RACE" || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  const tyreInventory = reserveWeekendTyreSet(state.tyreInventory, carId, tyreSetId);
  if (tyreInventory === state.tyreInventory) return state;
  return { ...state, tyreInventory, tyreUsage: weekendTyreUsageFromInventory(tyreInventory) };
}

export function setQualifyingOutLapMode(state: WeekendState, carId: string, mode: QualifyingOutLapMode): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || !playerCarIdsFor(state.playerTeamId).includes(carId) || car.phase === "PUSH_LAP") return state;
  return {
    ...state,
    qualifyingLive: { ...live, cars: { ...live.cars, [carId]: { ...car, outLapMode: mode } } },
  };
}

export function setQualifyingAttackMode(state: WeekendState, carId: string, mode: QualifyingAttackMode): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || !playerCarIdsFor(state.playerTeamId).includes(carId) || car.phase === "PUSH_LAP") return state;
  return {
    ...state,
    qualifyingLive: { ...live, cars: { ...live.cars, [carId]: { ...car, attackMode: mode } } },
  };
}

export function setQualifyingTrafficResponse(state: WeekendState, carId: string, response: QualifyingTrafficResponse): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  return {
    ...state,
    qualifyingLive: { ...live, cars: { ...live.cars, [carId]: { ...car, trafficResponse: response } } },
  };
}

export function setQualifyingFuelPlan(state: WeekendState, carId: string, plan: QualifyingFuelPlan): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || car.phase !== "GARAGE" || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: { ...live.cars, [carId]: { ...car, fuelPlan: plan, fuelLoadKg: qualifyingFuelLoadKg(plan) } },
    },
  };
}

export function releaseQualifyingCar(state: WeekendState, carId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  const selectedSet = weekendTyreSetById(state.tyreInventory, carId, car?.selectedTyreSetId ?? null);
  if (!live || !car || !selectedSet || (selectedSet.status !== "NEW" && selectedSet.status !== "USED") || live.status !== "RUNNING" || car.phase !== "GARAGE") return state;
  if (!playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  const tyreInventory = fitWeekendTyreSet(state.tyreInventory, carId, selectedSet.id, live.session);
  return {
    ...state,
    tyreInventory,
    tyreUsage: weekendTyreUsageFromInventory(tyreInventory),
    qualifyingLive: {
      ...live,
      cars: { ...live.cars, [carId]: startQualifyingRun(state, { ...car, tyreConditionPercent: 100 - selectedSet.wearPercent }, qualifyingOutLapDuration(state, car)) },
    },
  };
}

export function waitForQualifyingGap(state: WeekendState, carId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  const forecast = qualifyingReleaseForecast(state, carId);
  const selectedSet = weekendTyreSetById(state.tyreInventory, carId, car?.selectedTyreSetId ?? null);
  if (!live || !car || !selectedSet || (selectedSet.status !== "NEW" && selectedSet.status !== "USED") || live.status !== "RUNNING" || car.phase !== "GARAGE" || !forecast?.canFinishBeforeChequered) return state;
  if (!playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: {
        ...live.cars,
        [carId]: {
          ...car,
          releaseRequest: "WAIT_FOR_GAP",
          releaseRequestedAtSeconds: live.elapsedSeconds,
        },
      },
    },
  };
}

export function holdQualifyingCar(state: WeekendState, carId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || car.phase !== "GARAGE" || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: { ...live.cars, [carId]: { ...car, releaseRequest: "HOLD", releaseRequestedAtSeconds: null } },
    },
  };
}

export function abortQualifyingLap(state: WeekendState, carId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || car.phase !== "PUSH_LAP" || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  const startProgress = qualifyingTrackProgress(car) ?? qualifyingPhaseProgress(car);
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: {
        ...live.cars,
        [carId]: startQualifyingReturn(car, startProgress, "ABORTED", true),
      },
    },
  };
}

/**
 * Converts a preparation lap into a recovery in-lap: the attempt is given up
 * for now, but the car stays out and keeps its remaining flying laps.
 */
export function coolDownQualifyingCar(state: WeekendState, carId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  if (car.phase === "PUSH_LAP") return abortQualifyingLap(state, carId);
  if (car.phase !== "OUT_LAP") return state;
  const startProgress = qualifyingTrackProgress(car) ?? 0;
  const durationSeconds = Math.max(18, Math.round((1 - startProgress) * 66));
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: {
        ...live.cars,
        [carId]: {
          ...car,
          phase: "IN_LAP",
          // Keeping at least one flying lap is what marks this as a recovery
          // lap rather than a return to the garage.
          flyingLapsRemaining: Math.max(1, car.flyingLapsRemaining),
          phaseDurationSeconds: durationSeconds,
          phaseRemainingSeconds: durationSeconds,
          phaseStartProgress: startProgress,
          lastRunNote: "ABORTED",
          trafficPenaltySeconds: 0,
          energyMode: "CHARGE",
          timing: beginQualifyingLapTiming(car.timing, false),
          provisionalSectorTargets: null,
          provisionalLapOutcome: "ABORTED",
          provisionalTrafficAppliedSeconds: 0,
        },
      },
    },
  };
}

export function recallQualifyingCar(state: WeekendState, carId: string): WeekendState {
  const live = state.qualifyingLive;
  const car = live?.cars[carId];
  if (!live || !car || !playerCarIdsFor(state.playerTeamId).includes(carId)) return state;
  if (car.phase === "GARAGE" || car.phase === "PIT_ENTRY") return state;
  const startProgress = qualifyingTrackProgress(car)
    ?? (car.phase === "OUT_LAP" ? PIT_EXIT_END / SILVERSTONE_CIRCUIT.lengthMeters : qualifyingPhaseProgress(car));
  return {
    ...state,
    qualifyingLive: {
      ...live,
      cars: {
        ...live.cars,
        [carId]: startQualifyingReturn(car, startProgress, car.phase === "PUSH_LAP" ? "ABORTED" : car.lastRunNote, car.phase === "PUSH_LAP"),
      },
    },
  };
}

function tickLiveQualifyingOneSecond(state: WeekendState): WeekendState {
  const rawLive = state.qualifyingLive;
  const current = rawLive ? reconcileQualifyingEntrants(state, rawLive) : null;
  if (!current) return state;
  const workingState = current === rawLive ? state : { ...state, qualifyingLive: current };
  if (current.status === "READY" || current.paused) return workingState;
  const clockRunning = current.status === "RUNNING" && current.remainingSeconds > 0;
  const elapsedSeconds = clockRunning ? current.elapsedSeconds + 1 : current.elapsedSeconds;
  const remainingSeconds = clockRunning ? Math.max(0, current.remainingSeconds - 1) : current.remainingSeconds;
  const status: QualifyingSessionStatus = remainingSeconds === 0 ? "CHECKERED" : current.status;
  const trackEvolutionPercent = Math.round(clamp((elapsedSeconds / current.durationSeconds) * 100, 0, 100));
  const live: LiveQualifyingState = { ...current, elapsedSeconds, remainingSeconds, status, trackEvolutionPercent };
  let tyreInventory = state.tyreInventory;
  let sessionTiming = live.timing;
  const nextCars: Record<string, QualifyingCarState> = {};
  for (const [carId, car] of Object.entries(current.cars)) {
    const liveForCar = { ...live, timing: sessionTiming, cars: { ...live.cars, ...nextCars } };
    const updated = updateQualifyingCarOneSecond(workingState, liveForCar, car);
    if (updated.fittedTyreSetId) tyreInventory = fitWeekendTyreSet(tyreInventory, carId, updated.fittedTyreSetId, live.session);
    if (car.phase !== "GARAGE" && updated.car.phase === "GARAGE" && car.selectedTyreSetId) {
      tyreInventory = completeWeekendTyreRun(
        tyreInventory,
        carId,
        car.selectedTyreSetId,
        live.session,
        updated.car.tyreConditionPercent,
        Math.max(0, updated.car.completedRuns - car.fittedRunStartCompletedRuns),
      );
    }
    if (updated.sessionTiming) sessionTiming = updated.sessionTiming;
    const automaticEnergyMode: QualifyingEnergyMode = updated.car.phase === "PUSH_LAP" ? "QUALI" : "CHARGE";
    /*
     * A hold pin belongs to the phase that set it. Clearing it on any phase
     * change keeps the next phase running off its own clock, so one stale pin
     * cannot freeze a marker for the rest of the session.
     */
    const holdCleared = updated.car.phase !== car.phase && updated.car.phaseHoldProgress !== undefined
      ? { ...updated.car, phaseHoldProgress: undefined }
      : updated.car;
    nextCars[carId] = holdCleared.energyMode === automaticEnergyMode
      ? holdCleared
      : { ...holdCleared, energyMode: automaticEnergyMode };
  }
  const cars = reconcileLiveQualifyingSectorTones(nextCars, sessionTiming);
  const tyreUsage = weekendTyreUsageFromInventory(tyreInventory);
  const advanced: WeekendState = { ...workingState, tyreUsage, tyreInventory, qualifyingLive: { ...live, timing: sessionTiming, cars } };
  const activeCar = Object.values(cars).some((car) => car.phase !== "GARAGE");
  return status === "CHECKERED" && !activeCar
    ? completeWeekendSession(advanced, liveQualifyingResult(advanced, advanced.qualifyingLive!), tyreUsage)
    : advanced;
}

export function tickLiveQualifying(state: WeekendState, seconds = 1): WeekendState {
  let next = state;
  const iterations = Math.max(0, Math.round(seconds));
  for (let index = 0; index < iterations; index += 1) {
    const beforeSession = next.currentSession;
    next = tickLiveQualifyingOneSecond(next);
    if (next.currentSession !== beforeSession || next.qualifyingLive?.status === "READY") break;
  }
  return next;
}

export function skipLiveQualifyingSession(state: WeekendState): WeekendState {
  if (!state.qualifyingLive || !state.currentSession.startsWith("Q")) return state;
  // Skipping advances the real live-session state instead of replacing it with
  // a synthetic classification. AI cars continue their programmes, while a
  // player car only keeps laps it actually completed. A player car left in the
  // garage therefore records NO TIME and cannot be promoted to the next segment.
  const running = state.qualifyingLive.status === "READY"
    ? startLiveQualifying(state)
    : state;
  const remaining = running.qualifyingLive?.remainingSeconds ?? 0;
  return tickLiveQualifying(running, remaining + 600);
}

export function runWeekendSession(state: WeekendState): WeekendState {
  if (state.currentSession === "RACE") return state;
  const session = state.currentSession;
  const previousQualifying = state.results.filter((result) => result.session.startsWith("Q"));
  const entrants = session === "Q2"
    ? qualifyingAdvancers([...previousQualifying].reverse().find((result) => result.session === "Q1"), "Q2")
    : session === "Q3"
      ? qualifyingAdvancers([...previousQualifying].reverse().find((result) => result.session === "Q2"), "Q3")
      : DRIVERS.map((driver) => driver.id);
  const rule = STANDARD_WEEKEND_RULES.find((candidate) => candidate.id === session)!;
  const result = classify(state, session, entrants, rule.eliminated);
  return completeWeekendSession(state, result);
}

export function currentWeekendRule(state: WeekendState): SessionRule {
  return STANDARD_WEEKEND_RULES.find((rule) => rule.id === state.currentSession)!;
}

export function latestWeekendResult(state: WeekendState): WeekendSessionResult | null {
  return state.results.at(-1) ?? null;
}

export function latestWeekendReport(state: WeekendState): WeekendSessionReport | null {
  return state.sessionReports.at(-1) ?? null;
}
