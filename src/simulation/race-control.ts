import type {
  IncidentStatus,
  PitLaneProcedureStatus,
  PitStatus,
  RaceControlStatus,
  SafetyCarPhase,
  VscComplianceStatus,
} from "@/domain/race";

export const LOCAL_YELLOW_SPEED_FACTOR = 0.68;
export const LOCAL_YELLOW_MAX_SPEED_KPH = 160;
export const VSC_SPEED_FACTOR = 0.62;
export const VSC_DELTA_TOLERANCE_SECONDS = 0.05;
export const VSC_SUSTAINED_VIOLATION_SECONDS = 1;
export const SAFETY_CAR_DEPLOYMENT_SECONDS = 12;
export const SAFETY_CAR_MINIMUM_BUNCHING_SECONDS = 18;
export const SAFETY_CAR_RESTART_SECONDS = 8;
/** Time spent leaving the pit lane before the physical Safety Car is on track. */
export const SAFETY_CAR_PIT_RELEASE_SECONDS = 3.2;
/** Crawl speed while the Safety Car is clear of the pit exit but P1 has not joined. */
export const SAFETY_CAR_DEPLOYMENT_SLOW_SPEED_KPH = 58;
/** Hard ceiling before the first car has physically joined the Safety Car queue. */
export const SAFETY_CAR_PRE_CONTACT_MAX_SPEED_KPH = 80;
/** The physical car leaves the pit lane at a deliberately cautious pace. */
export const SAFETY_CAR_PIT_RELEASE_SPEED_KPH = 42;
/** Distance at which P1 is considered attached to the physical Safety Car. */
export const SAFETY_CAR_FIRST_CONTACT_DISTANCE_METERS = 64;
/** Once the lead car is attached, the Safety Car uses 60% of local green pace. */
export const SAFETY_CAR_FOLLOWING_SPEED_FACTOR = 0.6;
export const SAFETY_CAR_APPROACH_SPEED_KPH = 155;

export type TrackSector = 1 | 2 | 3;

export interface LocalYellowInstruction {
  applies: boolean;
  speedFactor: number;
  maximumSpeedKph: number | null;
  noOvertaking: boolean;
  message: string;
}

export interface VscComplianceState {
  targetElapsedSeconds: number;
  actualElapsedSeconds: number;
  deltaSeconds: number;
  violationSeconds: number;
  status: VscComplianceStatus;
  speedCorrectionFactor: number;
}

export interface SafetyCarProcedureState {
  phase: SafetyCarPhase;
  phaseElapsedSeconds: number;
}

export interface SafetyCarProcedureInput {
  state: SafetyCarProcedureState;
  stepSeconds: number;
  fieldBunched?: boolean;
  endingSectorReached?: boolean;
  safetyCarInPitLane?: boolean;
  leaderReachedRestartLine?: boolean;
  /** Wave-by cars must be clear before the withdrawal lap can begin. */
  waveByComplete?: boolean;
}

export interface SafetyCarProcedureUpdate extends SafetyCarProcedureState {
  changed: boolean;
  restartEligible: boolean;
  message: RaceControlPhaseMessage | null;
}

export interface SafetyCarPosition {
  totalDistance: number;
  lapDistance: number;
  speedKph: number;
}

export interface SafetyCarPositionInput {
  previousTotalDistance: number | null;
  leaderTotalDistance: number;
  circuitLengthMeters: number;
  phase: Exclude<SafetyCarPhase, "NONE">;
  stepSeconds: number;
  phaseElapsedSeconds?: number;
  /** Track distance where the pit lane rejoins the circuit. */
  pitExitDistance?: number;
  /** Absolute distance of the lead car, used for the pit-exit approach cue. */
  firstCarDistance?: number | null;
  /** Local green-flag reference speed used after the lead car joins the queue. */
  referenceRaceSpeedKph?: number;
}

export interface SafetyCarCandidate {
  carId: string;
  racePosition: number;
  totalDistance: number;
  finished: boolean;
  incidentStatus: IncidentStatus;
  pitStatus: PitStatus;
}

