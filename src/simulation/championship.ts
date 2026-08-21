export const CHAMPIONSHIP_POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export const DEFAULT_CHAMPIONSHIP_CIRCUIT_IDS = [
  "silverstone-grand-prix-circuit",
  "monza-grand-prix-circuit",
  "suzuka-grand-prix-circuit",
] as const;

export type ChampionshipStatus = "IN_PROGRESS" | "COMPLETED";

export type RoundClassificationStatus =
  | { readonly type: "FINISHED" }
  | {
      readonly type: "RETIRED";
      /** A retired car can remain officially classified after completing enough race distance. */
      readonly classified: boolean;
      readonly reason: string;
    };

export interface RoundClassificationEntry {
  readonly position: number;
  readonly driverId: string;
  readonly teamId: string;
  readonly status: RoundClassificationStatus;
}

export interface ChampionshipRoundResult {
  readonly roundNumber: number;
  readonly circuitId: string;
  readonly classification: readonly RoundClassificationEntry[];
  readonly fastestLapDriverId: string | null;
}

export interface ScheduledChampionshipRound {
  readonly roundNumber: number;
  readonly circuitId: string;
}

export interface ChampionshipState {
  readonly id: string;
  readonly schedule: readonly ScheduledChampionshipRound[];
  readonly roundResults: readonly ChampionshipRoundResult[];
  /** Zero-based index of the next round. Equal to schedule.length when complete. */
  readonly nextRoundIndex: number;
  readonly status: ChampionshipStatus;
}

export interface CreateChampionshipOptions {
  readonly id?: string;
  readonly circuitIds?: readonly string[];
}

interface StandingBase {
  readonly rank: number;
  readonly points: number;
  readonly wins: number;
  readonly starts: number;
  readonly finishes: number;
  readonly retirements: number;
  readonly classifiedRetirements: number;
  readonly fastestLaps: number;
  /** Index 0 stores P1 count, index 1 stores P2 count, and so on. */
  readonly finishCounts: readonly number[];
}

export interface DriverStanding extends StandingBase {
  readonly driverId: string;
  readonly teamId: string;
}

export interface TeamStanding extends StandingBase {
  readonly teamId: string;
}

interface MutableStanding {
  points: number;
  starts: number;
  finishes: number;
  retirements: number;
  classifiedRetirements: number;
  fastestLaps: number;
  finishCounts: number[];
}

export type ChampionshipErrorCode =
  | "EMPTY_SCHEDULE"
  | "INVALID_CIRCUIT_ID"
  | "ROUND_NOT_SCHEDULED"
  | "ROUND_OUT_OF_SEQUENCE"
  | "CIRCUIT_MISMATCH"
  | "CONFLICTING_ROUND_RESULT"
  | "EMPTY_CLASSIFICATION"
  | "INVALID_POSITION"
  | "DUPLICATE_POSITION"
  | "DUPLICATE_DRIVER"
  | "INVALID_DRIVER_ID"
  | "INVALID_TEAM_ID"
  | "INVALID_RETIREMENT_REASON"
  | "UNKNOWN_FASTEST_LAP_DRIVER";

export class ChampionshipError extends Error {
  readonly code: ChampionshipErrorCode;

  constructor(code: ChampionshipErrorCode, message: string) {
    super(message);
    this.name = "ChampionshipError";
    this.code = code;
  }
}

const DEFAULT_CHAMPIONSHIP_ID = "project-pitwall-mini-championship";

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function deterministicIdCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function cloneStatus(status: RoundClassificationStatus): RoundClassificationStatus {
  return status.type === "FINISHED"
    ? { type: "FINISHED" }
    : { type: "RETIRED", classified: status.classified, reason: status.reason };
}

function canonicalResult(result: ChampionshipRoundResult): ChampionshipRoundResult {
  return {
    roundNumber: result.roundNumber,
    circuitId: result.circuitId,
    fastestLapDriverId: result.fastestLapDriverId,
    classification: [...result.classification]
      .sort((left, right) => left.position - right.position)
      .map((entry) => ({
        position: entry.position,
        driverId: entry.driverId,
        teamId: entry.teamId,
        status: cloneStatus(entry.status),
      })),
  };
}

function resultSignature(result: ChampionshipRoundResult): string {
  const entries = [...result.classification]
    .sort((left, right) => left.position - right.position)
    .map((entry) => {
      const status = entry.status.type === "FINISHED"
        ? "FINISHED"
        : `RETIRED:${entry.status.classified ? "CLASSIFIED" : "UNCLASSIFIED"}:${entry.status.reason}`;
      return `${entry.position}:${entry.driverId}:${entry.teamId}:${status}`;
    })
    .join("|");
  return `${result.roundNumber}#${result.circuitId}#${result.fastestLapDriverId ?? ""}#${entries}`;
}

