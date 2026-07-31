import type { TrackPoint } from "@/domain/race";
import { PIT_BOX_DISTANCE, PIT_ENTRY_START, PIT_EXIT_END } from "@/simulation/engine";
import { pointAtDistance, SILVERSTONE_CIRCUIT } from "@/simulation/track";
import type { QualifyingCarPhase, QualifyingCarState, QualifyingTrafficDecisionState } from "@/simulation/weekend";

export const QUALIFYING_TRACK_SAMPLE_COUNT = 512;
export const QUALIFYING_PIT_SAMPLE_COUNT = 96;
const QUALIFYING_PIT_ROUTE_METERS = SILVERSTONE_CIRCUIT.lengthMeters - PIT_ENTRY_START + PIT_EXIT_END;
export const QUALIFYING_PIT_BOX_PROGRESS = clamp01((PIT_BOX_DISTANCE - PIT_ENTRY_START) / QUALIFYING_PIT_ROUTE_METERS);

export interface QualifyingTrafficTarget {
  carId: string;
  progress: number;
  pitLane: boolean;
  phase: QualifyingCarPhase;
  /** An in-lap used to recover between two flying laps rather than to pit. */
  recoveryLap: boolean;
  yielding: boolean;
  decisionState: QualifyingTrafficDecisionState;
  conflictCarId: string | null;
  conflictGapSeconds: number | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizeTrackProgress(value: number): number {
  return ((value % 1) + 1) % 1;
}

function phaseProgress(car: QualifyingCarState): number {
  // Mirrors the engine: a held phase keeps its pinned fraction so the marker
  // does not rewind while the car waits.
  if (car.phaseHoldProgress !== undefined) return clamp01(car.phaseHoldProgress);
  if (car.phaseDurationSeconds <= 0) return 0;
  return clamp01(1 - car.phaseRemainingSeconds / car.phaseDurationSeconds);
}

/**
 * Converts the phase clock to one normalised lap coordinate. No SVG geometry
 * is touched here, so the animation layer only needs a number in [0, 1).
 */
export function qualifyingTrafficTarget(car: QualifyingCarState): QualifyingTrafficTarget | null {
  if (car.phase === "GARAGE") return null;

  const progress = phaseProgress(car);
  let normalizedProgress: number;
  let pitLane = false;

  if (car.phase === "OUT_LAP" && progress < 0.12) {
    pitLane = true;
    normalizedProgress = QUALIFYING_PIT_BOX_PROGRESS + (1 - QUALIFYING_PIT_BOX_PROGRESS) * (progress / 0.12);
  } else if (car.phase === "OUT_LAP") {
    const trackProgress = (progress - 0.12) / 0.88;
    normalizedProgress = (PIT_EXIT_END + (SILVERSTONE_CIRCUIT.lengthMeters - PIT_EXIT_END) * trackProgress) / SILVERSTONE_CIRCUIT.lengthMeters;
  } else if (car.phase === "PIT_ENTRY") {
    pitLane = true;
    normalizedProgress = QUALIFYING_PIT_BOX_PROGRESS * progress;
  } else if (car.phase === "IN_LAP" && car.flyingLapsRemaining > 0) {
    // Recovery in-lap: the car keeps circulating to the timing line.
    normalizedProgress = car.phaseStartProgress + (1 - car.phaseStartProgress) * progress;
  } else if (car.phase === "IN_LAP" || car.phase === "ABORTED_LAP") {
    const entryProgress = PIT_ENTRY_START / SILVERSTONE_CIRCUIT.lengthMeters;
    const distanceToEntry = normalizeTrackProgress(entryProgress - car.phaseStartProgress);
    normalizedProgress = normalizeTrackProgress(car.phaseStartProgress + distanceToEntry * progress);
  } else {
    normalizedProgress = progress;
  }

  return {
    carId: car.carId,
    progress: pitLane ? clamp01(normalizedProgress) : normalizeTrackProgress(normalizedProgress),
    pitLane,
    phase: car.phase,
    recoveryLap: car.phase === "IN_LAP" && car.flyingLapsRemaining > 0,
    yielding: car.yielding,
    decisionState: car.trafficDecisionState,
    conflictCarId: car.trafficConflictCarId,
    conflictGapSeconds: car.trafficConflictGapSeconds,
  };
}

export function activeQualifyingTrafficTargets(
  cars: Readonly<Record<string, QualifyingCarState>>,
): readonly QualifyingTrafficTarget[] {
  const targets: QualifyingTrafficTarget[] = [];
  for (const car of Object.values(cars)) {
    const target = qualifyingTrafficTarget(car);
    if (target) targets.push(target);
  }
  return targets;
}

function buildTrackSamples(): Float32Array {
  const samples = new Float32Array(QUALIFYING_TRACK_SAMPLE_COUNT * 2);
  for (let index = 0; index < QUALIFYING_TRACK_SAMPLE_COUNT; index += 1) {
    const point = pointAtDistance((index / QUALIFYING_TRACK_SAMPLE_COUNT) * SILVERSTONE_CIRCUIT.lengthMeters);
    samples[index * 2] = point.x;
    samples[index * 2 + 1] = point.y;
  }
  return samples;
}

function pitLanePoint(routeProgress: number): TrackPoint {
  const entry = pointAtDistance(PIT_ENTRY_START);
  const exit = pointAtDistance(PIT_EXIT_END);
  const chordX = exit.x - entry.x;
  const chordY = exit.y - entry.y;
  const magnitude = Math.max(0.000001, Math.hypot(chordX, chordY));
  const normalX = -chordY / magnitude;
  const normalY = chordX / magnitude;
  const mergeFraction = 0.12;
  const laneOffset = 0.015;
  const straightStart = {
    x: entry.x + chordX * mergeFraction + normalX * laneOffset,
    y: entry.y + chordY * mergeFraction + normalY * laneOffset,
  };
  const straightEnd = {
    x: entry.x + chordX * (1 - mergeFraction) + normalX * laneOffset,
    y: entry.y + chordY * (1 - mergeFraction) + normalY * laneOffset,
  };

  if (routeProgress <= mergeFraction) {
    const blend = routeProgress / mergeFraction;
    return { x: entry.x + (straightStart.x - entry.x) * blend, y: entry.y + (straightStart.y - entry.y) * blend };
  }
  if (routeProgress >= 1 - mergeFraction) {
    const blend = (routeProgress - (1 - mergeFraction)) / mergeFraction;
    return { x: straightEnd.x + (exit.x - straightEnd.x) * blend, y: straightEnd.y + (exit.y - straightEnd.y) * blend };
  }
  const blend = (routeProgress - mergeFraction) / (1 - mergeFraction * 2);
  return { x: straightStart.x + (straightEnd.x - straightStart.x) * blend, y: straightStart.y + (straightEnd.y - straightStart.y) * blend };
}

function buildPitSamples(): Float32Array {
  const samples = new Float32Array(QUALIFYING_PIT_SAMPLE_COUNT * 2);
  for (let index = 0; index < QUALIFYING_PIT_SAMPLE_COUNT; index += 1) {
    const point = pitLanePoint(index / (QUALIFYING_PIT_SAMPLE_COUNT - 1));
    samples[index * 2] = point.x;
    samples[index * 2 + 1] = point.y;
  }
  return samples;
}

// Built once at module initialisation. Frame rendering only performs an array
// lookup; it never asks the browser to measure or sample an SVG path.
export const QUALIFYING_TRACK_SAMPLES = buildTrackSamples();
export const QUALIFYING_PIT_SAMPLES = buildPitSamples();

export function sampledTrackPoint(progress: number): TrackPoint {
  const normalized = normalizeTrackProgress(progress);
  const index = Math.min(QUALIFYING_TRACK_SAMPLE_COUNT - 1, Math.floor(normalized * QUALIFYING_TRACK_SAMPLE_COUNT));
  return { x: QUALIFYING_TRACK_SAMPLES[index * 2], y: QUALIFYING_TRACK_SAMPLES[index * 2 + 1] };
}

export function sampledPitPoint(progress: number): TrackPoint {
  const routeProgress = clamp01(progress);
  const index = Math.min(QUALIFYING_PIT_SAMPLE_COUNT - 1, Math.floor(routeProgress * (QUALIFYING_PIT_SAMPLE_COUNT - 1)));
  return { x: QUALIFYING_PIT_SAMPLES[index * 2], y: QUALIFYING_PIT_SAMPLES[index * 2 + 1] };
}

export function interpolateTrackProgress(from: number, to: number, amount: number): number {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return normalizeTrackProgress(from + delta * clamp01(amount));
}
