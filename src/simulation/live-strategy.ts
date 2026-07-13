import type {
  PitStatus,
  RaceCarState,
  RaceControlStatus,
  TyreCompound,
  TyreSetState,
  WeatherState,
} from "@/domain/race";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { estimateTyreCrossover, type TyreCrossoverEstimate } from "@/simulation/tyre-crossover";

export type LiveStrategyCall = "BOX_NOW" | "STAY_OUT" | "COVER" | "EXTEND";
export type TrafficLevel = "LOW" | "MEDIUM" | "HIGH";
export type DoubleStackRisk = "NONE" | "WATCH" | "CONFLICT";
export type BattleStrategy = "UNDERCUT" | "OVERCUT" | "NEUTRAL";

export type LiveStrategyCar = Pick<
  RaceCarState,
  | "carId"
  | "teamId"
  | "racePosition"
  | "currentLap"
  | "totalDistance"
  | "gapToLeader"
  | "gapToCarAhead"
  | "gapToCarBehind"
  | "currentSpeed"
  | "tyreCompound"
  | "tyreAgeLaps"
  | "tyreLife"
  | "tyreSets"
  | "pitStatus"
  | "scheduledPitCompound"
  | "finished"
>;

export interface LiveStrategyContext {
  raceControl: RaceControlStatus;
  pitLaneOpen: boolean;
  weather: WeatherState;
  cars: readonly LiveStrategyCar[];
  totalLaps?: number;
}

export interface PitLossProjection {
  byRaceControl: Readonly<Record<RaceControlStatus, number>>;
  baseSeconds: number;
  doubleStackDelaySeconds: number;
  expectedSeconds: number;
  greenFlagSavingSeconds: number;
  available: boolean;
}

export interface RejoinProjection {
  position: number;
  projectedGapToLeaderSeconds: number;
  gapAheadSeconds: number | null;
  gapBehindSeconds: number | null;
  trafficDensity: number;
  trafficLevel: TrafficLevel;
  nearbyCarIds: readonly string[];
}

export interface BattleProjection {
  targetCarId: string | null;
  undercutGainSeconds: number;
  undercutScore: number;
  undercutViable: boolean;
  overcutGainSeconds: number;
  overcutScore: number;
  overcutViable: boolean;
  preferred: BattleStrategy;
}

export interface DoubleStackProjection {
  risk: DoubleStackRisk;
  teammateCarId: string | null;
  queueDelaySeconds: number;
}

export interface LiveStrategyAssessment {
  carId: string;
  call: LiveStrategyCall;
  recommendedCompound: TyreCompound | null;
  confidence: number;
  pitLoss: PitLossProjection;
  rejoin: RejoinProjection;
  battle: BattleProjection;
  doubleStack: DoubleStackProjection;
  crossover: TyreCrossoverEstimate;
  reasons: readonly string[];
}

const RACE_CONTROLS: readonly RaceControlStatus[] = ["GREEN", "YELLOW", "VSC", "SAFETY_CAR"];
const PIT_STATUSES: readonly PitStatus[] = ["TRACK", "PIT_ENTRY", "PIT_LANE", "PIT_STOP", "PIT_EXIT"];
const COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

const BASE_PIT_LOSS_SECONDS: Readonly<Record<RaceControlStatus, number>> = {
  GREEN: 23,
  YELLOW: 20.8,
  VSC: 15.6,
  SAFETY_CAR: 11.8,
};

const REMAINING_PIT_LOSS_FACTOR: Readonly<Record<PitStatus, number>> = {
  TRACK: 1,
  PIT_ENTRY: 0.82,
  PIT_LANE: 0.52,
  PIT_STOP: 0.18,
  PIT_EXIT: 0,
};

const TRAFFIC_WINDOW_SECONDS = 4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assertFinite(label: string, value: number, minimum = -Infinity, maximum = Infinity): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
}

