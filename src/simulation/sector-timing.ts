export const SECTOR_TIME_TOLERANCE_SECONDS = 0.001;

export type SectorIndex = 0 | 1 | 2;
export type SectorTimingTone = "NEUTRAL" | "INVALID" | "PURPLE" | "GREEN" | "YELLOW";
export type SectorTimeTuple = [number | null, number | null, number | null];
export type SectorToneTuple = [SectorTimingTone, SectorTimingTone, SectorTimingTone];
export type SectorDriverTuple = [string | null, string | null, string | null];

export interface QualifyingDriverTimingState {
  currentSectorTimes: SectorTimeTuple;
  currentSectorTones: SectorToneTuple;
  personalBestSectorTimes: SectorTimeTuple;
  currentLapTimeSeconds: number | null;
  personalBestLapTimeSeconds: number | null;
  currentLapValid: boolean;
  currentLapCompetitive: boolean;
}

export interface QualifyingSessionTimingState {
  bestSectorTimes: SectorTimeTuple;
  bestSectorDriverIds: SectorDriverTuple;
  bestLapTimeSeconds: number | null;
  bestLapDriverId: string | null;
}

export interface SectorTimingComparison {
  timeSeconds: number | null;
  lapValid: boolean;
  competitive: boolean;
  personalBestSeconds: number | null;
  sessionBestSeconds: number | null;
}

export function emptySectorTimes(): SectorTimeTuple {
  return [null, null, null];
}

export function neutralSectorTones(): SectorToneTuple {
  return ["NEUTRAL", "NEUTRAL", "NEUTRAL"];
}

export function createQualifyingDriverTimingState(): QualifyingDriverTimingState {
  return {
    currentSectorTimes: emptySectorTimes(),
    currentSectorTones: neutralSectorTones(),
    personalBestSectorTimes: emptySectorTimes(),
    currentLapTimeSeconds: null,
    personalBestLapTimeSeconds: null,
    currentLapValid: true,
    currentLapCompetitive: false,
  };
}

export function createQualifyingSessionTimingState(): QualifyingSessionTimingState {
  return {
    bestSectorTimes: emptySectorTimes(),
    bestSectorDriverIds: [null, null, null],
    bestLapTimeSeconds: null,
    bestLapDriverId: null,
  };
}

export function isStrictlyFaster(candidateSeconds: number, referenceSeconds: number | null): boolean {
  return referenceSeconds === null || referenceSeconds - candidateSeconds > SECTOR_TIME_TOLERANCE_SECONDS + 1e-9;
}

export function isTimingTie(candidateSeconds: number, referenceSeconds: number | null): boolean {
  return referenceSeconds !== null && Math.abs(candidateSeconds - referenceSeconds) <= SECTOR_TIME_TOLERANCE_SECONDS + 1e-9;
}

/**
 * Classifies a sector against the records that existed before this sector arrived.
 * Callers must not mutate personal/session bests until after this result is captured.
 */
export function classifySectorTiming(comparison: SectorTimingComparison): SectorTimingTone {
  if (comparison.timeSeconds === null || !comparison.competitive) return "NEUTRAL";
  if (!comparison.lapValid) return "INVALID";
  if (isStrictlyFaster(comparison.timeSeconds, comparison.sessionBestSeconds)) return "PURPLE";
  if (isStrictlyFaster(comparison.timeSeconds, comparison.personalBestSeconds)) return "GREEN";
  return "YELLOW";
}

export function beginQualifyingLapTiming(
  timing: QualifyingDriverTimingState,
  competitive: boolean,
): QualifyingDriverTimingState {
  return {
    ...timing,
    currentSectorTimes: emptySectorTimes(),
    currentSectorTones: neutralSectorTones(),
    currentLapTimeSeconds: null,
    currentLapValid: true,
    currentLapCompetitive: competitive,
  };
}

