import type {
  RaceCarState,
  TyreCompound,
  TyreTemperatureState,
} from "@/domain/race";
import {
  calculateLiveStrategy,
  estimateLivePitLossSeconds,
  type LiveStrategyAssessment,
  type LiveStrategyCar,
  type LiveStrategyContext,
  type TrafficLevel,
} from "@/simulation/live-strategy";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

export type StrategyScenarioKind = "BOX_NOW" | "STAY_OUT" | "UNDERCUT" | "OVERCUT";
export type StrategyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type OpportunityState = "CAPTURED" | "MISSED" | "NONE";

type StrategyTelemetry = Partial<Pick<
  RaceCarState,
  | "totalRaceTime"
  | "tyreTemperatures"
  | "tyreTemperature"
  | "brakeTemperature"
  | "powerUnitTemperature"
  | "gearboxTemperature"
  | "energyStoreTemperature"
  | "damageLevel"
  | "paceMode"
  | "energyMode"
>>;

export type StrategyIntelligenceCar = LiveStrategyCar & StrategyTelemetry;

export interface StrategyIntelligenceContext extends Omit<LiveStrategyContext, "cars"> {
  cars: readonly StrategyIntelligenceCar[];
  /** Simulation clock, used to expose a projected absolute finish time. */
  elapsedTime?: number;
}

export interface StrategyRiskAssessment {
  level: StrategyRiskLevel;
  score: number;
  reason: string;
}

export interface StrategyOpportunity {
  state: OpportunityState;
  valueSeconds: number;
  reason: string;
}

export interface StrategyTrafficAssessment {
  level: TrafficLevel;
  density: number;
  nearbyCarIds: readonly string[];
}

export interface StrategyScenario {
  id: StrategyScenarioKind;
  label: string;
  compound: TyreCompound;
  feasible: boolean;
  rank: number;
  projectedRemainingTimeSeconds: number;
  projectedTotalRaceTimeSeconds: number;
  /** Difference to the quickest feasible scenario; zero is best. */
  projectedFinishTimeDeltaSeconds: number;
  predictedRejoinPosition: number | null;
  predictedFinishPosition: number;
  traffic: StrategyTrafficAssessment;
  tyreRisk: StrategyRiskAssessment;
  thermalRisk: StrategyRiskAssessment;
  safetyCarOpportunity: StrategyOpportunity;
  weatherOpportunity: StrategyOpportunity;
  confidence: number;
  reasons: readonly string[];
  recommended: boolean;
}

export interface StrategyIntelligenceAssessment {
  carId: string;
  generatedAtSeconds: number;
  remainingLaps: number;
  recommendedScenarioId: StrategyScenarioKind;
  recommendedCompound: TyreCompound;
  confidence: number;
  scenarios: readonly StrategyScenario[];
  liveStrategy: LiveStrategyAssessment;
}

const SCENARIO_ORDER: readonly StrategyScenarioKind[] = ["BOX_NOW", "STAY_OUT", "UNDERCUT", "OVERCUT"];
const COMPOUND_WEAR_PER_LAP: Readonly<Record<TyreCompound, number>> = {
  SOFT: 3.5,
  MEDIUM: 3,
  HARD: 2.45,
  INTERMEDIATE: 3.15,
  WET: 2.8,
};

const IDEAL_TYRE_TEMPERATURE: Readonly<Record<TyreCompound, readonly [number, number]>> = {
  SOFT: [92, 108],
  MEDIUM: [88, 104],
  HARD: [84, 100],
  INTERMEDIATE: [68, 85],
  WET: [58, 75],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assertOptionalFinite(label: string, value: number | undefined, minimum = -Infinity, maximum = Infinity): void {
  if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new RangeError(`${label} must be a finite number between ${minimum} and ${maximum}.`);
  }
}