function assertTyreSet(carId: string, set: TyreSetState, index: number): void {
  if (!set || typeof set.id !== "string" || set.id.length === 0) {
    throw new TypeError(`cars[${carId}].tyreSets[${index}] must have a non-empty id.`);
  }
  if (!COMPOUNDS.includes(set.compound)) {
    throw new TypeError(`cars[${carId}].tyreSets[${index}] has an unsupported compound.`);
  }
  assertFinite(`cars[${carId}].tyreSets[${index}].condition`, set.condition, 0, 100);
  assertFinite(`cars[${carId}].tyreSets[${index}].lapsUsed`, set.lapsUsed, 0);
}

/**
 * Runtime validation is deliberate: strategy runs at a worker/UI boundary and
 * should fail loudly instead of turning one malformed telemetry value into NaN.
 */
export function validateLiveStrategyContext(context: LiveStrategyContext): void {
  if (!context || typeof context !== "object") throw new TypeError("Live strategy context is required.");
  if (!RACE_CONTROLS.includes(context.raceControl)) throw new TypeError("Unsupported race-control status.");
  if (typeof context.pitLaneOpen !== "boolean") throw new TypeError("pitLaneOpen must be a boolean.");
  if (!Array.isArray(context.cars) || context.cars.length === 0) throw new TypeError("At least one car is required.");

  const totalLaps = context.totalLaps ?? SILVERSTONE_CIRCUIT.totalLaps;
  assertFinite("totalLaps", totalLaps, 1);
  if (!Number.isInteger(totalLaps)) throw new RangeError("totalLaps must be an integer.");

  if (!context.weather || typeof context.weather !== "object") throw new TypeError("weather is required.");
  assertFinite("weather.rainIntensity", context.weather.rainIntensity, 0, 1);
  assertFinite("weather.trackWetness", context.weather.trackWetness, 0, 1);
  assertFinite("weather.airTemperature", context.weather.airTemperature);
  assertFinite("weather.trackTemperature", context.weather.trackTemperature);

  context.weather.forecast?.forEach((point, index) => {
    assertFinite(`weather.forecast[${index}].minutesAhead`, point.minutesAhead, 0);
    assertFinite(`weather.forecast[${index}].rainProbability`, point.rainProbability, 0, 1);
    assertFinite(`weather.forecast[${index}].rainIntensity`, point.rainIntensity, 0, 1);
    if (index > 0 && point.minutesAhead < context.weather.forecast![index - 1].minutesAhead) {
      throw new RangeError("weather.forecast must be ordered by minutesAhead.");
    }
  });

  context.weather.surfaceZones?.forEach((zone, index) => {
    assertFinite(`weather.surfaceZones[${index}].startDistance`, zone.startDistance, 0);
    assertFinite(`weather.surfaceZones[${index}].endDistance`, zone.endDistance, zone.startDistance);
    assertFinite(`weather.surfaceZones[${index}].rainIntensity`, zone.rainIntensity, 0, 1);
    assertFinite(`weather.surfaceZones[${index}].wetness`, zone.wetness, 0, 1);
    assertFinite(`weather.surfaceZones[${index}].standingWater`, zone.standingWater, 0, 1);
    assertFinite(`weather.surfaceZones[${index}].dryingLine`, zone.dryingLine, 0, 1);
    assertFinite(`weather.surfaceZones[${index}].drainage`, zone.drainage, 0, 1);
  });

  const ids = new Set<string>();
  for (const car of context.cars) {
    if (!car || typeof car.carId !== "string" || car.carId.length === 0) throw new TypeError("Every car must have a non-empty carId.");
    if (ids.has(car.carId)) throw new TypeError(`Duplicate carId: ${car.carId}.`);
    ids.add(car.carId);
    if (typeof car.teamId !== "string" || car.teamId.length === 0) throw new TypeError(`Car ${car.carId} must have a teamId.`);
    if (!PIT_STATUSES.includes(car.pitStatus)) throw new TypeError(`Car ${car.carId} has an unsupported pit status.`);
    if (!COMPOUNDS.includes(car.tyreCompound)) throw new TypeError(`Car ${car.carId} has an unsupported tyre compound.`);
    assertFinite(`cars[${car.carId}].racePosition`, car.racePosition, 1);
    assertFinite(`cars[${car.carId}].currentLap`, car.currentLap, 1, totalLaps);
    assertFinite(`cars[${car.carId}].totalDistance`, car.totalDistance);
    assertFinite(`cars[${car.carId}].gapToLeader`, car.gapToLeader, 0);
    assertFinite(`cars[${car.carId}].gapToCarAhead`, car.gapToCarAhead, 0);
    assertFinite(`cars[${car.carId}].gapToCarBehind`, car.gapToCarBehind, 0);
    assertFinite(`cars[${car.carId}].currentSpeed`, car.currentSpeed, 0);
    assertFinite(`cars[${car.carId}].tyreAgeLaps`, car.tyreAgeLaps, 0);
    assertFinite(`cars[${car.carId}].tyreLife`, car.tyreLife, 0, 100);
    if (!Array.isArray(car.tyreSets)) throw new TypeError(`Car ${car.carId} must provide tyreSets.`);
    car.tyreSets.forEach((set: TyreSetState, index: number) => assertTyreSet(car.carId, set, index));
  }
}

