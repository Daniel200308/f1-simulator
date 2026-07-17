import type { InfringementType, PenaltyType, RacePenalty, StewardStrictness } from "@/domain/race";

/**
 * FIA 2026 Formula 1 Sporting Regulations, Section B, Issue 07 (25 June 2026).
 * Article B1.9.6 supplies the pit-service and conversion procedure. The
 * published 2026 F1 Penalty Guidelines supply baseline sanctions by offence.
 */
export const FIA_2026_PENALTY_RULES = {
  source: "FIA 2026 F1 Regulations · Section B · Issue 07 · 25 June 2026",
  guidelinesSource: "FIA 2026 Formula 1 Penalty Guidelines · Version 01 · 6 March 2026",
  timePenaltyHoldSeconds: { TIME_5: 5, TIME_10: 10 },
  driveThroughResultConversionSeconds: 20,
  stopGoResultConversionSeconds: 30,
  mandatoryPitPenaltyCrossings: 2,
  pitLaneSpeedLimitKph: 80,
  detectionTolerance: {
    speedKph: 0.2,
    trackPositionMetres: 0.05,
    movementMetres: 0.03,
    minimumViolationDurationSeconds: 0.12,
    minimumStableSampleCount: 3,
  },
  pitLaneSpeeding: {
    sensorToleranceKph: 0.2,
    minimumDurationSeconds: 0.12,
    minimumStableSampleCount: 3,
    fiveSecondMaxExcessKph: 5.999,
    driveThroughMaxExcessKph: 15,
    repeatOffenceEscalation: false,
  },
  trackLimits: {
    warningStrike: 3,
    penaltyStrike: 4,
    penaltySeconds: 5,
  },
  lastingAdvantage: {
    negligibleGainSeconds: 0.15,
    minorGainSeconds: 0.5,
    majorGainSeconds: 1,
    giveBackWindowSeconds: 8,
  },
  jumpStart: {
    movementToleranceMetres: 0.03,
    minimumIllegalMovementMetres: 0.05,
    minorMovementMetres: 0.15,
    minimumMovementDurationSeconds: 0.08,
  },
  blueFlags: {
    allowedFlagCount: 3,
    allowedTimeSeconds: 8,
    allowedMarshalSectors: 3,
  },
  stewarding: {
    enableMitigation: true,
    enableAggravation: true,
    minimumResponsibility: 0.5,
  },
  notedDelaySeconds: 3,
  /** Steward verdicts never arrive less than one simulated minute after the incident. */
  investigationDelaySeconds: 65,
} as const;

/** Each seeded race contains only two or three isolated limiter mistakes. */
export function pitSpeedingIncidentQuota(seed: number): 2 | 3 {
  return Math.abs(Math.trunc(seed)) % 2 === 0 ? 2 : 3;
}

export interface StewardDecision {
  penaltyType: PenaltyType | null;
  reason: string;
  holdSeconds: number;
  classificationSeconds: number;
}

export type OffenceSeverity = "NONE" | "MINOR" | "MODERATE" | "MAJOR" | "SEVERE" | "EXTREME";

export interface StewardScore {
  responsibility: number;
  sportingAdvantage: number;
  safetyRisk: number;
  consequence: number;
  intent: number;
  repeatOffence: number;
  mitigation: number;
}