function validateTelemetry(context: StrategyIntelligenceContext): void {
  assertOptionalFinite("elapsedTime", context.elapsedTime, 0);
  for (const car of context.cars) {
    assertOptionalFinite(`cars[${car.carId}].totalRaceTime`, car.totalRaceTime, 0);
    assertOptionalFinite(`cars[${car.carId}].tyreTemperature`, car.tyreTemperature, 0, 200);
    assertOptionalFinite(`cars[${car.carId}].brakeTemperature`, car.brakeTemperature, 0, 1_500);
    assertOptionalFinite(`cars[${car.carId}].powerUnitTemperature`, car.powerUnitTemperature, 0, 200);
    assertOptionalFinite(`cars[${car.carId}].gearboxTemperature`, car.gearboxTemperature, 0, 200);
    assertOptionalFinite(`cars[${car.carId}].energyStoreTemperature`, car.energyStoreTemperature, 0, 120);
    assertOptionalFinite(`cars[${car.carId}].damageLevel`, car.damageLevel, 0, 1);
    if (car.tyreTemperatures) {
      (Object.entries(car.tyreTemperatures) as [keyof TyreTemperatureState, number][]).forEach(([wheel, value]) => {
        assertOptionalFinite(`cars[${car.carId}].tyreTemperatures.${wheel}`, value, 0, 200);
      });
    }
  }
}

function riskLevel(score: number): StrategyRiskLevel {
  if (score >= 0.84) return "CRITICAL";
  if (score >= 0.58) return "HIGH";
  if (score >= 0.3) return "MEDIUM";
  return "LOW";
}

function scenarioTyreRisk(
  car: StrategyIntelligenceCar,
  live: LiveStrategyAssessment,
  kind: StrategyScenarioKind,
  remainingLaps: number,
): StrategyRiskAssessment {
  const isImmediateStop = kind === "BOX_NOW" || kind === "UNDERCUT";
  const extensionLaps = kind === "OVERCUT" ? Math.min(3, remainingLaps) : 0;
  const lifeAfterExtension = Math.max(0, car.tyreLife - extensionLaps * COMPOUND_WEAR_PER_LAP[car.tyreCompound]);
  const ageRisk = clamp((car.tyreAgeLaps - 10) / 30, 0, 0.55);
  const lifeRisk = clamp((58 - lifeAfterExtension) / 48, 0, 0.9);
  const weatherMismatch = live.crossover.shouldPit && live.crossover.recommendedCompound !== car.tyreCompound;
  let score = isImmediateStop ? 0.1 : 0.08 + ageRisk + lifeRisk;
  if (weatherMismatch && !isImmediateStop) score += 0.52;
  if (kind === "UNDERCUT") score += 0.08;
  if (kind === "OVERCUT") score += 0.1;

  const temperatures = car.tyreTemperatures
    ? Object.values(car.tyreTemperatures)
    : car.tyreTemperature === undefined ? [] : [car.tyreTemperature];
  if (!isImmediateStop && temperatures.length > 0) {
    const [minimum, maximum] = IDEAL_TYRE_TEMPERATURE[car.tyreCompound];
    const worstDeviation = Math.max(...temperatures.map((temperature) =>
      temperature < minimum ? minimum - temperature : Math.max(0, temperature - maximum),
    ));
    score += clamp(worstDeviation / 38, 0, 0.38);
  }
  score = round(clamp(score, 0, 1));

  const reason = weatherMismatch && !isImmediateStop
    ? `${car.tyreCompound} is beyond the ${live.crossover.recommendedCompound} crossover.`
    : isImmediateStop
      ? `Fresh ${live.recommendedCompound ?? car.tyreCompound} removes the current-stint wear risk.`
      : lifeAfterExtension <= 28
        ? `Projected tyre life falls to ${Math.round(lifeAfterExtension)}% before the stop.`
        : `Current stint remains near ${Math.round(lifeAfterExtension)}% life through this window.`;
  return { level: riskLevel(score), score, reason };
}

function thermalScore(car: StrategyIntelligenceCar): { score: number; system: string } {
  const candidates = [
    { system: "power unit", score: car.powerUnitTemperature === undefined ? 0 : clamp((car.powerUnitTemperature - 104) / 30, 0, 1) },
    { system: "gearbox", score: car.gearboxTemperature === undefined ? 0 : clamp((car.gearboxTemperature - 96) / 30, 0, 1) },
    { system: "energy store", score: car.energyStoreTemperature === undefined ? 0 : clamp((car.energyStoreTemperature - 46) / 22, 0, 1) },
    { system: "brakes", score: car.brakeTemperature === undefined ? 0 : clamp((car.brakeTemperature - 720) / 380, 0, 1) },
  ].sort((left, right) => right.score - left.score || left.system.localeCompare(right.system));
  const hottest = candidates[0];
  const damageContribution = clamp((car.damageLevel ?? 0) * 0.28, 0, 0.28);
  return { score: clamp((hottest?.score ?? 0) + damageContribution, 0, 1), system: hottest?.system ?? "car" };
}