export function estimateLivePitLossSeconds(
  raceControl: RaceControlStatus,
  doubleStackDelaySeconds = 0,
): number {
  if (!RACE_CONTROLS.includes(raceControl)) throw new TypeError("Unsupported race-control status.");
  assertFinite("doubleStackDelaySeconds", doubleStackDelaySeconds, 0);
  return round(BASE_PIT_LOSS_SECONDS[raceControl] + doubleStackDelaySeconds);
}

function availableCompounds(car: LiveStrategyCar): TyreCompound[] {
  const available = new Set(
    car.tyreSets
      .filter((set) => set.status === "AVAILABLE" || set.status === "RESERVED")
      .map((set) => set.compound),
  );
  return COMPOUNDS.filter((compound) => available.has(compound));
}

function doubleStackProjection(context: LiveStrategyContext, car: LiveStrategyCar): DoubleStackProjection {
  const candidates = context.cars
    .filter((candidate) => candidate.carId !== car.carId && candidate.teamId === car.teamId && !candidate.finished)
    .map((teammate) => {
      const timingGap = Math.abs(teammate.gapToLeader - car.gapToLeader);
      if (teammate.pitStatus === "PIT_STOP") return { teammate, risk: "CONFLICT" as const, delay: 3.4 };
      if (teammate.pitStatus === "PIT_LANE") return { teammate, risk: "CONFLICT" as const, delay: 2.7 };
      if (teammate.pitStatus === "PIT_ENTRY") return { teammate, risk: "CONFLICT" as const, delay: 2.2 };
      if (teammate.scheduledPitCompound && teammate.currentLap === car.currentLap && timingGap <= 18) {
        return { teammate, risk: "CONFLICT" as const, delay: 1.8 };
      }
      if (teammate.pitStatus === "PIT_EXIT" || teammate.scheduledPitCompound) {
        return { teammate, risk: "WATCH" as const, delay: 0.6 };
      }
      return { teammate, risk: "NONE" as const, delay: 0 };
    })
    .sort((left, right) => right.delay - left.delay || left.teammate.carId.localeCompare(right.teammate.carId));
  const highest = candidates[0];
  return highest
    ? { risk: highest.risk, teammateCarId: highest.teammate.carId, queueDelaySeconds: highest.delay }
    : { risk: "NONE", teammateCarId: null, queueDelaySeconds: 0 };
}

function currentRaceGapSeconds(cars: readonly LiveStrategyCar[], car: LiveStrategyCar): number {
  if (car.racePosition === 1) return 0;
  if (car.gapToLeader > 0) return car.gapToLeader;
  const leader = [...cars].sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId))[0];
  const averageSpeedMps = Math.max(30, (leader.currentSpeed + car.currentSpeed) / 7.2);
  return Math.max(0, (leader.totalDistance - car.totalDistance) / averageSpeedMps);
}

