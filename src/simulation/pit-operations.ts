import type { PitStopIssue, RaceCarState, TyreCompound } from "@/domain/race";
import { signedNoise } from "@/simulation/random";

export type PitReadiness = "READY" | "WATCH" | "BLOCKED";
export type PitTrafficRisk = "LOW" | "MEDIUM" | "HIGH";

export interface PitOperationsContext {
  seed: number;
  tick: number;
  elapsedTime: number;
  pitLaneOpen: boolean;
  cars: readonly RaceCarState[];
}

export interface PitOperationAssessment {
  carId: string;
  compound: TyreCompound;
  readiness: PitReadiness;
  tyreSetReady: boolean;
  doubleStackConflict: boolean;
  trafficRisk: PitTrafficRisk;
  predictedStationarySeconds: number;
  predictedTotalLossSeconds: number;
  predictedIssue: PitStopIssue;
  confidence: number;
  reasons: readonly string[];
}

export interface PitStopExecution {
  carId: string;
  issue: PitStopIssue;
  stationarySeconds: number;
  /** Actual wheel-change work, including a wheel-gun delay when present. */
  tyreServiceSeconds: number;
  serviceSeconds: number;
  serviceIssueDelaySeconds: number;
  queueDelaySeconds: number;
  releaseDelaySeconds: number;
  doubleStackConflict: boolean;
}

/**
 * Mean of the 24 event-winning stationary stops in the official 2025 DHL
 * Fastest Pit Stop table. This is a front-running benchmark, not the mean of
 * every stop in the field; crew offsets and execution variance sit above it.
 */
export const F1_2025_FASTEST_STOP_MEAN_SECONDS = 2.082;
export const F1_2025_FASTEST_STOP_RANGE_SECONDS = [1.91, 2.32] as const;
export const F1_2025_TYPICAL_CLEAN_STOP_SECONDS = 2.2;