function scenarioThermalRisk(car: StrategyIntelligenceCar, kind: StrategyScenarioKind): StrategyRiskAssessment {
  const current = thermalScore(car);
  const cooling = kind === "BOX_NOW" ? 0.22 : kind === "UNDERCUT" ? 0.12 : 0;
  const load = kind === "UNDERCUT" ? 0.12 : kind === "OVERCUT" ? 0.09 : kind === "STAY_OUT" ? 0.03 : 0;
  const score = round(clamp(current.score - cooling + load, 0, 1));
  const reason = score >= 0.58
    ? `${current.system} heat remains a performance risk in this scenario.`
    : cooling > 0
      ? `Pit-lane running gives the ${current.system} a cooling window.`
      : `${current.system} temperatures remain manageable at the projected load.`;
  return { level: riskLevel(score), score, reason };
}

function safetyCarOpportunity(
  context: StrategyIntelligenceContext,
  live: LiveStrategyAssessment,
  kind: StrategyScenarioKind,
): StrategyOpportunity {
  const active = context.raceControl === "VSC" || context.raceControl === "SAFETY_CAR";
  if (!active) return { state: "NONE", valueSeconds: 0, reason: "No neutralised-race pit window is active." };
  const captures = kind === "BOX_NOW" || kind === "UNDERCUT";
  return {
    state: captures ? "CAPTURED" : "MISSED",
    valueSeconds: live.pitLoss.greenFlagSavingSeconds,
    reason: captures
      ? `${context.raceControl.replace("_", " ")} saves ${live.pitLoss.greenFlagSavingSeconds.toFixed(1)}s of pit loss.`
      : `Delaying misses the ${live.pitLoss.greenFlagSavingSeconds.toFixed(1)}s neutralised-race saving.`,
  };
}

function weatherOpportunity(
  live: LiveStrategyAssessment,
  kind: StrategyScenarioKind,
): StrategyOpportunity {
  if (!live.crossover.shouldPit) {
    return { state: "NONE", valueSeconds: 0, reason: "No tyre crossover currently repays a stop." };
  }
  const captures = kind === "BOX_NOW" || kind === "UNDERCUT";
  return {
    state: captures ? "CAPTURED" : "MISSED",
    valueSeconds: live.crossover.netRaceGainSeconds,
    reason: captures
      ? `${live.crossover.recommendedCompound} captures ${live.crossover.netRaceGainSeconds.toFixed(1)}s of net weather gain.`
      : `Staying on ${live.crossover.currentCompound} gives up ${live.crossover.netRaceGainSeconds.toFixed(1)}s net.`,
  };
}

function gapToLeader(context: StrategyIntelligenceContext, car: StrategyIntelligenceCar): number {
  if (car.racePosition === 1) return 0;
  if (car.gapToLeader > 0) return car.gapToLeader;
  const leader = [...context.cars].sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId))[0];
  const metresPerSecond = Math.max(30, (leader.currentSpeed + car.currentSpeed) / 7.2);
  return Math.max(0, (leader.totalDistance - car.totalDistance) / metresPerSecond);
}

function fieldPositionAtGap(context: StrategyIntelligenceContext, car: StrategyIntelligenceCar, projectedGap: number): number {
  const field = context.cars
    .filter((candidate) => !candidate.finished)
    .map((candidate) => ({ carId: candidate.carId, gap: candidate.carId === car.carId ? projectedGap : gapToLeader(context, candidate) }))
    .sort((left, right) => left.gap - right.gap || left.carId.localeCompare(right.carId));
  return Math.max(1, field.findIndex((candidate) => candidate.carId === car.carId) + 1);
}

function trafficAtGap(context: StrategyIntelligenceContext, car: StrategyIntelligenceCar, projectedGap: number): StrategyTrafficAssessment {
  const nearby = context.cars
    .filter((candidate) => candidate.carId !== car.carId && !candidate.finished)
    .map((candidate) => ({ carId: candidate.carId, distance: Math.abs(gapToLeader(context, candidate) - projectedGap) }))
    .filter((candidate) => candidate.distance <= 4)
    .sort((left, right) => left.distance - right.distance || left.carId.localeCompare(right.carId));
  const closest = nearby[0]?.distance ?? 4;
  const density = round(clamp(nearby.length / 4 + (4 - closest) / 16, 0, 1));
  const level: TrafficLevel = nearby.length >= 3 || closest < 0.8 ? "HIGH" : nearby.length > 0 || closest < 2.5 ? "MEDIUM" : "LOW";
  return { level, density, nearbyCarIds: nearby.map((candidate) => candidate.carId) };
}