function projectRejoin(
  context: LiveStrategyContext,
  car: LiveStrategyCar,
  expectedPitLossSeconds: number,
): RejoinProjection {
  const remainingPitLossSeconds = expectedPitLossSeconds * REMAINING_PIT_LOSS_FACTOR[car.pitStatus];
  const projectedGap = currentRaceGapSeconds(context.cars, car) + remainingPitLossSeconds;
  const field = context.cars
    .filter((candidate) => !candidate.finished)
    .map((candidate) => ({
      carId: candidate.carId,
      gap: candidate.carId === car.carId ? projectedGap : currentRaceGapSeconds(context.cars, candidate),
    }))
    .sort((left, right) => left.gap - right.gap || left.carId.localeCompare(right.carId));
  const index = field.findIndex((candidate) => candidate.carId === car.carId);
  const ahead = index > 0 ? field[index - 1] : null;
  const behind = index >= 0 && index < field.length - 1 ? field[index + 1] : null;
  const nearby = field
    .filter((candidate) => candidate.carId !== car.carId && Math.abs(candidate.gap - projectedGap) <= TRAFFIC_WINDOW_SECONDS)
    .sort((left, right) => Math.abs(left.gap - projectedGap) - Math.abs(right.gap - projectedGap) || left.carId.localeCompare(right.carId));
  const closestGap = nearby[0] ? Math.abs(nearby[0].gap - projectedGap) : TRAFFIC_WINDOW_SECONDS;
  const trafficDensity = clamp(nearby.length / 4 + (TRAFFIC_WINDOW_SECONDS - closestGap) / 16, 0, 1);
  const trafficLevel: TrafficLevel = nearby.length >= 3 || closestGap < 0.8
    ? "HIGH"
    : nearby.length > 0 || closestGap < 2.5
      ? "MEDIUM"
      : "LOW";

  return {
    position: index + 1,
    projectedGapToLeaderSeconds: round(projectedGap),
    gapAheadSeconds: ahead ? round(projectedGap - ahead.gap) : null,
    gapBehindSeconds: behind ? round(behind.gap - projectedGap) : null,
    trafficDensity: round(trafficDensity),
    trafficLevel,
    nearbyCarIds: nearby.map((candidate) => candidate.carId),
  };
}

function battleProjection(
  context: LiveStrategyContext,
  car: LiveStrategyCar,
  rejoin: RejoinProjection,
): BattleProjection {
  const order = [...context.cars]
    .filter((candidate) => !candidate.finished)
    .sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId));
  const carIndex = order.findIndex((candidate) => candidate.carId === car.carId);
  const ahead = carIndex > 0 ? order[carIndex - 1] : null;
  const gapAhead = ahead ? Math.max(car.gapToCarAhead, Math.abs(car.gapToLeader - ahead.gapToLeader)) : Infinity;
  const freshTyreDelta = clamp((100 - car.tyreLife) * 0.018 + car.tyreAgeLaps * 0.035, 0, 2.7);
  const trafficPenalty = rejoin.trafficDensity * 1.25;
  const undercutGain = ahead
    ? clamp(0.2 + freshTyreDelta * 0.85 - trafficPenalty - Math.max(0, gapAhead - 2.5) * 0.22, 0, 3.2)
    : 0;
  const undercutScore = ahead
    ? clamp((3.8 - gapAhead) / 3.8 * 0.52 + undercutGain / 3.2 * 0.48, 0, 1)
    : 0;
  const tyreLifeAdvantage = ahead ? clamp((car.tyreLife - ahead.tyreLife) * 0.025, -0.5, 1) : 0;
  const aheadLikelyPitting = Boolean(ahead?.scheduledPitCompound || ahead?.pitStatus !== "TRACK");
  const overcutGain = ahead
    ? clamp(0.15 + tyreLifeAdvantage + (aheadLikelyPitting ? 0.55 : 0) + rejoin.trafficDensity * 0.45 - Math.max(0, 55 - car.tyreLife) * 0.025, 0, 2.6)
    : 0;
  const overcutScore = ahead
    ? clamp(overcutGain / 2.6 * 0.72 + (car.tyreLife / 100) * 0.18 + rejoin.trafficDensity * 0.1, 0, 1)
    : 0;
  const undercutViable = Boolean(ahead && gapAhead <= 3.8 && undercutScore >= 0.44 && rejoin.trafficLevel !== "HIGH");
  const overcutViable = Boolean(ahead && overcutScore >= 0.38 && car.tyreLife >= 42);
  const preferred: BattleStrategy = undercutViable && undercutScore >= overcutScore
    ? "UNDERCUT"
    : overcutViable
      ? "OVERCUT"
      : "NEUTRAL";

  return {
    targetCarId: ahead?.carId ?? null,
    undercutGainSeconds: round(undercutGain),
    undercutScore: round(undercutScore),
    undercutViable,
    overcutGainSeconds: round(overcutGain),
    overcutScore: round(overcutScore),
    overcutViable,
    preferred,
  };
}