export interface PitSpeedingAssessment {
  measuredSpeedKph: number;
  speedLimitKph?: number;
  durationSeconds: number;
  stableSampleCount: number;
  repeatCount?: number;
  repeatOffenceEscalation?: boolean;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function calculateStewardSeverityScore(score: StewardScore): number {
  return clampScore(
    clampScore(score.responsibility) * 0.30
    + clampScore(score.sportingAdvantage) * 0.15
    + clampScore(score.safetyRisk) * 0.25
    + clampScore(score.consequence) * 0.15
    + clampScore(score.intent) * 0.10
    + clampScore(score.repeatOffence) * 0.05
    - clampScore(score.mitigation) * 0.20,
  );
}

export function offenceSeverityFromScore(value: number): OffenceSeverity {
  const score = clampScore(value);
  if (score < 20) return "NONE";
  if (score < 35) return "MINOR";
  if (score < 50) return "MODERATE";
  if (score < 70) return "MAJOR";
  if (score < 85) return "SEVERE";
  return "EXTREME";
}

export function penaltyFromStewardScore(score: StewardScore, extremeDisqualification = false): PenaltyType | null {
  if (score.responsibility < FIA_2026_PENALTY_RULES.stewarding.minimumResponsibility * 100) return null;
  const severity = offenceSeverityFromScore(calculateStewardSeverityScore(score));
  if (severity === "NONE") return null;
  if (severity === "MINOR") return "WARNING";
  if (severity === "MODERATE") return "TIME_5";
  if (severity === "MAJOR") return "TIME_10";
  if (severity === "SEVERE") return "DRIVE_THROUGH";
  return extremeDisqualification ? "DISQUALIFICATION" : "STOP_GO_10";
}

/** Normalises to one decimal so 95.0 and 95.1 cannot swap bands through FP noise. */
export function normaliseMeasuredSpeedKph(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function pitSpeedingPenaltyFor(assessment: PitSpeedingAssessment): PenaltyType | null {
  const rules = FIA_2026_PENALTY_RULES.pitLaneSpeeding;
  const limit = assessment.speedLimitKph ?? FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph;
  const measured = normaliseMeasuredSpeedKph(assessment.measuredSpeedKph);
  const excess = normaliseMeasuredSpeedKph(measured - limit);
  if (assessment.durationSeconds + Number.EPSILON < rules.minimumDurationSeconds
    || assessment.stableSampleCount < rules.minimumStableSampleCount
    || excess <= rules.sensorToleranceKph) return null;

  let penalty: PenaltyType = excess < 6
    ? "TIME_5"
    : excess <= rules.driveThroughMaxExcessKph ? "DRIVE_THROUGH" : "STOP_GO_10";
  const repeatCount = Math.max(1, assessment.repeatCount ?? 1);
  if (assessment.repeatOffenceEscalation ?? rules.repeatOffenceEscalation) {
    if (excess < 6 && repeatCount === 2) penalty = "TIME_10";
    if (excess < 6 && repeatCount >= 3) penalty = "DRIVE_THROUGH";
  }
  return penalty;
}

export function miniSectorViolationPenalty(redMiniSectors: number): PenaltyType | null {
  if (redMiniSectors <= 1) return null;
  if (redMiniSectors <= 3) return "TIME_5";
  if (redMiniSectors === 4) return "TIME_10";
  if (redMiniSectors === 5) return "DRIVE_THROUGH";
  return "STOP_GO_10";
}

export interface LastingAdvantageAssessment {
  timeGainSeconds: number;
  positionsGained: number;
  returnedAfterSeconds: number | null;
}

export function lastingAdvantagePenaltyFor(assessment: LastingAdvantageAssessment): PenaltyType | null {
  const rules = FIA_2026_PENALTY_RULES.lastingAdvantage;
  const returnedPromptly = assessment.returnedAfterSeconds !== null && assessment.returnedAfterSeconds <= rules.giveBackWindowSeconds;
  if (returnedPromptly) return null;
  if (assessment.positionsGained >= 2) return "DRIVE_THROUGH";
  if (assessment.positionsGained >= 1 || assessment.timeGainSeconds >= rules.majorGainSeconds) return "TIME_10";
  if (assessment.timeGainSeconds >= rules.negligibleGainSeconds) return "TIME_5";
  return null;
}

export interface CollisionAssessment {
  responsibility: number;
  contactSeverity: number;
  avoidability: number;
  victimPositionLoss: number;
  victimDamage: number;
  deliberateIntentProbability: number;
  positionReturned: boolean;
}

export function collisionPenaltyFor(assessment: CollisionAssessment): PenaltyType | null {
  if (assessment.responsibility < 0.5) return null;
  const noMeaningfulConsequence = assessment.contactSeverity < 0.2
    && assessment.victimPositionLoss <= 0
    && assessment.victimDamage < 0.08;
  if (noMeaningfulConsequence) return null;
  if (assessment.deliberateIntentProbability >= 0.82) return "STOP_GO_10";
  if (assessment.responsibility >= 0.88 && assessment.avoidability >= 0.82
    && (assessment.victimDamage >= 0.65 || assessment.contactSeverity >= 0.86)) return "DRIVE_THROUGH";
  if (assessment.positionReturned && assessment.victimDamage < 0.18 && assessment.victimPositionLoss <= 1) return "TIME_5";
  return assessment.contactSeverity < 0.35 && assessment.victimDamage < 0.15 ? "TIME_5" : "TIME_10";
}

export function dangerousRejoinPenaltyFor(input: { impeded: boolean; majorAvoidance: boolean; collision: boolean; extremeRisk?: boolean }): PenaltyType | null {
  if (!input.impeded && !input.majorAvoidance && !input.collision) return null;
  if (input.extremeRisk) return "STOP_GO_10";
  if (input.collision) return "DRIVE_THROUGH";
  return input.majorAvoidance ? "TIME_10" : "TIME_5";
}

export function unsafeReleasePenaltyFor(input: { throttleLiftOnly?: boolean; heavyBraking?: boolean; majorAvoidance?: boolean; contact?: boolean; unsafeCondition?: boolean }): PenaltyType | null {
  if (input.unsafeCondition) return "STOP_GO_10";
  if (input.contact) return "DRIVE_THROUGH";
  if (input.majorAvoidance) return "TIME_10";
  if (input.heavyBraking) return "TIME_5";
  return input.throttleLiftOnly ? null : null;
}

export function jumpStartPenaltyFor(input: { movementMetres: number; movementDurationSeconds: number; gridBoxesGained?: number }): PenaltyType | null {
  const rules = FIA_2026_PENALTY_RULES.jumpStart;
  if (input.movementDurationSeconds < rules.minimumMovementDurationSeconds || input.movementMetres < rules.minimumIllegalMovementMetres) return null;
  if ((input.gridBoxesGained ?? 0) >= 1 || input.movementMetres >= 1) return "STOP_GO_10";
  if (input.movementMetres >= 0.45) return "DRIVE_THROUGH";
  if (input.movementMetres >= rules.minorMovementMetres) return "TIME_10";
  return "TIME_5";
}

export function neutralisedOvertakePenaltyFor(input: { carsPassed: number; returnedPromptly: boolean }): PenaltyType | null {
  if (input.returnedPromptly || input.carsPassed <= 0) return null;
  if (input.carsPassed === 1) return "TIME_10";
  if (input.carsPassed === 2) return "DRIVE_THROUGH";
  return "STOP_GO_10";
}

export function yellowFlagPenaltyFor(input: { doubleYellow: boolean; slowed: boolean; overtook: boolean; personnelAtRisk?: boolean }): PenaltyType | null {
  if (input.personnelAtRisk) return "STOP_GO_10";
  if (input.overtook) return "DRIVE_THROUGH";
  if (input.slowed) return input.doubleYellow ? "TIME_10" : null;
  return input.doubleYellow ? "DRIVE_THROUGH" : "TIME_10";
}

const PENALTY_STRENGTH: Readonly<Record<PenaltyType, number>> = {
  WARNING: 1,
  BLACK_AND_WHITE_FLAG: 2,
  TIME_5: 3,
  TIME_10: 4,
  DRIVE_THROUGH: 5,
  STOP_GO_10: 6,
  GRID_DROP: 4,
  REPRIMAND: 2,
  DISQUALIFICATION: 7,
  SUSPENSION: 8,
};

export interface IncidentPenaltyCandidate {
  incidentId: string;
  actionGroup: string;
  infringement: InfringementType;
  penaltyType: PenaltyType;
  independent: boolean;
}

/** Keeps the strongest sanction for one action, but preserves truly independent acts. */
export function deduplicateIncidentPenalties(candidates: readonly IncidentPenaltyCandidate[]): IncidentPenaltyCandidate[] {
  const decisions = new Map<string, IncidentPenaltyCandidate>();
  for (const candidate of candidates) {
    const key = candidate.independent ? `${candidate.incidentId}:${candidate.actionGroup}:${candidate.infringement}` : `${candidate.incidentId}:${candidate.actionGroup}`;
    const current = decisions.get(key);
    if (!current || PENALTY_STRENGTH[candidate.penaltyType] > PENALTY_STRENGTH[current.penaltyType]) decisions.set(key, candidate);
  }
  return [...decisions.values()];
}

export function isTimePenalty(type: PenaltyType): type is "TIME_5" | "TIME_10" {
  return type === "TIME_5" || type === "TIME_10";
}

export function isMandatoryPitPenalty(type: PenaltyType): type is "DRIVE_THROUGH" | "STOP_GO_10" {
  return type === "DRIVE_THROUGH" || type === "STOP_GO_10";
}

export function penaltyHoldSeconds(type: PenaltyType): number {
  if (type === "TIME_5") return 5;
  if (type === "TIME_10" || type === "STOP_GO_10") return 10;
  return 0;
}

export function classificationConversionSeconds(type: PenaltyType): number {
  if (type === "TIME_5") return 5;
  if (type === "TIME_10") return 10;
  if (type === "DRIVE_THROUGH") return FIA_2026_PENALTY_RULES.driveThroughResultConversionSeconds;
  if (type === "STOP_GO_10") return FIA_2026_PENALTY_RULES.stopGoResultConversionSeconds;
  return 0;
}

function strictnessBias(strictness: StewardStrictness): number {
  return strictness === "STRICT" ? -0.08 : strictness === "LENIENT" ? 0.08 : 0;
}

/** A deterministic game interpretation of the published 2026 baseline table. */
export function decidePenalty(
  infringement: InfringementType,
  severity: number,
  responsibility: number,
  strictness: StewardStrictness = "BALANCED",
  repeatCount = 1,
): StewardDecision {
  const threshold = 0.5 + strictnessBias(strictness);
  if (responsibility < threshold) return { penaltyType: null, reason: "NO FURTHER ACTION", holdSeconds: 0, classificationSeconds: 0 };

  let type: PenaltyType;
  switch (infringement) {
    case "SC_VSC_DELTA":
      type = repeatCount <= 1 ? "TIME_5" : repeatCount === 2 ? "TIME_10" : repeatCount === 3 ? "DRIVE_THROUGH" : "STOP_GO_10";
      break;
    case "SC_DELTA":
      type = miniSectorViolationPenalty(repeatCount) ?? "WARNING";
      break;
    case "TRACK_LIMITS":
      type = repeatCount <= 3 ? "BLACK_AND_WHITE_FLAG" : repeatCount <= 5 ? "TIME_5" : "TIME_10";
      break;
    case "IGNORING_BLUE_FLAGS":
      type = repeatCount <= 3 ? "TIME_5" : repeatCount === 4 ? "TIME_10" : "DRIVE_THROUGH";
      break;
    case "PIT_SPEEDING":
      type = severity >= 0.95 ? "STOP_GO_10" : severity >= 0.82 ? "DRIVE_THROUGH" : "TIME_5";
      break;
    case "UNSAFE_RELEASE":
      type = severity >= 0.88 ? "STOP_GO_10" : severity >= 0.55 ? "TIME_10" : "TIME_5";
      break;
    case "UNSAFE_CONDITION":
      type = "STOP_GO_10";
      break;
    case "CAUSING_COLLISION":
      type = severity >= 0.9 ? "STOP_GO_10" : severity >= 0.55 ? "TIME_10" : "TIME_5";
      break;
    case "DANGEROUS_REJOIN":
      type = severity >= 0.9 ? "STOP_GO_10" : severity >= 0.72 ? "DRIVE_THROUGH" : severity >= 0.42 ? "TIME_10" : "TIME_5";
      break;
    case "GAINING_LASTING_ADVANTAGE":
      type = severity >= 0.78 ? "DRIVE_THROUGH" : severity >= 0.45 ? "TIME_10" : "TIME_5";
      break;
    case "SC_OVERTAKE":
    case "VSC_OVERTAKE":
      type = repeatCount <= 1 ? "TIME_10" : repeatCount === 2 ? "DRIVE_THROUGH" : "STOP_GO_10";
      break;
    case "YELLOW_FLAG":
      type = severity >= 0.9 ? "STOP_GO_10" : severity >= 0.72 ? "DRIVE_THROUGH" : severity >= 0.42 ? "TIME_10" : "TIME_5";
      break;
    case "PIT_EXIT_RED_LIGHT":
    case "CLOSED_PIT_ENTRY":
      type = "STOP_GO_10";
      break;
    case "PIT_ENTRY_LINE":
    case "PIT_EXIT_LINE":
      type = severity >= 0.65 ? "TIME_10" : "TIME_5";
      break;
    case "FORCING_OFF_TRACK":
    case "MULTIPLE_DEFENSIVE_MOVES":
    case "MOVING_UNDER_BRAKING":
    case "SC_MAX_GAP":
    case "UNNECESSARILY_SLOW":
      type = severity >= 0.82 ? "DRIVE_THROUGH" : severity >= 0.5 ? "TIME_10" : severity >= 0.28 ? "TIME_5" : "WARNING";
      break;
    case "JUMP_START":
    case "GRID_POSITION":
      type = severity >= 0.9 ? "STOP_GO_10" : severity >= 0.7 ? "DRIVE_THROUGH" : severity >= 0.4 ? "TIME_10" : "TIME_5";
      break;
    case "TYRE_RULE":
      type = "DISQUALIFICATION";
      break;
  }
  return {
    penaltyType: type,
    reason: type === "DISQUALIFICATION" ? "DISQUALIFIED" : type === "WARNING" || type === "BLACK_AND_WHITE_FLAG" ? "FORMAL WARNING" : "PENALTY",
    holdSeconds: penaltyHoldSeconds(type),
    classificationSeconds: classificationConversionSeconds(type),
  };
}

export function penaltyCrossingsRemaining(penalty: RacePenalty): number | null {
  if (!isMandatoryPitPenalty(penalty.type) || penalty.serviceDeadlineCrossings === null) return null;
  return Math.max(0, penalty.serviceDeadlineCrossings - penalty.lineCrossingsAfterIssue);
}

export function canServeMandatoryPenalty(raceControl: "GREEN" | "YELLOW" | "VSC" | "SAFETY_CAR" | "RED_FLAG", alreadyInPitLane: boolean): boolean {
  if (raceControl !== "VSC" && raceControl !== "SAFETY_CAR") return raceControl !== "RED_FLAG";
  return alreadyInPitLane;
}

export function resultPenaltySeconds(penalty: RacePenalty): number {
  if (penalty.status === "SERVED" || penalty.status === "EXPIRED") return 0;
  return penalty.classificationSeconds || classificationConversionSeconds(penalty.type);
}
