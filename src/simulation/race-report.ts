import type { IncidentStatus, PitStopIssue, RacePenalty, RaceSnapshot, TyreCompound } from "@/domain/race";
import { DRIVER_BY_ID, DRIVERS, TEAM_BY_ID } from "@/fixtures/grid";
import type { RaceReplayRecording, ReplayEventSeverity, ReplayKeyEvent } from "@/simulation/race-replay";
import { resultPenaltySeconds } from "@/simulation/fia-2026-rules";

export type ClassificationStatus = "FINISHED" | "RETIRED" | "DISQUALIFIED" | "RUNNING";

export interface RaceClassificationEntry {
  position: number;
  /** Position at the chequered flag before steward adjustments. */
  onTrackPosition: number;
  carId: string;
  driverId: string;
  driverName: string;
  driverShortName: string;
  teamId: string;
  teamName: string;
  gridPosition: number;
  positionsGained: number;
  status: ClassificationStatus;
  rawRaceTimeSeconds: number;
  raceTimeSeconds: number;
  gapToWinnerSeconds: number;
  penaltySeconds: number;
  penalties: readonly RacePenalty[];
  bestLapTimeSeconds: number | null;
  pitStops: number;
  overtakes: number;
  damageLevel: number;
  retiredReason: string | null;
}

export interface FastestLapReport {
  carId: string;
  driverName: string;
  driverShortName: string;
  teamName: string;
  lapTimeSeconds: number;
}

export interface PitStopReport {
  carId: string;
  driverShortName: string;
  stopCount: number;
  recordedStopCount: number;
  lastStopTimeSeconds: number | null;
  bestStopTimeSeconds: number | null;
  issueCount: number;
  issues: readonly PitStopIssue[];
}

export interface TyreStrategyReport {
  carId: string;
  driverShortName: string;
  compounds: readonly TyreCompound[];
  stintCount: number;
  currentCompound: TyreCompound;
  currentTyreAgeLaps: number;
  strategyLabel: string;
}

export interface RaceIncidentReport {
  id: string;
  elapsedTime: number;
  carId: string | null;
  driverShortName: string | null;
  message: string;
  severity: ReplayEventSeverity;
  finalStatus: IncidentStatus | null;
}

export interface PlayerRaceReport {
  carId: string;
  driverName: string;
  driverShortName: string;
  finishPosition: number;
  gridPosition: number;
  positionsGained: number;
  overtakes: number;
  pitStops: number;
  tyreStrategy: readonly TyreCompound[];
  strategyEvents: readonly ReplayKeyEvent[];
  thermalWarnings: readonly ReplayKeyEvent[];
  criticalThermalWarningCount: number;
  incidentStatus: IncidentStatus;
  damageLevel: number;
}

export interface RaceReportTotals {
  classifiedCars: number;
  finishers: number;
  retirements: number;
  overtakes: number;
  pitStops: number;
  pitIssues: number;
  incidents: number;
  thermalWarnings: number;
  strategyCalls: number;
  penalties: number;
}

export interface RaceReport {
  seed: number;
  completed: boolean;
  elapsedTimeSeconds: number;
  winnerCarId: string | null;
  classification: readonly RaceClassificationEntry[];
  fastestLap: FastestLapReport | null;
  pitStops: readonly PitStopReport[];
  tyreStrategies: readonly TyreStrategyReport[];
  incidents: readonly RaceIncidentReport[];
  playerReports: readonly PlayerRaceReport[];
  strategyEvents: readonly ReplayKeyEvent[];
  thermalWarnings: readonly ReplayKeyEvent[];
  penalties: readonly RacePenalty[];
  totals: RaceReportTotals;
}

export interface BuildRaceReportOptions {
  recording?: RaceReplayRecording | null;
  /** Defaults to every driver belonging to a player-owned team. */
  playerCarIds?: readonly string[];
}

function positiveTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function dataString(event: ReplayKeyEvent, key: string): string | null {
  const value = event.data?.[key];
  return typeof value === "string" ? value : null;
}