function recommendedAvailableCompound(
  crossover: TyreCrossoverEstimate,
  available: readonly TyreCompound[],
): TyreCompound | null {
  const allowed = new Set(available);
  return crossover.compounds.find((estimate) => allowed.has(estimate.compound))?.compound ?? null;
}

function strategicCall(
  context: LiveStrategyContext,
  car: LiveStrategyCar,
  recommendedCompound: TyreCompound | null,
  crossover: TyreCrossoverEstimate,
  rejoin: RejoinProjection,
  battle: BattleProjection,
  doubleStack: DoubleStackProjection,
  remainingLaps: number,
): LiveStrategyCall {
  const canPit = context.pitLaneOpen
    && car.pitStatus === "TRACK"
    && !car.finished
    && remainingLaps > 0
    && recommendedCompound !== null;
  if (!canPit) return "STAY_OUT";

  const urgentWeather = crossover.shouldPit && crossover.netRaceGainSeconds >= 2.5;
  const tyreCritical = car.tyreLife <= 28;
  if (urgentWeather || tyreCritical) return "BOX_NOW";
  if (doubleStack.risk === "CONFLICT") return "EXTEND";

  const cheapStop = context.raceControl === "VSC" || context.raceControl === "SAFETY_CAR";
  if (cheapStop && car.tyreLife <= 72 && remainingLaps >= 3) return "BOX_NOW";
  if (battle.preferred === "UNDERCUT") return "BOX_NOW";

  const order = [...context.cars].sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId));
  const index = order.findIndex((candidate) => candidate.carId === car.carId);
  const behind = index >= 0 ? order[index + 1] : undefined;
  const coverThreat = Boolean(behind
    && car.gapToCarBehind <= 2.2
    && (behind.scheduledPitCompound || behind.tyreLife > car.tyreLife + 8));
  if (coverThreat && car.tyreLife <= 68) return "COVER";
  if ((rejoin.trafficLevel === "HIGH" || battle.preferred === "OVERCUT") && car.tyreLife > 35) return "EXTEND";
  if (car.tyreLife >= 70) return "EXTEND";
  return "STAY_OUT";
}

function decisionReasons(
  context: LiveStrategyContext,
  car: LiveStrategyCar,
  call: LiveStrategyCall,
  crossover: TyreCrossoverEstimate,
  rejoin: RejoinProjection,
  battle: BattleProjection,
  doubleStack: DoubleStackProjection,
  pitLoss: PitLossProjection,
): readonly string[] {
  const reasons: string[] = [];
  if (!context.pitLaneOpen) reasons.push("Pit lane is closed by Race Control.");
  if (crossover.shouldPit) {
    reasons.push(`${crossover.recommendedCompound} crossover is worth ${crossover.netRaceGainSeconds.toFixed(1)}s net.`);
  }
  if (context.raceControl !== "GREEN") {
    reasons.push(`${context.raceControl.replace("_", " ")} saves ${pitLoss.greenFlagSavingSeconds.toFixed(1)}s in pit loss.`);
  }
  if (doubleStack.risk !== "NONE") {
    reasons.push(`Double-stack with ${doubleStack.teammateCarId} adds ${doubleStack.queueDelaySeconds.toFixed(1)}s.`);
  }
  if (rejoin.trafficLevel === "HIGH") reasons.push(`High rejoin traffic around P${rejoin.position}.`);
  if (battle.preferred === "UNDERCUT") reasons.push(`${battle.undercutGainSeconds.toFixed(1)}s undercut opportunity on ${battle.targetCarId}.`);
  if (battle.preferred === "OVERCUT") reasons.push(`${battle.overcutGainSeconds.toFixed(1)}s overcut opportunity on ${battle.targetCarId}.`);
  if (car.tyreLife <= 28) reasons.push(`Tyre life is critical at ${Math.round(car.tyreLife)}%.`);
  if (call === "COVER" && reasons.length === 0) reasons.push("Cover the car behind before its pit window.");
  if (call === "EXTEND" && reasons.length === 0) reasons.push("Tyre life supports extending the stint.");
  if (call === "STAY_OUT" && reasons.length === 0) reasons.push("No pit window currently repays the stop loss.");
  return reasons.slice(0, 3);
}

