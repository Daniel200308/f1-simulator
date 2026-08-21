import { hashNoise } from "@/simulation/random";

/** Components managed by the weekend reliability model. */
export const RELIABILITY_COMPONENTS = ["ICE", "TC", "MGU-K", "ES", "GEARBOX", "BRAKES"] as const;

export type ReliabilityComponentKind = (typeof RELIABILITY_COMPONENTS)[number];
export type ReliabilityCondition = "OPTIMAL" | "SERVICEABLE" | "WORN" | "CRITICAL" | "FAILED";
export type RepairLevel = "LIGHT" | "STANDARD" | "REBUILD";

export interface ReliabilityComponentState {
  readonly kind: ReliabilityComponentKind;
  /** One-based serial number of the component currently fitted. */
  readonly unitNumber: number;
  /** Remaining condition from 0 (failed) to 100 (new). */
  readonly health: number;
  readonly mileageKm: number;
  readonly raceCount: number;
  readonly repairCount: number;
  readonly replacementCount: number;
  readonly lastServiceRound: number | null;
}

export interface ReliabilityState {
  readonly currentRound: number;
  readonly components: Readonly<Record<ReliabilityComponentKind, ReliabilityComponentState>>;
  /** Grid drops waiting to be applied at the next race start. */
  readonly pendingGridPenaltyPlaces: number;
  /** Lifetime total, retained after pending penalties are consumed. */
  readonly accumulatedGridPenaltyPlaces: number;
}

export interface ReliabilityComponentRule {
  readonly wearPer100Km: number;
  readonly raceWear: number;
  readonly thermalWearPer100Km: number;
  readonly wearVariation: number;
  readonly expectedLifeKm: number;
  readonly expectedRaceCount: number;
  readonly baseFailureHazardPer100Km: number;
  readonly maximumFailureHazardPer100Km: number;
  readonly maximumDeratePercent: number;
  /** Number of serial units available before a replacement adds a penalty. */
  readonly includedUnits: number;
  readonly excessGridPenaltyPlaces: number;
}

/**
 * Gameplay defaults, deliberately isolated from FIA regulations so a season
 * ruleset can override them later. BRAKES are consumable and carry no grid drop.
 */
export const DEFAULT_RELIABILITY_RULES: Readonly<Record<ReliabilityComponentKind, ReliabilityComponentRule>> = {
  ICE: {
    wearPer100Km: 0.95,
    raceWear: 0.9,
    thermalWearPer100Km: 0.75,
    wearVariation: 0.12,
    expectedLifeKm: 4_000,
    expectedRaceCount: 7,
    baseFailureHazardPer100Km: 0.00025,
    maximumFailureHazardPer100Km: 0.14,
    maximumDeratePercent: 8,
    includedUnits: 4,
    excessGridPenaltyPlaces: 10,
  },
  TC: {
    wearPer100Km: 1.05,
    raceWear: 0.75,
    thermalWearPer100Km: 0.9,
    wearVariation: 0.14,
    expectedLifeKm: 3_500,
    expectedRaceCount: 7,
    baseFailureHazardPer100Km: 0.0003,
    maximumFailureHazardPer100Km: 0.17,
    maximumDeratePercent: 5.5,
    includedUnits: 4,
    excessGridPenaltyPlaces: 10,
  },
  "MGU-K": {
    wearPer100Km: 1,
    raceWear: 0.7,
    thermalWearPer100Km: 1,
    wearVariation: 0.13,
    expectedLifeKm: 3_600,
    expectedRaceCount: 7,
    baseFailureHazardPer100Km: 0.00025,
    maximumFailureHazardPer100Km: 0.16,
    maximumDeratePercent: 5,
    includedUnits: 4,
    excessGridPenaltyPlaces: 10,
  },
  ES: {
    wearPer100Km: 0.58,
    raceWear: 0.45,
    thermalWearPer100Km: 1.2,
    wearVariation: 0.1,
    expectedLifeKm: 7_000,
    expectedRaceCount: 12,
    baseFailureHazardPer100Km: 0.00012,
    maximumFailureHazardPer100Km: 0.12,
    maximumDeratePercent: 4,
    includedUnits: 2,
    excessGridPenaltyPlaces: 10,
  },
  GEARBOX: {
    wearPer100Km: 0.85,
    raceWear: 0.8,
    thermalWearPer100Km: 0.75,
    wearVariation: 0.11,
    expectedLifeKm: 4_500,
    expectedRaceCount: 7,
    baseFailureHazardPer100Km: 0.0002,
    maximumFailureHazardPer100Km: 0.15,
    maximumDeratePercent: 4.5,
    includedUnits: 4,
    excessGridPenaltyPlaces: 5,
  },
  BRAKES: {
    wearPer100Km: 2.8,
    raceWear: 1.2,
    thermalWearPer100Km: 1.35,
    wearVariation: 0.16,
    expectedLifeKm: 1_600,
    expectedRaceCount: 3,
    baseFailureHazardPer100Km: 0.00035,
    maximumFailureHazardPer100Km: 0.24,
    maximumDeratePercent: 6,
    includedUnits: Number.POSITIVE_INFINITY,
    excessGridPenaltyPlaces: 0,
  },
};