export interface SafetyCarQueueEntry {
  carId: string;
  queuePosition: number;
  currentTotalDistance: number;
  targetTotalDistance: number;
  distanceToTargetMeters: number;
  targetGapMeters: number;
}

export interface SafetyCarFormation {
  safetyCar: SafetyCarPosition;
  queue: readonly SafetyCarQueueEntry[];
  fieldBunched: boolean;
  maximumActualGapMeters: number;
}

export interface SafetyCarSchedule {
  deploymentDistance: number;
  targetLaps: 1 | 2;
  unlappingStartDistance: number | null;
  endingStartDistance: number;
  pitEntryDistance: number;
  restartLineDistance: number;
}

export interface PitLaneProcedure {
  status: PitLaneProcedureStatus;
  open: boolean;
  reason: "NORMAL" | "INITIAL_SAFETY_CAR_DEPLOYMENT" | "RED_FLAG_SUSPENSION";
  message: string;
}

export interface OvertakePermissionInput {
  raceControl: RaceControlStatus;
  currentSector: TrackSector;
  yellowSector: TrackSector | null;
  safetyCarPhase?: SafetyCarPhase;
  crossedRestartLine?: boolean;
  lappedCarMayOvertakeSafetyCar?: boolean;
}

export interface RestartEligibilityInput {
  phase: SafetyCarPhase;
  fieldBunched: boolean;
  safetyCarInPitLane: boolean;
  leaderReachedRestartLine: boolean;
}

export interface RaceControlPhaseMessage {
  headline: string;
  detail: string;
  priority: "NORMAL" | "WARNING" | "URGENT";
}

const RACE_CONTROL_PRIORITY: Readonly<Record<RaceControlStatus, number>> = {
  GREEN: 0,
  YELLOW: 1,
  VSC: 2,
  SAFETY_CAR: 3,
  RED_FLAG: 4,
};

/** Incident updates may escalate control, but can never silently downgrade it. */
export function selectHigherPriorityRaceControl(
  current: RaceControlStatus,
  candidate: RaceControlStatus,
): RaceControlStatus {
  return RACE_CONTROL_PRIORITY[candidate] > RACE_CONTROL_PRIORITY[current] ? candidate : current;
}

/** Returns an instruction only for the affected local-yellow sector. */
export function localYellowInstructionFor(
  currentSector: TrackSector,
  raceControl: RaceControlStatus,
  yellowSector: TrackSector | null,
): LocalYellowInstruction {
  const applies = raceControl === "YELLOW" && yellowSector === currentSector;
  return applies
    ? {
        applies: true,
        speedFactor: LOCAL_YELLOW_SPEED_FACTOR,
        maximumSpeedKph: LOCAL_YELLOW_MAX_SPEED_KPH,
        noOvertaking: true,
        message: `LOCAL YELLOW — SECTOR ${currentSector}`,
      }
    : {
        applies: false,
        speedFactor: 1,
        maximumSpeedKph: null,
        noOvertaking: false,
        message: "CLEAR SECTOR",
      };
}

/** Converts a representative green-flag travel time into its VSC target time. */
export function vscTargetElapsedSeconds(greenElapsedSeconds: number, speedFactor = VSC_SPEED_FACTOR): number {
  if (!Number.isFinite(greenElapsedSeconds) || greenElapsedSeconds < 0) {
    throw new RangeError("greenElapsedSeconds must be a finite non-negative number");
  }
  if (!Number.isFinite(speedFactor) || speedFactor <= 0 || speedFactor > 1) {
    throw new RangeError("speedFactor must be greater than 0 and no greater than 1");
  }
  return greenElapsedSeconds / speedFactor;
}

/**
 * Positive delta means the car is safely slower than the target. A negative delta
 * must remain outside tolerance continuously before it becomes a violation.
 */