function currentTraffic(context: StrategyIntelligenceContext, car: StrategyIntelligenceCar): StrategyTrafficAssessment {
  return trafficAtGap(context, car, gapToLeader(context, car));
}

function measuredWearPerLap(car: StrategyIntelligenceCar): number {
  const observed = car.tyreAgeLaps > 1 ? (100 - car.tyreLife) / car.tyreAgeLaps : 0;
  return clamp(observed > 0 ? observed : COMPOUND_WEAR_PER_LAP[car.tyreCompound], 1.8, 7.5);
}

function scenarioReasons(
  kind: StrategyScenarioKind,
  live: LiveStrategyAssessment,
  traffic: StrategyTrafficAssessment,
  tyreRisk: StrategyRiskAssessment,
  thermalRisk: StrategyRiskAssessment,
  safety: StrategyOpportunity,
  weather: StrategyOpportunity,
): readonly string[] {
  const reasons: string[] = [];
  if (weather.state !== "NONE") reasons.push(weather.reason);
  if (safety.state !== "NONE") reasons.push(safety.reason);
  if (kind === "UNDERCUT") reasons.push(live.battle.undercutViable
    ? `${live.battle.undercutGainSeconds.toFixed(1)}s undercut window on ${live.battle.targetCarId}.`
    : "The undercut window is marginal at the current gap.");
  if (kind === "OVERCUT") reasons.push(live.battle.overcutViable
    ? `${live.battle.overcutGainSeconds.toFixed(1)}s overcut window on ${live.battle.targetCarId}.`
    : "The overcut needs clean air to repay the delayed stop.");
  if (traffic.level === "HIGH") reasons.push(`High traffic density is projected around the release window.`);
  if (tyreRisk.level === "HIGH" || tyreRisk.level === "CRITICAL") reasons.push(tyreRisk.reason);
  if (thermalRisk.level === "HIGH" || thermalRisk.level === "CRITICAL") reasons.push(thermalRisk.reason);
  if (reasons.length === 0) reasons.push(kind === "STAY_OUT"
    ? "Track position is worth more than an immediate stop."
    : `Projected ${kind === "BOX_NOW" ? "pit" : kind.toLowerCase()} window is strategically available.`);
  return reasons.slice(0, 3);
}

type ScenarioDraft = Omit<StrategyScenario, "rank" | "projectedFinishTimeDeltaSeconds" | "recommended">;