export function recordProvisionalSector(
  timing: QualifyingDriverTimingState,
  sessionTiming: QualifyingSessionTimingState,
  sectorIndex: SectorIndex,
  timeSeconds: number,
): QualifyingDriverTimingState {
  const currentSectorTimes: SectorTimeTuple = [...timing.currentSectorTimes];
  const currentSectorTones: SectorToneTuple = [...timing.currentSectorTones];
  const roundedTime = Math.round(timeSeconds * 1_000) / 1_000;
  currentSectorTones[sectorIndex] = classifySectorTiming({
    timeSeconds: roundedTime,
    lapValid: timing.currentLapValid,
    competitive: timing.currentLapCompetitive,
    personalBestSeconds: timing.personalBestSectorTimes[sectorIndex],
    sessionBestSeconds: sessionTiming.bestSectorTimes[sectorIndex],
  });
  currentSectorTimes[sectorIndex] = roundedTime;
  return { ...timing, currentSectorTimes, currentSectorTones };
}

export function invalidateQualifyingLapTiming(timing: QualifyingDriverTimingState): QualifyingDriverTimingState {
  return {
    ...timing,
    currentLapValid: false,
    currentSectorTones: timing.currentSectorTimes.map((time) => time === null ? "NEUTRAL" : "INVALID") as SectorToneTuple,
  };
}

export function finalizeQualifyingLapTiming(
  driverId: string,
  timing: QualifyingDriverTimingState,
  sessionTiming: QualifyingSessionTimingState,
  lapTimeSeconds: number,
): { driverTiming: QualifyingDriverTimingState; sessionTiming: QualifyingSessionTimingState } {
  const currentLapTimeSeconds = Math.round(lapTimeSeconds * 1_000) / 1_000;
  if (!timing.currentLapValid || !timing.currentLapCompetitive || timing.currentSectorTimes.some((time) => time === null)) {
    return {
      driverTiming: { ...timing, currentLapTimeSeconds },
      sessionTiming,
    };
  }

  // Capture colors against the old records first. Updating before this loop would
  // compare each new value with itself and incorrectly turn records yellow.
  const currentSectorTones = timing.currentSectorTimes.map((time, index) => classifySectorTiming({
    timeSeconds: time,
    lapValid: true,
    competitive: true,
    personalBestSeconds: timing.personalBestSectorTimes[index],
    sessionBestSeconds: sessionTiming.bestSectorTimes[index],
  })) as SectorToneTuple;
  const personalBestSectorTimes: SectorTimeTuple = [...timing.personalBestSectorTimes];
  const bestSectorTimes: SectorTimeTuple = [...sessionTiming.bestSectorTimes];
  const bestSectorDriverIds: SectorDriverTuple = [...sessionTiming.bestSectorDriverIds];

  timing.currentSectorTimes.forEach((time, index) => {
    if (time === null) return;
    if (isStrictlyFaster(time, personalBestSectorTimes[index])) personalBestSectorTimes[index] = time;
    if (isStrictlyFaster(time, bestSectorTimes[index])) {
      bestSectorTimes[index] = time;
      bestSectorDriverIds[index] = driverId;
    }
  });
  const personalBestLapTimeSeconds = isStrictlyFaster(currentLapTimeSeconds, timing.personalBestLapTimeSeconds)
    ? currentLapTimeSeconds
    : timing.personalBestLapTimeSeconds;
  const sessionLapImproved = isStrictlyFaster(currentLapTimeSeconds, sessionTiming.bestLapTimeSeconds);

  return {
    driverTiming: {
      ...timing,
      currentSectorTones,
      personalBestSectorTimes,
      currentLapTimeSeconds,
      personalBestLapTimeSeconds,
    },
    sessionTiming: {
      ...sessionTiming,
      bestSectorTimes,
      bestSectorDriverIds,
      bestLapTimeSeconds: sessionLapImproved ? currentLapTimeSeconds : sessionTiming.bestLapTimeSeconds,
      bestLapDriverId: sessionLapImproved ? driverId : sessionTiming.bestLapDriverId,
    },
  };
}