export function updateVscCompliance(input: {
  actualElapsedSeconds: number;
  targetElapsedSeconds: number;
  previousViolationSeconds: number;
  stepSeconds: number;
  toleranceSeconds?: number;
  sustainedViolationSeconds?: number;
}): VscComplianceState {
  const tolerance = input.toleranceSeconds ?? VSC_DELTA_TOLERANCE_SECONDS;
  const sustainedLimit = input.sustainedViolationSeconds ?? VSC_SUSTAINED_VIOLATION_SECONDS;
  const deltaSeconds = input.actualElapsedSeconds - input.targetElapsedSeconds;
  const tooFast = deltaSeconds < -tolerance;
  const violationSeconds = tooFast
    ? Math.max(0, input.previousViolationSeconds) + Math.max(0, input.stepSeconds)
    : 0;
  const status: VscComplianceStatus = !tooFast
    ? "COMPLIANT"
    : violationSeconds >= sustainedLimit ? "VIOLATION" : "WARNING";

  return {
    targetElapsedSeconds: input.targetElapsedSeconds,
    actualElapsedSeconds: input.actualElapsedSeconds,
    deltaSeconds,
    violationSeconds,
    status,
    speedCorrectionFactor: status === "VIOLATION" ? 0.88 : status === "WARNING" ? 0.94 : deltaSeconds > 0.8 ? 1.025 : 1,
  };
}

export function createSafetyCarProcedureState(): SafetyCarProcedureState {
  return { phase: "DEPLOYED", phaseElapsedSeconds: 0 };
}

/**
 * Deterministic Safety Car state machine. Deployment keeps a short pit-release
 * phase, but withdrawal is distance based so a slow or lapped tail car can never
 * hold the race neutralised indefinitely.
 */
export function advanceSafetyCarProcedure(input: SafetyCarProcedureInput): SafetyCarProcedureUpdate {
  const elapsed = Math.max(0, input.state.phaseElapsedSeconds) + Math.max(0, input.stepSeconds);
  let phase = input.state.phase;

  if (phase === "DEPLOYED" && elapsed >= SAFETY_CAR_DEPLOYMENT_SECONDS) {
    phase = "BUNCHING";
  } else if (phase === "BUNCHING" && input.endingSectorReached === true && input.waveByComplete !== false) {
    phase = "RESTART";
  } else if (
    phase === "RESTART"
    && isRestartEligible({
      phase,
      fieldBunched: input.fieldBunched === true,
      safetyCarInPitLane: input.safetyCarInPitLane === true,
      leaderReachedRestartLine: input.leaderReachedRestartLine === true,
    })
  ) {
    phase = "NONE";
  }

  const changed = phase !== input.state.phase;
  const restartEligible = isRestartEligible({
    phase: input.state.phase,
    fieldBunched: input.fieldBunched === true,
    safetyCarInPitLane: input.safetyCarInPitLane === true,
    leaderReachedRestartLine: input.leaderReachedRestartLine === true,
  });

  return {
    phase,
    phaseElapsedSeconds: changed ? 0 : elapsed,
    changed,
    restartEligible,
    message: changed ? raceControlPhaseMessage({ raceControl: phase === "NONE" ? "GREEN" : "SAFETY_CAR", safetyCarPhase: phase }) : null,
  };
}

function nextAbsoluteOccurrence(totalDistance: number, lapDistance: number, circuitLengthMeters: number): number {
  if (circuitLengthMeters <= 0) throw new RangeError("circuitLengthMeters must be greater than 0");
  const normalizedLapDistance = positiveModulo(lapDistance, circuitLengthMeters);
  const lapIndex = Math.floor(totalDistance / circuitLengthMeters);
  let candidate = lapIndex * circuitLengthMeters + normalizedLapDistance;
  if (candidate <= totalDistance + 0.001) candidate += circuitLengthMeters;
  return candidate;
}