function buildDrafts(
  context: StrategyIntelligenceContext,
  car: StrategyIntelligenceCar,
  live: LiveStrategyAssessment,
  remainingLaps: number,
): readonly ScenarioDraft[] {
  const targetCompound = live.recommendedCompound ?? car.tyreCompound;
  const currentEstimate = live.crossover.compounds.find((estimate) => estimate.compound === car.tyreCompound)!;
  const targetEstimate = live.crossover.compounds.find((estimate) => estimate.compound === targetCompound) ?? currentEstimate;
  const clock = car.totalRaceTime ?? context.elapsedTime ?? 0;
  const wearPerLap = measuredWearPerLap(car);
  const lapsUntilCritical = Math.max(0, (car.tyreLife - 22) / wearPerLap);
  const needsLaterStop = remainingLaps > lapsUntilCritical;
  const currentWearPenalty = remainingLaps * (Math.max(0, 58 - car.tyreLife) * 0.022 + car.tyreAgeLaps * 0.008);
  const futureStopLoss = needsLaterStop ? estimateLivePitLossSeconds("GREEN") : 0;
  const baseStayTime = currentEstimate.projectedRaceSeconds + currentWearPenalty + futureStopLoss;
  const weatherCrossover = live.crossover.shouldPit && (
    live.crossover.recommendedCompound === "INTERMEDIATE"
      || live.crossover.recommendedCompound === "WET"
      || car.tyreCompound === "INTERMEDIATE"
      || car.tyreCompound === "WET"
  );
  const emergencyStopRequired = (car.damageLevel ?? 0) >= 0.25
    || (car.powerUnitTemperature ?? 0) >= 125
    || (car.gearboxTemperature ?? 0) >= 120
    || (car.energyStoreTemperature ?? 0) >= 63
    || (car.brakeTemperature ?? 0) >= 1_050;
  const prematureDryStop = context.raceControl === "GREEN"
    && !weatherCrossover
    && !emergencyStopRequired
    && car.tyreAgeLaps < 5
    && car.tyreLife > 75
    && remainingLaps > 30;
  // A fresh set fitted at the start of a dry race normally creates an extra
  // stop later. Price that lost track position so the model does not propose
  // an unrealistic lap-one stop solely from clean-air projections.
  const prematureStopPenalty = prematureDryStop ? estimateLivePitLossSeconds("GREEN") * 0.78 : 0;
  const baseBoxTime = targetEstimate.projectedRaceSeconds + live.pitLoss.expectedSeconds + 1.05 + prematureStopPenalty;
  const targetSetAvailable = car.tyreSets.some((set) =>
    set.compound === targetCompound && (set.status === "AVAILABLE" || set.status === "RESERVED"),
  );
  const boxAvailable = live.pitLoss.available && targetSetAvailable;
  const currentGap = gapToLeader(context, car);

  return SCENARIO_ORDER.map((kind) => {
    const tyreRisk = scenarioTyreRisk(car, live, kind, remainingLaps);
    const thermalRisk = scenarioThermalRisk(car, kind);
    const safety = safetyCarOpportunity(context, live, kind);
    const weather = weatherOpportunity(live, kind);
    const isImmediateStop = kind === "BOX_NOW" || kind === "UNDERCUT";
    const extensionLaps = Math.min(3, remainingLaps);
    const releaseTraffic = isImmediateStop
      ? { level: live.rejoin.trafficLevel, density: live.rejoin.trafficDensity, nearbyCarIds: live.rejoin.nearbyCarIds }
      : kind === "OVERCUT"
        ? trafficAtGap(context, car, currentGap + estimateLivePitLossSeconds("GREEN"))
        : currentTraffic(context, car);
    const pitTrafficPenalty = isImmediateStop ? releaseTraffic.density * 2.2 : 0;

    let projectedRemainingTime = baseStayTime;
    let feasible = true;
    let predictedRejoinPosition: number | null = null;
    let confidence = live.confidence;
    if (kind === "BOX_NOW") {
      feasible = boxAvailable;
      projectedRemainingTime = baseBoxTime + pitTrafficPenalty;
      predictedRejoinPosition = live.rejoin.position;
    } else if (kind === "STAY_OUT") {
      projectedRemainingTime = baseStayTime;
      confidence += needsLaterStop ? -0.04 : 0.07;
    } else if (kind === "UNDERCUT") {
      feasible = boxAvailable && car.racePosition > 1;
      const weatherTacticalPenalty = live.crossover.shouldPit ? 1.4 : 0;
      projectedRemainingTime = baseBoxTime + pitTrafficPenalty + 0.45 + weatherTacticalPenalty - live.battle.undercutGainSeconds;
      predictedRejoinPosition = live.rejoin.position;
      confidence += live.battle.undercutViable ? 0.04 : -0.16;
    } else {
      feasible = boxAvailable && remainingLaps > extensionLaps;
      const delayedPitLoss = estimateLivePitLossSeconds("GREEN");
      const delayedStopDelta = delayedPitLoss - live.pitLoss.expectedSeconds;
      const extensionCost = extensionLaps * (0.16 + Math.max(0, 48 - car.tyreLife) * 0.022);
      projectedRemainingTime = baseBoxTime + delayedStopDelta + extensionCost - live.battle.overcutGainSeconds - releaseTraffic.density * 0.8;
      predictedRejoinPosition = fieldPositionAtGap(context, car, currentGap + delayedPitLoss);
      confidence += live.battle.overcutViable ? 0.03 : -0.14;
    }

    if (prematureDryStop && kind !== "STAY_OUT") feasible = false;

    projectedRemainingTime += tyreRisk.score * remainingLaps * 0.035 + thermalRisk.score * remainingLaps * 0.025;
    if (live.call === "BOX_NOW" && kind === "BOX_NOW") projectedRemainingTime -= 1.2;
    if ((live.call === "STAY_OUT" || live.call === "EXTEND") && kind === "STAY_OUT") projectedRemainingTime -= 0.8;
    if (!feasible) projectedRemainingTime += 9_999;

    const deltaFromStay = projectedRemainingTime - baseStayTime;
    const predictedFinishPosition = fieldPositionAtGap(context, car, Math.max(0, currentGap + deltaFromStay));
    confidence += live.crossover.confidence * 0.12;
    if (weather.state === "CAPTURED" || safety.state === "CAPTURED") confidence += 0.08;
    if (weather.state === "MISSED" || safety.state === "MISSED") confidence -= 0.08;
    if (!feasible) confidence = 0.05;

    const reasons = scenarioReasons(kind, live, releaseTraffic, tyreRisk, thermalRisk, safety, weather);
    return {
      id: kind,
      label: kind === "BOX_NOW" ? "Box now" : kind === "STAY_OUT" ? "Stay out" : kind === "UNDERCUT" ? "Undercut" : "Overcut",
      compound: isImmediateStop || kind === "OVERCUT" ? targetCompound : car.tyreCompound,
      feasible,
      projectedRemainingTimeSeconds: round(projectedRemainingTime),
      projectedTotalRaceTimeSeconds: round(clock + projectedRemainingTime),
      predictedRejoinPosition,
      predictedFinishPosition,
      traffic: releaseTraffic,
      tyreRisk,
      thermalRisk,
      safetyCarOpportunity: safety,
      weatherOpportunity: weather,
      confidence: round(clamp(confidence, 0.05, 0.98)),
      reasons: prematureDryStop && kind !== "STAY_OUT"
        ? [`An early dry stop is likely to add another ${estimateLivePitLossSeconds("GREEN").toFixed(1)}s visit.`, ...reasons].slice(0, 3)
        : reasons,
    };
  });
}