export interface CreateReliabilityStateOptions {
  readonly currentRound?: number;
  readonly initialHealth?: number | Partial<Record<ReliabilityComponentKind, number>>;
}

export interface WeekendWearInput {
  readonly seed: number;
  readonly round: number;
  readonly distanceKm: number;
  /** Defaults to true. Practice-only usage can opt out. */
  readonly countsAsRace?: boolean;
  /** Overall mechanical load multiplier, from 0.25 to 2. */
  readonly intensity?: number;
  /** Normalized heat exposure, from 0 to 1. */
  readonly thermalStress?: number;
  /** Per-component load multiplier, from 0 to 2. */
  readonly componentLoad?: Partial<Record<ReliabilityComponentKind, number>>;
  /** Direct health-point loss from contact or a known fault. */
  readonly incidentDamage?: Partial<Record<ReliabilityComponentKind, number>>;
}

export interface ComponentWearReport {
  readonly component: ReliabilityComponentKind;
  readonly healthBefore: number;
  readonly healthAfter: number;
  readonly wearApplied: number;
  readonly seededVariation: number;
  readonly mileageAddedKm: number;
  readonly conditionBefore: ReliabilityCondition;
  readonly conditionAfter: ReliabilityCondition;
}

export interface WeekendWearResult {
  readonly state: ReliabilityState;
  readonly reports: readonly ComponentWearReport[];
}

export interface RepairAction {
  readonly type: "REPAIR";
  readonly component: ReliabilityComponentKind;
  readonly level: RepairLevel;
}

export interface ReplacementAction {
  readonly type: "REPLACE";
  readonly component: ReliabilityComponentKind;
}

export type MaintenanceAction = RepairAction | ReplacementAction;

export interface MaintenanceActionReport {
  readonly component: ReliabilityComponentKind;
  readonly action: MaintenanceAction["type"];
  readonly healthBefore: number;
  readonly healthAfter: number;
  readonly unitBefore: number;
  readonly unitAfter: number;
  readonly gridPenaltyPlaces: number;
  readonly conditionBefore: ReliabilityCondition;
  readonly conditionAfter: ReliabilityCondition;
}

export interface MaintenanceResult {
  readonly state: ReliabilityState;
  readonly reports: readonly MaintenanceActionReport[];
  readonly gridPenaltyAdded: number;
}

export interface ReliabilityAssessmentOptions {
  /** Distance over which failure probability is projected. Defaults to 305 km. */
  readonly horizonKm?: number;
  /** Expected load multiplier over that horizon, from 0.25 to 2. */
  readonly intensity?: number;
}

export interface ComponentReliabilityAssessment {
  readonly component: ReliabilityComponentKind;
  readonly condition: ReliabilityCondition;
  /** Probability in the closed range 0..1. */
  readonly failureProbability: number;
  readonly failureRiskPercent: number;
  readonly performanceDeratePercent: number;
  readonly ageRatio: number;
}

export interface ReliabilityAssessment {
  readonly condition: ReliabilityCondition;
  /** Probability of at least one component failure in the requested horizon. */
  readonly failureProbability: number;
  readonly failureRiskPercent: number;
  /** Compound vehicle performance loss, expressed as percentage points. */
  readonly performanceDeratePercent: number;
  readonly limitingComponent: ReliabilityComponentKind;
  readonly components: readonly ComponentReliabilityAssessment[];
}

const CONDITION_RANK: Readonly<Record<ReliabilityCondition, number>> = {
  OPTIMAL: 0,
  SERVICEABLE: 1,
  WORN: 2,
  CRITICAL: 3,
  FAILED: 4,
};