function decisionConfidence(
  call: LiveStrategyCall,
  car: LiveStrategyCar,
  crossover: TyreCrossoverEstimate,
  rejoin: RejoinProjection,
  doubleStack: DoubleStackProjection,
  pitLaneOpen: boolean,
): number {
  let confidence = 0.54 + crossover.confidence * 0.16;
  if (!pitLaneOpen || car.pitStatus !== "TRACK") confidence += 0.22;
  if (crossover.shouldPit) confidence += Math.min(0.15, crossover.netRaceGainSeconds * 0.008);
  if (car.tyreLife <= 28) confidence += 0.14;
  if (call === "EXTEND" && doubleStack.risk === "CONFLICT") confidence += 0.12;
  if (rejoin.trafficLevel === "HIGH") confidence += call === "EXTEND" ? 0.08 : -0.05;
  return round(clamp(confidence, 0.35, 0.97));
}

/**
 * Produces one deterministic pit-wall decision for the requested car. The
 * calculation is pure and has no dependency on the simulation engine.
 */
export function calculateLiveStrategy(
  context: LiveStrategyContext,
  carId: string,
): LiveStrategyAssessment {
  validateLiveStrategyContext(context);
  if (typeof carId !== "string" || carId.length === 0) throw new TypeError("carId is required.");
  const car = context.cars.find((candidate) => candidate.carId === carId);
  if (!car) throw new RangeError(`Unknown carId: ${carId}.`);

  const totalLaps = context.totalLaps ?? SILVERSTONE_CIRCUIT.totalLaps;
  const remainingLaps = car.finished ? 0 : Math.max(0, totalLaps - car.currentLap + 1);
  const doubleStack = doubleStackProjection(context, car);
  const byRaceControl = Object.fromEntries(
    RACE_CONTROLS.map((control) => [control, estimateLivePitLossSeconds(control, doubleStack.queueDelaySeconds)]),
  ) as Record<RaceControlStatus, number>;
  const baseSeconds = BASE_PIT_LOSS_SECONDS[context.raceControl];
  const expectedSeconds = byRaceControl[context.raceControl];
  const pitLoss: PitLossProjection = {
    byRaceControl,
    baseSeconds,
    doubleStackDelaySeconds: doubleStack.queueDelaySeconds,
    expectedSeconds,
    greenFlagSavingSeconds: round(BASE_PIT_LOSS_SECONDS.GREEN - baseSeconds),
    available: context.pitLaneOpen && car.pitStatus === "TRACK" && !car.finished,
  };
  const available = availableCompounds(car);
  const crossover = estimateTyreCrossover({
    weather: context.weather,
    currentCompound: car.tyreCompound,
    availableCompounds: available,
    remainingLaps,
    pitLossSeconds: expectedSeconds,
  });
  const recommendedCompound = recommendedAvailableCompound(crossover, available);
  const rejoin = projectRejoin(context, car, expectedSeconds);
  const battle = battleProjection(context, car, rejoin);
  const call = strategicCall(
    context,
    car,
    recommendedCompound,
    crossover,
    rejoin,
    battle,
    doubleStack,
    remainingLaps,
  );

  return {
    carId,
    call,
    recommendedCompound,
    confidence: decisionConfidence(call, car, crossover, rejoin, doubleStack, context.pitLaneOpen),
    pitLoss,
    rejoin,
    battle,
    doubleStack,
    crossover,
    reasons: decisionReasons(context, car, call, crossover, rejoin, battle, doubleStack, pitLoss),
  };
}

/** Returns stable race-order assessments for every car in the supplied field. */
export function calculateFieldLiveStrategies(context: LiveStrategyContext): readonly LiveStrategyAssessment[] {
  validateLiveStrategyContext(context);
  return [...context.cars]
    .sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId))
    .map((car) => calculateLiveStrategy(context, car.carId));
}
