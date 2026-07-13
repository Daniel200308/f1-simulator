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
  safetyCarInPitLane?: boolean;
  leaderReachedRestartLine?: boolean;
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

export interface PitLaneProcedure {
  status: PitLaneProcedureStatus;
  open: boolean;
  reason: "NORMAL" | "INITIAL_SAFETY_CAR_DEPLOYMENT";
  message: string;
}

export interface OvertakePermissionInput {
  raceControl: RaceControlStatus;
  currentSector: TrackSector;
  yellowSector: TrackSector | null;
  safetyCarPhase?: SafetyCarPhase;
  crossedRestartLine?: boolean;
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

/** Deterministic count-up state machine; timers reset whenever the phase changes. */
export function advanceSafetyCarProcedure(input: SafetyCarProcedureInput): SafetyCarProcedureUpdate {
  const elapsed = Math.max(0, input.state.phaseElapsedSeconds) + Math.max(0, input.stepSeconds);
  let phase = input.state.phase;

  if (phase === "DEPLOYED" && elapsed >= SAFETY_CAR_DEPLOYMENT_SECONDS) {
    phase = "BUNCHING";
  } else if (phase === "BUNCHING" && elapsed >= SAFETY_CAR_MINIMUM_BUNCHING_SECONDS && input.fieldBunched === true) {
    phase = "RESTART";
  } else if (
    phase === "RESTART"
    && elapsed >= SAFETY_CAR_RESTART_SECONDS
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

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function safetyCarSpeedFor(phase: Exclude<SafetyCarPhase, "NONE">): number {
  if (phase === "DEPLOYED") return 155;
  if (phase === "BUNCHING") return 125;
  return 185;
}

/** Advances the physical safety car, initializing it a safe distance ahead of P1. */
export function advanceSafetyCarPosition(input: SafetyCarPositionInput): SafetyCarPosition {
  if (input.circuitLengthMeters <= 0) throw new RangeError("circuitLengthMeters must be greater than 0");
  const speedKph = safetyCarSpeedFor(input.phase);
  const initializedDistance = input.leaderTotalDistance + 72;
  const totalDistance = input.previousTotalDistance === null
    ? initializedDistance
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
): SafetyCarFormation {
  const ordered = cars
    .filter((car) => !car.finished && car.incidentStatus !== "RETIRED" && car.pitStatus === "TRACK")
    .sort((a, b) => a.racePosition - b.racePosition || a.carId.localeCompare(b.carId));
  const targetGapMeters = queueGapFor(phase);
  const leadGapMeters = phase === "DEPLOYED" ? 42 : 28;
  const queue = ordered.map<SafetyCarQueueEntry>((car, index) => {
    const targetTotalDistance = safetyCar.totalDistance - leadGapMeters - index * targetGapMeters;
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
  return input.safetyCarPhase === "RESTART" && input.crossedRestartLine === true;
}

export function isRestartEligible(input: RestartEligibilityInput): boolean {
  return input.phase === "RESTART"
    && input.fieldBunched
    && input.safetyCarInPitLane
    && input.leaderReachedRestartLine;
}

export function raceControlPhaseMessage(input: {
  raceControl: RaceControlStatus;
  safetyCarPhase?: SafetyCarPhase;
  yellowSector?: TrackSector | null;
  pitLaneOpen?: boolean;
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
  if (input.safetyCarPhase === "DEPLOYED") {
    return { headline: "SAFETY CAR DEPLOYED", detail: input.pitLaneOpen === false ? "Catch the queue · pit lane closed" : "Catch the queue · no overtaking", priority: "URGENT" };
  }
  if (input.safetyCarPhase === "BUNCHING") {
    return { headline: "FIELD BUNCHING", detail: "Maintain queue position · pit lane open", priority: "WARNING" };
  }
  if (input.safetyCarPhase === "RESTART") {
    return { headline: "SAFETY CAR IN THIS LAP", detail: "Leader controls the pace · overtake after the line", priority: "WARNING" };
  }
  return { headline: "RACE CONTROL", detail: "Await instructions", priority: "NORMAL" };
}