const TEAM_CREW_OFFSET_SECONDS: Readonly<Record<string, number>> = {
  "red-bull": 0.00,
  mclaren: 0.01,
  ferrari: 0.03,
  mercedes: 0.06,
  "racing-bulls": 0.08,
  williams: 0.11,
  alpine: 0.13,
  "aston-martin": 0.15,
  haas: 0.17,
  audi: 0.19,
  cadillac: 0.22,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function selectedCompound(car: RaceCarState, compound?: TyreCompound): TyreCompound {
  return compound ?? car.scheduledPitCompound ?? car.tyreCompound;
}

function hasPreparedSet(car: RaceCarState, compound: TyreCompound): boolean {
  return car.tyreSets.some((set) => set.compound === compound && (set.status === "RESERVED" || set.status === "AVAILABLE"));
}

function hasDoubleStackConflict(context: PitOperationsContext, car: RaceCarState): boolean {
  return context.cars.some((other) => other.carId !== car.carId && other.teamId === car.teamId && (
    other.pitStatus === "PIT_STOP"
      || (other.pitStatus === "PIT_LANE" && (
        other.lapDistance > car.lapDistance + 0.01
          || (Math.abs(other.lapDistance - car.lapDistance) <= 0.01 && (
            other.racePosition < car.racePosition
              || (other.racePosition === car.racePosition && other.carId.localeCompare(car.carId) < 0)
          ))
      ))
      || (other.pitStatus === "TRACK"
        && Boolean(other.scheduledPitCompound)
        && other.currentLap === car.currentLap
        && Math.abs(other.gapToLeader - car.gapToLeader) <= 18
        && (other.gapToLeader < car.gapToLeader - 0.01
          || (Math.abs(other.gapToLeader - car.gapToLeader) <= 0.01 && other.racePosition < car.racePosition)))
  ));
}

function trafficRisk(context: PitOperationsContext, car: RaceCarState): PitTrafficRisk {
  const nearby = context.cars.filter((other) => other.carId !== car.carId && (
    other.pitStatus === "PIT_ENTRY" || other.pitStatus === "PIT_LANE" || other.pitStatus === "PIT_EXIT"
  )).length;
  return nearby >= 4 ? "HIGH" : nearby >= 2 ? "MEDIUM" : "LOW";
}

function deterministicExecution(context: PitOperationsContext, car: RaceCarState): PitStopExecution {
  const carIndex = Math.max(0, context.cars.findIndex((candidate) => candidate.carId === car.carId));
  // Crew performance is determined once per car/stop number. Using the live
  // simulation tick here would make the forecast flicker every 100 ms and
  // could show a different issue from the stop that is eventually executed.
  const stopNumber = car.pitStops + 1;
  const noise = signedNoise(context.seed, 7_000 + carIndex, stopNumber);
  const doubleStackConflict = hasDoubleStackConflict(context, car);
  const crewOffset = TEAM_CREW_OFFSET_SECONDS[car.teamId] ?? 0.14;
  const serviceSeconds = F1_2025_FASTEST_STOP_MEAN_SECONDS + crewOffset + Math.abs(noise) * 0.24;
  let issue: PitStopIssue = "NONE";
  let issueDelay = 0;
  if (doubleStackConflict) {
    issue = "DOUBLE_STACK";
    issueDelay = 1.6 + Math.abs(signedNoise(context.seed, 7_100 + carIndex, stopNumber)) * 1.2;
  } else if (noise > 0.94) {
    issue = "WHEEL_GUN";
    issueDelay = 2.1 + Math.abs(signedNoise(context.seed, 7_200 + carIndex, stopNumber)) * 1.8;
  } else if (noise > 0.82) {
    issue = "SLOW_RELEASE";
    issueDelay = 0.8 + Math.abs(signedNoise(context.seed, 7_300 + carIndex, stopNumber)) * 0.8;
  }
  const risk = trafficRisk(context, car);
  const releaseDelaySeconds = issue === "SLOW_RELEASE" ? issueDelay : risk === "HIGH" ? 0.42 : risk === "MEDIUM" ? 0.16 : 0;
  const queueDelaySeconds = issue === "DOUBLE_STACK" ? issueDelay : 0;
  const serviceIssueDelay = issue === "WHEEL_GUN" ? issueDelay : 0;
  const tyreServiceSeconds = serviceSeconds + serviceIssueDelay;
  return {
    carId: car.carId,
    issue,
    stationarySeconds: tyreServiceSeconds + queueDelaySeconds + releaseDelaySeconds,
    tyreServiceSeconds,
    serviceSeconds,
    serviceIssueDelaySeconds: serviceIssueDelay,
    queueDelaySeconds,
    releaseDelaySeconds,
    doubleStackConflict,
  };
}

export function assessPitOperation(context: PitOperationsContext, carId: string, compound?: TyreCompound): PitOperationAssessment {
  const car = context.cars.find((candidate) => candidate.carId === carId);
  if (!car) throw new RangeError(`Unknown carId: ${carId}.`);
  const targetCompound = selectedCompound(car, compound);
  const tyreSetReady = hasPreparedSet(car, targetCompound);
  const execution = deterministicExecution(context, car);
  const traffic = trafficRisk(context, car);
  const activeOnTrack = !car.finished && car.incidentStatus !== "RETIRED" && car.pitStatus === "TRACK";
  const readiness: PitReadiness = !activeOnTrack || !context.pitLaneOpen || !tyreSetReady
    ? "BLOCKED"
    : execution.doubleStackConflict || traffic === "HIGH" ? "WATCH" : "READY";
  const reasons: string[] = [];
  if (car.finished) reasons.push("Race complete; no further pit call is available.");
  else if (car.incidentStatus === "RETIRED") reasons.push("Car retired; pit crew has stood down.");
  else if (car.pitStatus !== "TRACK") reasons.push(`${car.pitStatus.replace("_", " ")} sequence is already in progress.`);
  if (!context.pitLaneOpen) reasons.push("Pit lane is closed by Race Control.");
  if (!tyreSetReady) reasons.push(`No fresh ${targetCompound} set is prepared.`);
  if (execution.doubleStackConflict) reasons.push("Teammate occupancy creates a double-stack queue.");
  if (traffic !== "LOW") reasons.push(`${traffic.toLowerCase()} pit-lane release traffic.`);
  if (reasons.length === 0) reasons.push("Crew, tyre set and release window are ready.");
  return {
    carId,
    compound: targetCompound,
    readiness,
    tyreSetReady,
    doubleStackConflict: execution.doubleStackConflict,
    trafficRisk: traffic,
    predictedStationarySeconds: execution.stationarySeconds,
    predictedTotalLossSeconds: execution.stationarySeconds + (context.pitLaneOpen ? 19.8 : 99),
    predictedIssue: execution.issue,
    confidence: clamp(0.92 - (traffic === "HIGH" ? 0.18 : traffic === "MEDIUM" ? 0.08 : 0) - (execution.doubleStackConflict ? 0.12 : 0), 0.52, 0.96),
    reasons,
  };
}

export function resolvePitStopExecution(context: PitOperationsContext, carId: string): PitStopExecution {
  const car = context.cars.find((candidate) => candidate.carId === carId);
  if (!car) throw new RangeError(`Unknown carId: ${carId}.`);
  return deterministicExecution(context, car);
}