function validateRoundResult(result: ChampionshipRoundResult): void {
  if (result.classification.length === 0) {
    throw new ChampionshipError("EMPTY_CLASSIFICATION", "A round result must contain at least one classified entry.");
  }

  const positions = new Set<number>();
  const driverIds = new Set<string>();
  for (const entry of result.classification) {
    if (!Number.isSafeInteger(entry.position) || entry.position < 1) {
      throw new ChampionshipError("INVALID_POSITION", `Invalid classification position: ${entry.position}.`);
    }
    if (positions.has(entry.position)) {
      throw new ChampionshipError("DUPLICATE_POSITION", `Position ${entry.position} appears more than once.`);
    }
    if (!nonBlank(entry.driverId)) {
      throw new ChampionshipError("INVALID_DRIVER_ID", "Driver ids must not be blank.");
    }
    if (driverIds.has(entry.driverId)) {
      throw new ChampionshipError("DUPLICATE_DRIVER", `Driver ${entry.driverId} appears more than once.`);
    }
    if (!nonBlank(entry.teamId)) {
      throw new ChampionshipError("INVALID_TEAM_ID", `Driver ${entry.driverId} has a blank team id.`);
    }
    if (entry.status.type === "RETIRED" && !nonBlank(entry.status.reason)) {
      throw new ChampionshipError("INVALID_RETIREMENT_REASON", `Retired driver ${entry.driverId} needs a reason.`);
    }
    positions.add(entry.position);
    driverIds.add(entry.driverId);
  }

  if (result.fastestLapDriverId !== null && !driverIds.has(result.fastestLapDriverId)) {
    throw new ChampionshipError(
      "UNKNOWN_FASTEST_LAP_DRIVER",
      `Fastest-lap driver ${result.fastestLapDriverId} is not in the classification.`,
    );
  }
}

function emptyStanding(): MutableStanding {
  return {
    points: 0,
    starts: 0,
    finishes: 0,
    retirements: 0,
    classifiedRetirements: 0,
    fastestLaps: 0,
    finishCounts: [],
  };
}

function isOfficiallyClassified(entry: RoundClassificationEntry): boolean {
  return entry.status.type === "FINISHED" || entry.status.classified;
}

function fastestLapIsEligible(result: ChampionshipRoundResult, entry: RoundClassificationEntry): boolean {
  return result.fastestLapDriverId === entry.driverId
    && entry.position <= CHAMPIONSHIP_POINTS_BY_POSITION.length
    && isOfficiallyClassified(entry);
}

function addEntryToStanding(
  standing: MutableStanding,
  result: ChampionshipRoundResult,
  entry: RoundClassificationEntry,
): void {
  const classified = isOfficiallyClassified(entry);
  standing.starts += 1;
  if (entry.status.type === "FINISHED") standing.finishes += 1;
  else {
    standing.retirements += 1;
    if (entry.status.classified) standing.classifiedRetirements += 1;
  }

  if (classified) {
    standing.finishCounts[entry.position - 1] = (standing.finishCounts[entry.position - 1] ?? 0) + 1;
    standing.points += pointsForPosition(entry.position);
  }
  if (fastestLapIsEligible(result, entry)) {
    standing.fastestLaps += 1;
    standing.points += 1;
  }
}