function dataNumber(event: ReplayKeyEvent, key: string): number | null {
  const value = event.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultPlayerCarIds(snapshot: RaceSnapshot): string[] {
  return DRIVERS.filter((driver) => driver.teamId === snapshot.playerTeamId).map((driver) => driver.id);
}

function fallbackEventCarId(snapshot: RaceSnapshot, event: RaceSnapshot["events"][number]): string | null {
  if (event.carId !== undefined) return event.carId;
  if (event.type === "INCIDENT") return snapshot.activeIncident?.carId ?? null;
  if (event.type !== "THERMAL") return null;
  return snapshot.cars.find((car) => {
    const shortName = DRIVER_BY_ID.get(car.driverId)?.shortName;
    return shortName !== undefined && event.message.startsWith(`${shortName} `);
  })?.carId ?? null;
}

function eventFallback(snapshot: RaceSnapshot): ReplayKeyEvent[] {
  const raceEvents: ReplayKeyEvent[] = snapshot.events.map((event) => ({
    id: `race:${event.id}`,
    elapsedTime: event.elapsedTime,
    kind: event.type,
    message: event.message,
    carId: fallbackEventCarId(snapshot, event),
    severity: event.type === "INCIDENT" ? "CRITICAL" : event.type === "RACE_CONTROL" || event.type === "PIT" || event.type === "THERMAL" || event.type === "PENALTY" ? "WARNING" : "INFO",
  }));
  const radioEvents: ReplayKeyEvent[] = snapshot.radioMessages.map((message) => ({
    id: `radio:${message.id}`,
    elapsedTime: message.elapsedTime,
    kind: "RADIO",
    message: `${message.source}: ${message.message}`,
    carId: message.carId,
    severity: message.priority === "URGENT" ? "CRITICAL" : message.priority === "WARNING" ? "WARNING" : "INFO",
    data: { source: message.source },
  }));
  return [...raceEvents, ...radioEvents].sort((left, right) => left.elapsedTime - right.elapsedTime);
}

function carIdentity(car: RaceSnapshot["cars"][number]): {
  driverName: string;
  driverShortName: string;
  teamName: string;
} {
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  return {
    driverName: driver?.name ?? car.driverId,
    driverShortName: driver?.shortName ?? car.driverId.slice(0, 3).toUpperCase(),
    teamName: team?.name ?? car.teamId,
  };
}

function uniqueCompounds(compounds: readonly TyreCompound[], current: TyreCompound): TyreCompound[] {
  const result = [...compounds];
  if (result.length === 0 || result.at(-1) !== current) result.push(current);
  return result;
}

function classificationStatus(car: RaceSnapshot["cars"][number]): ClassificationStatus {
  if (car.finished && car.incidentStatus !== "RETIRED") return "FINISHED";
  if (car.incidentStatus === "RETIRED") return "RETIRED";
  return "RUNNING";
}

function pitIssue(value: string | null): value is PitStopIssue {
  return value === "SLOW_RELEASE" || value === "WHEEL_GUN" || value === "DOUBLE_STACK";
}

export function buildRaceReport(snapshot: RaceSnapshot, options: BuildRaceReportOptions = {}): RaceReport {
  const replayEvents = options.recording?.events ?? eventFallback(snapshot);
  const completed = snapshot.status === "FINISHED";
  const orderedCars = [...snapshot.cars].sort((left, right) => left.racePosition - right.racePosition || left.gridPosition - right.gridPosition);
  const penalties = snapshot.penalties ?? [];
  const rawClassification = orderedCars.map((car) => {
    const identity = carIdentity(car);
    const rawRaceTime = positiveTime(car.finishTime) ?? car.totalRaceTime;
    const carPenalties = penalties.filter((penalty) => penalty.carId === car.carId && penalty.status !== "EXPIRED");
    const disqualified = carPenalties.some((penalty) => penalty.type === "DISQUALIFICATION" && penalty.status !== "SERVED");
    const status: ClassificationStatus = disqualified ? "DISQUALIFIED" : classificationStatus(car);
    const penaltySeconds = carPenalties.reduce((total, penalty) => total + resultPenaltySeconds(penalty), 0);
    return {
      position: car.racePosition,
      onTrackPosition: car.racePosition,
      carId: car.carId,
      driverId: car.driverId,
      ...identity,
      teamId: car.teamId,
      gridPosition: car.gridPosition,
      positionsGained: 0,
      status,
      rawRaceTimeSeconds: rawRaceTime,
      raceTimeSeconds: rawRaceTime + (completed && status === "FINISHED" ? penaltySeconds : 0),
      gapToWinnerSeconds: Math.max(0, car.gapToLeader),
      penaltySeconds,
      penalties: carPenalties,
      bestLapTimeSeconds: positiveTime(car.bestLapTime),
      pitStops: car.pitStops,
      overtakes: car.overtakes,
      damageLevel: car.damageLevel,
      retiredReason: car.retiredReason,
    };
  });
  if (completed) {
    rawClassification.sort((left, right) => {
      const leftRank = left.status === "FINISHED" ? 0 : left.status === "RUNNING" ? 1 : left.status === "RETIRED" ? 2 : 3;
      const rightRank = right.status === "FINISHED" ? 0 : right.status === "RUNNING" ? 1 : right.status === "RETIRED" ? 2 : 3;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (left.status === "FINISHED" && right.status === "FINISHED") return left.raceTimeSeconds - right.raceTimeSeconds || left.onTrackPosition - right.onTrackPosition;
      return left.onTrackPosition - right.onTrackPosition;
    });
  }
  const winnerRaceTime = rawClassification.find((entry) => entry.status === "FINISHED")?.raceTimeSeconds ?? 0;
  const classification: RaceClassificationEntry[] = rawClassification.map((entry, index) => {
    const position = completed ? index + 1 : entry.onTrackPosition;
    return {
      ...entry,
      position,
      positionsGained: entry.gridPosition - position,
      gapToWinnerSeconds: position === 1 ? 0 : completed && entry.status === "FINISHED" && winnerRaceTime > 0
        ? Math.max(0, entry.raceTimeSeconds - winnerRaceTime)
        : entry.gapToWinnerSeconds,
    };
  });
  const leader = classification[0] ?? null;

  const fastestCar = orderedCars
    .filter((car) => positiveTime(car.bestLapTime) !== null)
    .sort((left, right) => left.bestLapTime! - right.bestLapTime!)[0];
  const fastestLap: FastestLapReport | null = fastestCar
    ? { carId: fastestCar.carId, ...carIdentity(fastestCar), lapTimeSeconds: fastestCar.bestLapTime! }
    : null;

  const pitStops: PitStopReport[] = orderedCars
    .filter((car) => car.pitStops > 0)
    .map((car) => {
      const identity = carIdentity(car);
      const events = replayEvents.filter((event) => event.kind === "PIT_STOP" && event.carId === car.carId);
      const recordedTimes = events.map((event) => dataNumber(event, "durationSeconds")).filter((value): value is number => value !== null && value > 0);
      const issues = events.map((event) => dataString(event, "issue")).filter(pitIssue);
      if (car.pitStopIssue !== "NONE" && !issues.includes(car.pitStopIssue)) issues.push(car.pitStopIssue);
      const lastStopTime = positiveTime(car.lastPitStopTime);
      if (lastStopTime !== null && recordedTimes.length === 0) recordedTimes.push(lastStopTime);
      return {
        carId: car.carId,
        driverShortName: identity.driverShortName,
        stopCount: car.pitStops,
        recordedStopCount: events.length,
        lastStopTimeSeconds: lastStopTime,
        bestStopTimeSeconds: recordedTimes.length > 0 ? Math.min(...recordedTimes) : null,
        issueCount: issues.length,
        issues,
      };
    });

  const tyreStrategies: TyreStrategyReport[] = orderedCars.map((car) => {
    const compounds = uniqueCompounds(car.usedTyreCompounds, car.tyreCompound);
    return {
      carId: car.carId,
      driverShortName: carIdentity(car).driverShortName,
      compounds,
      stintCount: Math.max(compounds.length, car.pitStops + 1),
      currentCompound: car.tyreCompound,
      currentTyreAgeLaps: car.tyreAgeLaps,
      strategyLabel: compounds.join(" → "),
    };
  });

  const incidentEvents = replayEvents.filter((event) => event.kind === "INCIDENT");
  const uniqueIncidentEvents = incidentEvents.filter((event, index) => !incidentEvents.slice(0, index).some((candidate) => (
    Math.abs(candidate.elapsedTime - event.elapsedTime) <= 0.5
      && (event.carId !== null ? candidate.carId === event.carId : candidate.carId === null && candidate.message === event.message)
  )));
  const incidents: RaceIncidentReport[] = uniqueIncidentEvents.map((event) => {
    const car = event.carId ? snapshot.cars.find((candidate) => candidate.carId === event.carId) : undefined;
    return {
      id: event.id,
      elapsedTime: event.elapsedTime,
      carId: event.carId,
      driverShortName: car ? carIdentity(car).driverShortName : null,
      message: event.message,
      severity: event.severity,
      finalStatus: car?.incidentStatus ?? null,
    };
  });
  for (const car of orderedCars.filter((candidate) => candidate.incidentStatus !== "RUNNING")) {
    if (incidents.some((incident) => incident.carId === car.carId)) continue;
    incidents.push({
      id: `final-incident:${car.carId}`,
      elapsedTime: snapshot.elapsedTime,
      carId: car.carId,
      driverShortName: carIdentity(car).driverShortName,
      message: car.retiredReason ?? `${car.incidentStatus.toLowerCase()} at the flag`,
      severity: car.incidentStatus === "RETIRED" ? "CRITICAL" : "WARNING",
      finalStatus: car.incidentStatus,
    });
  }
  incidents.sort((left, right) => left.elapsedTime - right.elapsedTime);

  const strategyEvents = replayEvents.filter((event) => event.kind === "STRATEGY");
  const derivedThermalWarnings = replayEvents.filter((event) => event.kind === "THERMAL_WARNING");
  const nativeThermalWarnings = replayEvents.filter((event) => event.kind === "THERMAL" && !derivedThermalWarnings.some((derived) => (
    derived.carId === event.carId && Math.abs(derived.elapsedTime - event.elapsedTime) < 0.5
  )));
  const thermalWarnings = [...derivedThermalWarnings, ...nativeThermalWarnings].sort((left, right) => left.elapsedTime - right.elapsedTime);
  const playerIds = new Set(options.playerCarIds ?? defaultPlayerCarIds(snapshot));
  const playerReports: PlayerRaceReport[] = orderedCars.filter((car) => playerIds.has(car.carId)).map((car) => {
    const identity = carIdentity(car);
    const classified = classification.find((entry) => entry.carId === car.carId);
    const tyreStrategy = tyreStrategies.find((strategy) => strategy.carId === car.carId)?.compounds ?? [car.tyreCompound];
    const playerWarnings = thermalWarnings.filter((event) => event.carId === car.carId);
    return {
      carId: car.carId,
      driverName: identity.driverName,
      driverShortName: identity.driverShortName,
      finishPosition: classified?.position ?? car.racePosition,
      gridPosition: car.gridPosition,
      positionsGained: classified?.positionsGained ?? car.gridPosition - car.racePosition,
      overtakes: car.overtakes,
      pitStops: car.pitStops,
      tyreStrategy,
      strategyEvents: strategyEvents.filter((event) => event.carId === car.carId || event.carId === null),
      thermalWarnings: playerWarnings,
      criticalThermalWarningCount: playerWarnings.filter((event) => event.severity === "CRITICAL").length,
      incidentStatus: car.incidentStatus,
      damageLevel: car.damageLevel,
    };
  });

  const pitIssueCount = pitStops.reduce((sum, stop) => sum + stop.issueCount, 0);
  return {
    seed: snapshot.seed,
    completed,
    elapsedTimeSeconds: completed && winnerRaceTime > 0 ? winnerRaceTime : snapshot.elapsedTime,
    winnerCarId: completed ? leader?.carId ?? null : null,
    classification,
    fastestLap,
    pitStops,
    tyreStrategies,
    incidents,
    playerReports,
    strategyEvents,
    thermalWarnings,
    penalties,
    totals: {
      classifiedCars: classification.length,
      finishers: classification.filter((entry) => entry.status === "FINISHED").length,
      retirements: classification.filter((entry) => entry.status === "RETIRED").length,
      overtakes: orderedCars.reduce((sum, car) => sum + car.overtakes, 0),
      pitStops: orderedCars.reduce((sum, car) => sum + car.pitStops, 0),
      pitIssues: pitIssueCount,
      incidents: incidents.length,
      thermalWarnings: thermalWarnings.length,
      strategyCalls: strategyEvents.length,
      penalties: penalties.length,
    },
  };
}