function absoluteOccurrenceAtOrAfter(minimumDistance: number, lapDistance: number, circuitLengthMeters: number): number {
  if (circuitLengthMeters <= 0) throw new RangeError("circuitLengthMeters must be greater than 0");
  const normalizedLapDistance = positiveModulo(lapDistance, circuitLengthMeters);
  const lapIndex = Math.floor(minimumDistance / circuitLengthMeters);
  let candidate = lapIndex * circuitLengthMeters + normalizedLapDistance;
  if (candidate < minimumDistance - 0.001) candidate += circuitLengthMeters;
  return candidate;
}

/** Picks two tours whenever a wave-by is required; otherwise varies one/two by seed. */
export function safetyCarTargetLapsFor(seed: number, deploymentNumber: number, hasLappedCars: boolean): 1 | 2 {
  if (hasLappedCars) return 2;
  let value = (seed ^ Math.imul(deploymentNumber + 1, 0x45d9f3b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  return (value & 1) === 0 ? 1 : 2;
}

/**
 * Builds late-sector-three withdrawal markers only after the requested number
 * of complete circuits has elapsed from deployment. Alignment to sector three
 * may add only the remaining partial circuit; targetLaps itself stays capped at
 * one or two.
 */
export function buildSafetyCarSchedule(input: {
  deploymentDistance: number;
  targetLaps: 1 | 2;
  circuitLengthMeters: number;
  sectorThreeStartDistance: number;
  pitEntryLapDistance: number;
}): SafetyCarSchedule {
  const minimumEndingDistance = input.deploymentDistance
    + input.targetLaps * input.circuitLengthMeters;
  const endingStartDistance = absoluteOccurrenceAtOrAfter(
    minimumEndingDistance,
    input.sectorThreeStartDistance,
    input.circuitLengthMeters,
  );
  const pitEntryOffset = positiveModulo(input.pitEntryLapDistance - input.sectorThreeStartDistance, input.circuitLengthMeters);
  const pitEntryDistance = endingStartDistance + pitEntryOffset;
  const restartLineDistance = nextAbsoluteOccurrence(pitEntryDistance, 0, input.circuitLengthMeters);
  return {
    deploymentDistance: input.deploymentDistance,
    targetLaps: input.targetLaps,
    unlappingStartDistance: input.targetLaps === 2 ? endingStartDistance - input.circuitLengthMeters : null,
    endingStartDistance,
    pitEntryDistance,
    restartLineDistance,
  };
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function safetyCarFollowingSpeedFor(referenceRaceSpeedKph?: number): number {
  const normalRaceSpeedKph = Number.isFinite(referenceRaceSpeedKph)
    ? referenceRaceSpeedKph as number
    : SAFETY_CAR_APPROACH_SPEED_KPH / SAFETY_CAR_FOLLOWING_SPEED_FACTOR;
  return Math.max(45, normalRaceSpeedKph * SAFETY_CAR_FOLLOWING_SPEED_FACTOR);
}

function safetyCarSpeedFor(phase: Exclude<SafetyCarPhase, "NONE">, referenceRaceSpeedKph?: number): number {
  if (phase === "DEPLOYED") return SAFETY_CAR_DEPLOYMENT_SLOW_SPEED_KPH;
  if (phase === "BUNCHING") return safetyCarFollowingSpeedFor(referenceRaceSpeedKph);
  return 185;
}

/**
 * Advances the physical Safety Car. It is born at the next pit-lane rejoin,
 * holds there while the marshal release is shown, then rolls slowly until P1
 * is close enough to join the queue. The pre-contact ceiling applies across
 * the deployment transition so the phase timer cannot make the car accelerate
 * away from an approaching leader.
 */
export function advanceSafetyCarPosition(input: SafetyCarPositionInput): SafetyCarPosition {
  if (input.circuitLengthMeters <= 0) throw new RangeError("circuitLengthMeters must be greater than 0");
  const pitExitDistance = input.pitExitDistance ?? 155;
  const initializedDistance = absoluteOccurrenceAtOrAfter(input.leaderTotalDistance, pitExitDistance, input.circuitLengthMeters);
  const phaseElapsedSeconds = input.phaseElapsedSeconds;
  const leavingPit = input.phase === "DEPLOYED"
    && phaseElapsedSeconds !== undefined
    && Math.max(0, phaseElapsedSeconds) < SAFETY_CAR_PIT_RELEASE_SECONDS;
  const currentDistance = input.previousTotalDistance ?? initializedDistance;
  const distanceToFirstCar = input.firstCarDistance === null || input.firstCarDistance === undefined
    ? Number.POSITIVE_INFINITY
    : input.firstCarDistance - currentDistance;
  const firstCarJoined = !leavingPit
    && Number.isFinite(distanceToFirstCar)
    && Math.abs(distanceToFirstCar) <= SAFETY_CAR_FIRST_CONTACT_DISTANCE_METERS;
  const speedKph = leavingPit
    ? SAFETY_CAR_PIT_RELEASE_SPEED_KPH
    : firstCarJoined
      ? input.phase === "DEPLOYED"
        ? safetyCarFollowingSpeedFor(input.referenceRaceSpeedKph)
        : safetyCarSpeedFor(input.phase, input.referenceRaceSpeedKph)
      : Math.min(SAFETY_CAR_DEPLOYMENT_SLOW_SPEED_KPH, SAFETY_CAR_PRE_CONTACT_MAX_SPEED_KPH);
  const totalDistance = input.previousTotalDistance === null
    ? initializedDistance
    : leavingPit
      ? input.previousTotalDistance
      : input.previousTotalDistance + (speedKph / 3.6) * Math.max(0, input.stepSeconds);
  return {
    totalDistance,
    lapDistance: positiveModulo(totalDistance, input.circuitLengthMeters),
    speedKph,
  };
}

function queueGapFor(phase: Exclude<SafetyCarPhase, "NONE">): number {
  if (phase === "DEPLOYED") return 34;
  if (phase === "BUNCHING") return 14;
  return 12;
}

/**
 * Produces stable, unique queue targets from the frozen race order. Pit-lane and
 * retired cars are deliberately excluded so a legal pit stop cannot corrupt it.
 */
export function buildSafetyCarFormation(
  cars: readonly SafetyCarCandidate[],
  safetyCar: SafetyCarPosition,
  phase: Exclude<SafetyCarPhase, "NONE">,
  excludedCarIds: readonly string[] = [],
  queueOffsetMetersByCarId: Readonly<Record<string, number>> = {},
): SafetyCarFormation {
  const excluded = new Set(excludedCarIds);
  const ordered = cars
    .filter((car) => !excluded.has(car.carId) && !car.finished && car.incidentStatus !== "RETIRED" && car.pitStatus === "TRACK")
    .sort((a, b) => a.racePosition - b.racePosition || a.carId.localeCompare(b.carId));
  const targetGapMeters = queueGapFor(phase);
  const leadGapMeters = phase === "DEPLOYED" ? 42 : 28;
  const queue = ordered.map<SafetyCarQueueEntry>((car, index) => {
    const preservedLapOffset = Math.max(0, queueOffsetMetersByCarId[car.carId] ?? 0);
    const targetTotalDistance = safetyCar.totalDistance - leadGapMeters - index * targetGapMeters - preservedLapOffset;
    return {
      carId: car.carId,
      queuePosition: index + 1,
      currentTotalDistance: car.totalDistance,
      targetTotalDistance,
      distanceToTargetMeters: targetTotalDistance - car.totalDistance,
      targetGapMeters: index === 0 ? leadGapMeters : targetGapMeters,
    };
  });
  const actualGaps = queue.map((entry, index) => {
    if (index === 0) return safetyCar.totalDistance - entry.currentTotalDistance;
    return queue[index - 1].currentTotalDistance - entry.currentTotalDistance;
  });
  const maximumActualGapMeters = actualGaps.length === 0 ? 0 : Math.max(...actualGaps);
  const toleranceMeters = 6;
  const fieldBunched = queue.length > 0 && actualGaps.every((gap, index) => {
    const desired = index === 0 ? leadGapMeters : targetGapMeters;
    return gap > 0 && gap <= desired + toleranceMeters;
  });

  return { safetyCar, queue, fieldBunched, maximumActualGapMeters };
}

export function pitLaneProcedureFor(
  raceControl: RaceControlStatus,
  safetyCarPhase: SafetyCarPhase,
  phaseElapsedSeconds: number,
): PitLaneProcedure {
  // Kept in the public contract so callers can use the same clock across phases.
  void phaseElapsedSeconds;
  if (raceControl === "RED_FLAG") {
    return {
      status: "CLOSED",
      open: false,
      reason: "RED_FLAG_SUSPENSION",
      message: "PIT EXIT CLOSED — RED FLAG QUEUE",
    };
  }
  const initiallyClosed = raceControl === "SAFETY_CAR"
    && safetyCarPhase === "DEPLOYED";
  return initiallyClosed
    ? {
        status: "CLOSED",
        open: false,
        reason: "INITIAL_SAFETY_CAR_DEPLOYMENT",
        message: "PIT LANE CLOSED — INCIDENT RESPONSE",
      }
    : { status: "OPEN", open: true, reason: "NORMAL", message: "PIT LANE OPEN" };
}

export function isOvertakePermitted(input: OvertakePermissionInput): boolean {
  if (input.raceControl === "GREEN") return true;
  if (input.raceControl === "YELLOW") return input.yellowSector !== input.currentSector;
  if (input.raceControl === "VSC") return false;
  if (input.raceControl === "RED_FLAG") return false;
  if (input.lappedCarMayOvertakeSafetyCar === true) return true;
  return input.safetyCarPhase === "RESTART" && input.crossedRestartLine === true;
}

export function isRestartEligible(input: RestartEligibilityInput): boolean {
  return input.phase === "RESTART"
    && input.safetyCarInPitLane
    && input.leaderReachedRestartLine;
}

export function raceControlPhaseMessage(input: {
  raceControl: RaceControlStatus;
  safetyCarPhase?: SafetyCarPhase;
  yellowSector?: TrackSector | null;
  pitLaneOpen?: boolean;
  lappedCarsMayOvertake?: boolean;
  waveByCarCount?: number;
}): RaceControlPhaseMessage {
  if (input.raceControl === "GREEN") {
    return { headline: "GREEN FLAG", detail: "Racing resumed", priority: "NORMAL" };
  }
  if (input.raceControl === "YELLOW") {
    return { headline: `YELLOW FLAG · SECTOR ${input.yellowSector ?? "—"}`, detail: "Reduce speed · no overtaking in the affected sector", priority: "WARNING" };
  }
  if (input.raceControl === "VSC") {
    return { headline: "VIRTUAL SAFETY CAR · VSC", detail: "Maintain positive delta · no overtaking", priority: "URGENT" };
  }
  if (input.raceControl === "RED_FLAG") {
    return { headline: "RED FLAG", detail: "Race suspended · proceed to the pit-lane queue · no overtaking", priority: "URGENT" };
  }
  if (input.safetyCarPhase === "DEPLOYED") {
    return { headline: "SAFETY CAR DEPLOYED", detail: input.pitLaneOpen === false ? "Catch the queue · pit lane closed" : "Catch the queue · no overtaking", priority: "URGENT" };
  }
  if (input.safetyCarPhase === "BUNCHING") {
    if (input.lappedCarsMayOvertake) {
      const count = Math.max(1, input.waveByCarCount ?? 1);
      return {
        headline: "LAPPED CARS MAY NOW OVERTAKE",
        detail: `${count} car${count === 1 ? "" : "s"} may pass the Safety Car · rejoin at the back`,
        priority: "WARNING",
      };
    }
    return { headline: "FIELD BUNCHING", detail: "Maintain queue position · pit lane open", priority: "WARNING" };
  }
  if (input.safetyCarPhase === "RESTART") {
    return { headline: "SC ENDING", detail: "Safety Car enters the pits in sector 3 · leader controls the pace", priority: "WARNING" };
  }
  return { headline: "RACE CONTROL", detail: "Await instructions", priority: "NORMAL" };
}