function compareStanding(
  left: MutableStanding,
  right: MutableStanding,
  leftId: string,
  rightId: string,
): number {
  if (left.points !== right.points) return right.points - left.points;
  const countbackLength = Math.max(left.finishCounts.length, right.finishCounts.length);
  for (let index = 0; index < countbackLength; index += 1) {
    const difference = (right.finishCounts[index] ?? 0) - (left.finishCounts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return deterministicIdCompare(leftId, rightId);
}

function paddedFinishCounts(counts: readonly number[], length: number): number[] {
  return Array.from({ length }, (_, index) => counts[index] ?? 0);
}

export function createChampionship(options: CreateChampionshipOptions = {}): ChampionshipState {
  const circuitIds = options.circuitIds ?? DEFAULT_CHAMPIONSHIP_CIRCUIT_IDS;
  if (circuitIds.length === 0) {
    throw new ChampionshipError("EMPTY_SCHEDULE", "A championship must contain at least one round.");
  }
  if (circuitIds.some((circuitId) => !nonBlank(circuitId))) {
    throw new ChampionshipError("INVALID_CIRCUIT_ID", "Circuit ids must not be blank.");
  }

  return {
    id: options.id ?? DEFAULT_CHAMPIONSHIP_ID,
    schedule: circuitIds.map((circuitId, index) => ({ roundNumber: index + 1, circuitId })),
    roundResults: [],
    nextRoundIndex: 0,
    status: "IN_PROGRESS",
  };
}

export function pointsForPosition(position: number): number {
  if (!Number.isSafeInteger(position) || position < 1) return 0;
  return CHAMPIONSHIP_POINTS_BY_POSITION[position - 1] ?? 0;
}

export function currentChampionshipRound(state: ChampionshipState): ScheduledChampionshipRound | null {
  return state.schedule[state.nextRoundIndex] ?? null;
}

export function isChampionshipComplete(state: ChampionshipState): boolean {
  return state.status === "COMPLETED";
}

/**
 * Records the next official result and advances the championship automatically.
 * Replaying an identical result is intentionally idempotent; a conflicting result
 * for an already-recorded round is rejected so autosave/event retries cannot alter history.
 */
export function recordRoundResult(
  state: ChampionshipState,
  result: ChampionshipRoundResult,
): ChampionshipState {
  validateRoundResult(result);

  const prior = state.roundResults.find((candidate) => candidate.roundNumber === result.roundNumber);
  if (prior) {
    if (resultSignature(prior) === resultSignature(result)) return state;
    throw new ChampionshipError(
      "CONFLICTING_ROUND_RESULT",
      `Round ${result.roundNumber} already has a different official result.`,
    );
  }

  const scheduled = state.schedule.find((round) => round.roundNumber === result.roundNumber);
  if (!scheduled) {
    throw new ChampionshipError("ROUND_NOT_SCHEDULED", `Round ${result.roundNumber} is not in this championship.`);
  }
  const current = currentChampionshipRound(state);
  if (!current || current.roundNumber !== result.roundNumber) {
    throw new ChampionshipError(
      "ROUND_OUT_OF_SEQUENCE",
      `Round ${result.roundNumber} cannot be recorded before round ${current?.roundNumber ?? "completion"}.`,
    );
  }
  if (scheduled.circuitId !== result.circuitId) {
    throw new ChampionshipError(
      "CIRCUIT_MISMATCH",
      `Round ${result.roundNumber} expects ${scheduled.circuitId}, not ${result.circuitId}.`,
    );
  }

  const nextRoundIndex = state.nextRoundIndex + 1;
  return {
    ...state,
    roundResults: [...state.roundResults, canonicalResult(result)],
    nextRoundIndex,
    status: nextRoundIndex >= state.schedule.length ? "COMPLETED" : "IN_PROGRESS",
  };
}

export function driverStandings(state: ChampionshipState): readonly DriverStanding[] {
  const accumulated = new Map<string, { teamId: string; standing: MutableStanding }>();
  let maximumPosition = 0;

  for (const result of state.roundResults) {
    for (const entry of result.classification) {
      maximumPosition = Math.max(maximumPosition, entry.position);
      const existing = accumulated.get(entry.driverId);
      const standing = existing?.standing ?? emptyStanding();
      addEntryToStanding(standing, result, entry);
      accumulated.set(entry.driverId, { teamId: entry.teamId, standing });
    }
  }

  return [...accumulated.entries()]
    .sort(([leftId, left], [rightId, right]) => compareStanding(left.standing, right.standing, leftId, rightId))
    .map(([driverId, value], index) => ({
      rank: index + 1,
      driverId,
      teamId: value.teamId,
      points: value.standing.points,
      wins: value.standing.finishCounts[0] ?? 0,
      starts: value.standing.starts,
      finishes: value.standing.finishes,
      retirements: value.standing.retirements,
      classifiedRetirements: value.standing.classifiedRetirements,
      fastestLaps: value.standing.fastestLaps,
      finishCounts: paddedFinishCounts(value.standing.finishCounts, maximumPosition),
    }));
}

export function teamStandings(state: ChampionshipState): readonly TeamStanding[] {
  const accumulated = new Map<string, MutableStanding>();
  let maximumPosition = 0;

  for (const result of state.roundResults) {
    for (const entry of result.classification) {
      maximumPosition = Math.max(maximumPosition, entry.position);
      const standing = accumulated.get(entry.teamId) ?? emptyStanding();
      addEntryToStanding(standing, result, entry);
      accumulated.set(entry.teamId, standing);
    }
  }

  return [...accumulated.entries()]
    .sort(([leftId, left], [rightId, right]) => compareStanding(left, right, leftId, rightId))
    .map(([teamId, standing], index) => ({
      rank: index + 1,
      teamId,
      points: standing.points,
      wins: standing.finishCounts[0] ?? 0,
      starts: standing.starts,
      finishes: standing.finishes,
      retirements: standing.retirements,
      classifiedRetirements: standing.classifiedRetirements,
      fastestLaps: standing.fastestLaps,
      finishCounts: paddedFinishCounts(standing.finishCounts, maximumPosition),
    }));
}