/**
 * Builds deterministic, directly comparable race-time scenarios for one car.
 * It layers tactical alternatives over the live-strategy pit-loss, rejoin and
 * spatial-weather models without mutating simulation state.
 */
export function calculateStrategyIntelligence(
  context: StrategyIntelligenceContext,
  carId: string,
): StrategyIntelligenceAssessment {
  validateTelemetry(context);
  const liveStrategy = calculateLiveStrategy(context, carId);
  const car = context.cars.find((candidate) => candidate.carId === carId);
  if (!car) throw new RangeError(`Unknown carId: ${carId}.`);
  const totalLaps = context.totalLaps ?? SILVERSTONE_CIRCUIT.totalLaps;
  const remainingLaps = car.finished ? 0 : Math.max(0, totalLaps - car.currentLap + 1);
  const drafts = buildDrafts(context, car, liveStrategy, remainingLaps);
  const ranked = [...drafts]
    .filter((scenario) => scenario.feasible)
    .sort((left, right) => left.projectedRemainingTimeSeconds - right.projectedRemainingTimeSeconds
      || SCENARIO_ORDER.indexOf(left.id) - SCENARIO_ORDER.indexOf(right.id));
  const recommendedDraft = ranked[0] ?? drafts.find((scenario) => scenario.id === "STAY_OUT")!;
  const bestTime = recommendedDraft.projectedRemainingTimeSeconds;
  const rankById = new Map(ranked.map((scenario, index) => [scenario.id, index + 1]));
  const scenarios = drafts.map((scenario) => ({
    ...scenario,
    rank: rankById.get(scenario.id) ?? ranked.length + 1,
    projectedFinishTimeDeltaSeconds: scenario.feasible ? round(scenario.projectedRemainingTimeSeconds - bestTime) : 9_999,
    recommended: scenario.id === recommendedDraft.id,
  }));
  const recommended = scenarios.find((scenario) => scenario.recommended)!;

  return {
    carId,
    generatedAtSeconds: round(context.elapsedTime ?? car.totalRaceTime ?? 0),
    remainingLaps,
    recommendedScenarioId: recommended.id,
    recommendedCompound: recommended.compound,
    confidence: recommended.confidence,
    scenarios,
    liveStrategy,
  };
}

/** Returns stable race-order assessments for all active cars. */
export function calculateFieldStrategyIntelligence(
  context: StrategyIntelligenceContext,
): readonly StrategyIntelligenceAssessment[] {
  return [...context.cars]
    .filter((car) => !car.finished)
    .sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId))
    .map((car) => calculateStrategyIntelligence(context, car.carId));
}