const COMPONENT_STREAM: Readonly<Record<ReliabilityComponentKind, number>> = {
  ICE: 101,
  TC: 211,
  "MGU-K": 307,
  ES: 401,
  GEARBOX: 503,
  BRAKES: 601,
};

const REPAIR_PROFILE: Readonly<Record<RepairLevel, { gain: number; ceiling: number }>> = {
  LIGHT: { gain: 8, ceiling: 84 },
  STANDARD: { gain: 18, ceiling: 90 },
  REBUILD: { gain: 32, ceiling: 94 },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
}

function assertIntegerAtLeast(name: string, value: number, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer >= ${minimum}`);
}

function healthFor(
  initialHealth: CreateReliabilityStateOptions["initialHealth"],
  component: ReliabilityComponentKind,
): number {
  const value = typeof initialHealth === "number" ? initialHealth : initialHealth?.[component] ?? 100;
  assertFinite(`initialHealth.${component}`, value);
  return rounded(clamp(value, 0, 100));
}

function mapComponents<T>(mapper: (component: ReliabilityComponentKind) => T): Record<ReliabilityComponentKind, T> {
  return Object.fromEntries(RELIABILITY_COMPONENTS.map((component) => [component, mapper(component)])) as Record<ReliabilityComponentKind, T>;
}

export function reliabilityCondition(health: number): ReliabilityCondition {
  assertFinite("health", health);
  if (health <= 0) return "FAILED";
  if (health < 35) return "CRITICAL";
  if (health < 60) return "WORN";
  if (health < 80) return "SERVICEABLE";
  return "OPTIMAL";
}

export function createReliabilityState(options: CreateReliabilityStateOptions = {}): ReliabilityState {
  const currentRound = options.currentRound ?? 1;
  assertIntegerAtLeast("currentRound", currentRound, 1);
  return {
    currentRound,
    components: mapComponents((kind) => ({
      kind,
      unitNumber: 1,
      health: healthFor(options.initialHealth, kind),
      mileageKm: 0,
      raceCount: 0,
      repairCount: 0,
      replacementCount: 0,
      lastServiceRound: null,
    })),
    pendingGridPenaltyPlaces: 0,
    accumulatedGridPenaltyPlaces: 0,
  };
}

function normalizedInput(name: string, value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = value ?? fallback;
  assertFinite(name, resolved);
  if (resolved < minimum || resolved > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  return resolved;
}

/** Applies one weekend's usage without mutating the supplied state. */
export function applySeededWeekendWear(
  state: ReliabilityState,
  input: WeekendWearInput,
  rules: Readonly<Record<ReliabilityComponentKind, ReliabilityComponentRule>> = DEFAULT_RELIABILITY_RULES,
): WeekendWearResult {
  assertFinite("seed", input.seed);
  assertIntegerAtLeast("round", input.round, state.currentRound);
  assertFinite("distanceKm", input.distanceKm);
  if (input.distanceKm < 0) throw new RangeError("distanceKm must be >= 0");
  const intensity = normalizedInput("intensity", input.intensity, 1, 0.25, 2);
  const thermalStress = normalizedInput("thermalStress", input.thermalStress, 0, 0, 1);
  const countsAsRace = input.countsAsRace ?? true;
  const reports: ComponentWearReport[] = [];

  const components = mapComponents((kind) => {
    const previous = state.components[kind];
    const rule = rules[kind];
    const componentLoad = normalizedInput(`componentLoad.${kind}`, input.componentLoad?.[kind], 1, 0, 2);
    const incidentDamage = normalizedInput(`incidentDamage.${kind}`, input.incidentDamage?.[kind], 0, 0, 100);
    const tick = input.round * 10_007 + previous.unitNumber * 1_009 + previous.raceCount * 101;
    const seededVariation = rounded(1 + (hashNoise(Math.trunc(input.seed), COMPONENT_STREAM[kind], tick) * 2 - 1) * rule.wearVariation, 6);
    const distanceFactor = input.distanceKm / 100;
    const operatingWear = rule.wearPer100Km * distanceFactor * intensity * componentLoad;
    const heatWear = rule.thermalWearPer100Km * distanceFactor * thermalStress;
    const eventWear = countsAsRace ? rule.raceWear * (0.8 + intensity * 0.2) : 0;
    const wearApplied = rounded(Math.max(0, (operatingWear + heatWear + eventWear) * seededVariation + incidentDamage));
    const healthAfter = rounded(clamp(previous.health - wearApplied, 0, 100));
    const next: ReliabilityComponentState = {
      ...previous,
      health: healthAfter,
      mileageKm: rounded(previous.mileageKm + input.distanceKm, 3),
      raceCount: previous.raceCount + (countsAsRace ? 1 : 0),
    };
    reports.push({
      component: kind,
      healthBefore: previous.health,
      healthAfter,
      wearApplied,
      seededVariation,
      mileageAddedKm: input.distanceKm,
      conditionBefore: reliabilityCondition(previous.health),
      conditionAfter: reliabilityCondition(healthAfter),
    });
    return next;
  });

  return {
    state: { ...state, currentRound: input.round, components },
    reports,
  };
}

/** Performs a single service plan between completed rounds. */
export function performBetweenRoundMaintenance(
  state: ReliabilityState,
  nextRound: number,
  actions: readonly MaintenanceAction[],
  rules: Readonly<Record<ReliabilityComponentKind, ReliabilityComponentRule>> = DEFAULT_RELIABILITY_RULES,
): MaintenanceResult {
  assertIntegerAtLeast("nextRound", nextRound, state.currentRound + 1);
  const duplicate = actions.find((action, index) => actions.findIndex((candidate) => candidate.component === action.component) !== index);
  if (duplicate) throw new Error(`Only one maintenance action is allowed for ${duplicate.component} per round`);

  const mutable = { ...state.components } as Record<ReliabilityComponentKind, ReliabilityComponentState>;
  const reports: MaintenanceActionReport[] = [];
  let gridPenaltyAdded = 0;

  for (const action of actions) {
    const previous = mutable[action.component];
    const conditionBefore = reliabilityCondition(previous.health);
    let next: ReliabilityComponentState;
    let gridPenaltyPlaces = 0;

    if (action.type === "REPAIR") {
      if (previous.health <= 0) throw new Error(`${action.component} has failed and must be replaced`);
      const profile = REPAIR_PROFILE[action.level];
      const restoredHealth = rounded(Math.min(profile.ceiling, previous.health + profile.gain));
      next = {
        ...previous,
        health: restoredHealth,
        repairCount: previous.repairCount + 1,
        lastServiceRound: nextRound,
      };
    } else {
      const nextUnitNumber = previous.unitNumber + 1;
      const rule = rules[action.component];
      gridPenaltyPlaces = nextUnitNumber > rule.includedUnits ? rule.excessGridPenaltyPlaces : 0;
      next = {
        kind: action.component,
        unitNumber: nextUnitNumber,
        health: 100,
        mileageKm: 0,
        raceCount: 0,
        repairCount: 0,
        replacementCount: previous.replacementCount + 1,
        lastServiceRound: nextRound,
      };
    }

    mutable[action.component] = next;
    gridPenaltyAdded += gridPenaltyPlaces;
    reports.push({
      component: action.component,
      action: action.type,
      healthBefore: previous.health,
      healthAfter: next.health,
      unitBefore: previous.unitNumber,
      unitAfter: next.unitNumber,
      gridPenaltyPlaces,
      conditionBefore,
      conditionAfter: reliabilityCondition(next.health),
    });
  }

  return {
    state: {
      ...state,
      currentRound: nextRound,
      components: mutable,
      pendingGridPenaltyPlaces: state.pendingGridPenaltyPlaces + gridPenaltyAdded,
      accumulatedGridPenaltyPlaces: state.accumulatedGridPenaltyPlaces + gridPenaltyAdded,
    },
    reports,
    gridPenaltyAdded,
  };
}

/** Clears the next-race penalty while retaining its lifetime audit total. */
export function consumePendingGridPenalty(state: ReliabilityState): { state: ReliabilityState; penaltyPlaces: number } {
  return {
    state: { ...state, pendingGridPenaltyPlaces: 0 },
    penaltyPlaces: state.pendingGridPenaltyPlaces,
  };
}

/**
 * Moves every penalized car down by the requested number of grid slots while
 * preserving the order of both the penalized group and the rest of the field.
 * Applying the moves from the back prevents one team car from cancelling the
 * drop applied to its team-mate.
 */
export function applyGridPenaltyToCars(
  gridOrder: readonly string[],
  penalizedCarIds: readonly string[],
  penaltyPlaces: number,
): readonly string[] {
  if (!Number.isInteger(penaltyPlaces) || penaltyPlaces < 0) {
    throw new RangeError("penaltyPlaces must be a non-negative integer");
  }
  if (penaltyPlaces === 0 || penalizedCarIds.length === 0) return [...gridOrder];
  const penalized = new Set(penalizedCarIds);
  const result = [...gridOrder];
  const moves = gridOrder
    .map((carId, index) => ({ carId, index }))
    .filter(({ carId }) => penalized.has(carId))
    .sort((left, right) => right.index - left.index);

  for (const move of moves) {
    const currentIndex = result.indexOf(move.carId);
    if (currentIndex < 0) continue;
    result.splice(currentIndex, 1);
    result.splice(Math.min(result.length, currentIndex + penaltyPlaces), 0, move.carId);
  }
  return result;
}

function componentAssessment(
  component: ReliabilityComponentState,
  rule: ReliabilityComponentRule,
  horizonKm: number,
  intensity: number,
): ComponentReliabilityAssessment {
  const condition = reliabilityCondition(component.health);
  const ageRatio = Math.max(component.mileageKm / rule.expectedLifeKm, component.raceCount / rule.expectedRaceCount);
  if (condition === "FAILED") return {
    component: component.kind,
    condition,
    failureProbability: 1,
    failureRiskPercent: 100,
    performanceDeratePercent: rule.maximumDeratePercent,
    ageRatio: rounded(ageRatio),
  };

  const healthStress = Math.pow(clamp((75 - component.health) / 75, 0, 1), 2.15);
  const ageStress = Math.pow(clamp((ageRatio - 0.55) / 0.95, 0, 1), 1.7);
  const hazardPer100Km = rule.baseFailureHazardPer100Km
    + rule.maximumFailureHazardPer100Km * (healthStress * 0.72 + ageStress * 0.28) * intensity;
  const failureProbability = clamp(1 - Math.exp(-hazardPer100Km * horizonKm / 100), 0, 1);
  const healthDerate = Math.pow(clamp((65 - component.health) / 65, 0, 1), 1.45);
  const ageDerate = clamp(ageRatio - 1, 0, 0.5) * 0.2;
  const performanceDeratePercent = rule.maximumDeratePercent * clamp(healthDerate + ageDerate, 0, 1);
  return {
    component: component.kind,
    condition,
    failureProbability: rounded(failureProbability, 8),
    failureRiskPercent: rounded(failureProbability * 100, 5),
    performanceDeratePercent: rounded(performanceDeratePercent),
    ageRatio: rounded(ageRatio),
  };
}

/** Projects failure risk and performance loss without drawing a random outcome. */
export function assessReliability(
  state: ReliabilityState,
  options: ReliabilityAssessmentOptions = {},
  rules: Readonly<Record<ReliabilityComponentKind, ReliabilityComponentRule>> = DEFAULT_RELIABILITY_RULES,
): ReliabilityAssessment {
  const horizonKm = normalizedInput("horizonKm", options.horizonKm, 305, 0, 10_000);
  const intensity = normalizedInput("intensity", options.intensity, 1, 0.25, 2);
  const components = RELIABILITY_COMPONENTS.map((kind) => componentAssessment(state.components[kind], rules[kind], horizonKm, intensity));
  const failureProbability = 1 - components.reduce((survival, assessment) => survival * (1 - assessment.failureProbability), 1);
  const performanceRemaining = components.reduce((remaining, assessment) => remaining * (1 - assessment.performanceDeratePercent / 100), 1);
  const condition = components.reduce<ReliabilityCondition>((worst, assessment) => (
    CONDITION_RANK[assessment.condition] > CONDITION_RANK[worst] ? assessment.condition : worst
  ), "OPTIMAL");
  const limitingComponent = components.reduce((limiting, assessment) => {
    const limitingScore = limiting.failureProbability + limiting.performanceDeratePercent / 100;
    const assessmentScore = assessment.failureProbability + assessment.performanceDeratePercent / 100;
    return assessmentScore > limitingScore ? assessment : limiting;
  }).component;

  return {
    condition,
    failureProbability: rounded(failureProbability, 8),
    failureRiskPercent: rounded(failureProbability * 100, 5),
    performanceDeratePercent: rounded(clamp((1 - performanceRemaining) * 100, 0, 100)),
    limitingComponent,
    components,
  };
}
