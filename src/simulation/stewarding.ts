import type {
  InfringementType,
  RaceCarState,
  RaceEvent,
  RaceInvestigation,
  RacePenalty,
  RaceSnapshot,
  RadioMessage,
} from "@/domain/race";
import { DRIVER_BY_ID } from "@/fixtures/grid";
import {
  FIA_2026_PENALTY_RULES,
  canServeMandatoryPenalty,
  calculateStewardSeverityScore,
  classificationConversionSeconds,
  collisionPenaltyFor,
  dangerousRejoinPenaltyFor,
  decidePenalty,
  isMandatoryPitPenalty,
  isTimePenalty,
  lastingAdvantagePenaltyFor,
  pitSpeedingPenaltyFor,
  penaltyHoldSeconds,
  pitSpeedingIncidentQuota,
  unsafeReleasePenaltyFor,
} from "@/simulation/fia-2026-rules";

export interface StewardingUpdate {
  investigations: readonly RaceInvestigation[];
  penalties: readonly RacePenalty[];
  events: readonly RaceEvent[];
  radioMessages: readonly RadioMessage[];
}

interface ReviewStewardingInput {
  snapshot: RaceSnapshot;
  cars: readonly RaceCarState[];
  incidentEvents: readonly RaceEvent[];
  tick: number;
  elapsedTime: number;
}

interface InvestigationEvidence {
  id: string;
  car: RaceCarState;
  infringement: InfringementType;
  reason: string;
  evidence: string;
  severity: number;
  responsibility: number;
  repeatCount: number;
  recommendedPenalty?: RacePenalty["type"] | null;
  metrics?: Readonly<Record<string, number | string | boolean | null>>;
}

export interface AdvancePenaltyLifecycleInput {
  penalties: readonly RacePenalty[];
  cars: readonly RaceCarState[];
  crossedLineCarIds: ReadonlySet<string>;
  raceControl: RaceSnapshot["raceControl"];
  elapsedTime: number;
  servingPenaltyIds?: ReadonlySet<string>;
  servedPenaltyIds?: ReadonlySet<string>;
}

export function convertedPenaltySeconds(type: RacePenalty["type"]): number {
  return classificationConversionSeconds(type);
}

export function penaltyLabel(type: RacePenalty["type"]): string {
  if (type === "WARNING") return "WARNING";
  if (type === "BLACK_AND_WHITE_FLAG") return "BLACK AND WHITE FLAG";
  if (type === "TIME_5") return "5 SECOND TIME PENALTY";
  if (type === "TIME_10") return "10 SECOND TIME PENALTY";
  if (type === "DRIVE_THROUGH") return "DRIVE-THROUGH PENALTY";
  if (type === "STOP_GO_10") return "10 SECOND STOP-AND-GO PENALTY";
  if (type === "GRID_DROP") return "GRID DROP";
  if (type === "REPRIMAND") return "REPRIMAND";
  if (type === "DISQUALIFICATION") return "DISQUALIFIED";
  return "SUSPENSION";
}

function driverSubject(car: RaceCarState): string {
  const driver = DRIVER_BY_ID.get(car.driverId);
  return `CAR ${driver?.number ?? "—"} (${driver?.shortName ?? car.driverId})`;
}

function evidenceCandidates(snapshot: RaceSnapshot, cars: readonly RaceCarState[], incidentEvents: readonly RaceEvent[], elapsedTime: number): InvestigationEvidence[] {
  const previousById = new Map(snapshot.cars.map((car) => [car.carId, car]));
  const candidates: InvestigationEvidence[] = [];
  const pitSpeedingQuota = pitSpeedingIncidentQuota(snapshot.seed);
  const existingPitSpeedingInvestigations = snapshot.investigations
    .filter((investigation) => investigation.infringement === "PIT_SPEEDING").length;
  let newPitSpeedingInvestigations = 0;
  const existingUnsafeReleaseInvestigations = snapshot.investigations
    .filter((investigation) => investigation.infringement === "UNSAFE_RELEASE").length;
  let newUnsafeReleaseInvestigations = 0;

  for (const car of cars) {
    const previous = previousById.get(car.carId);
    if (!previous) continue;

    if (car.vscViolationCount > previous.vscViolationCount) {
      for (let count = previous.vscViolationCount + 1; count <= car.vscViolationCount; count += 1) {
        candidates.push({
          id: `${car.carId}:vsc:${count}`,
          car,
          infringement: "SC_VSC_DELTA",
          reason: "VSC MINIMUM TIME BREACH",
          evidence: `Delta ${car.vscDeltaSeconds.toFixed(3)}s · violation ${count}`,
          severity: Math.min(1, 0.38 + Math.abs(car.vscDeltaSeconds) * 0.2 + count * 0.1),
          responsibility: 0.98,
          repeatCount: count,
        });
      }
    }

    const previousWarnings = previous.trackLimitsWarnings ?? 0;
    const currentWarnings = car.trackLimitsWarnings ?? 0;
    for (const count of [3, 4, 5, 6, 7]) {
      if (previousWarnings >= count || currentWarnings < count) continue;
      const gainedPosition = car.lastOvertakeAt !== null && elapsedTime - car.lastOvertakeAt <= 3;
      candidates.push({
        id: `${car.carId}:track-limits:${count}`,
        car,
        infringement: gainedPosition ? "GAINING_LASTING_ADVANTAGE" : "TRACK_LIMITS",
        reason: gainedPosition ? "LEAVING THE TRACK AND GAINING A LASTING ADVANTAGE" : "TRACK LIMITS",
        evidence: `Offence ${count} · all four wheels beyond the white line${gainedPosition ? " · position retained" : ""}`,
        severity: gainedPosition ? 0.58 : count <= 3 ? 0.2 : count <= 5 ? 0.42 : 0.62,
        responsibility: 0.96,
        repeatCount: count,
        recommendedPenalty: gainedPosition ? lastingAdvantagePenaltyFor({ timeGainSeconds: 0.5, positionsGained: 1, returnedAfterSeconds: null }) : undefined,
      });
    }

    const previousBlueWarnings = previous.blueFlagWarnings ?? 0;
    const blueWarnings = car.blueFlagWarnings ?? 0;
    if (previousBlueWarnings < 3 && blueWarnings >= 3) {
      candidates.push({
        id: `${car.carId}:blue-flags:3`,
        car,
        infringement: "IGNORING_BLUE_FLAGS",
        reason: "IGNORING BLUE FLAGS",
        evidence: `${blueWarnings} instructions · faster car impeded`,
        severity: 0.9,
        responsibility: 0.94,
        repeatCount: blueWarnings,
      });
    }

    const pitEvidence = car.pitSpeedingEvidence;
    if (pitEvidence?.confirmed
      && !previous.pitSpeedingEvidence?.confirmed
      && existingPitSpeedingInvestigations + newPitSpeedingInvestigations < pitSpeedingQuota) {
      const excess = pitEvidence.maximumSpeedKph - FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph;
      const averageExcess = pitEvidence.excessSpeedSumKph / Math.max(1, pitEvidence.sampleCount);
      const repeatCount = 1 + snapshot.investigations.filter((investigation) => (
        investigation.carId === car.carId && investigation.infringement === "PIT_SPEEDING"
      )).length;
      candidates.push({
        id: `${car.carId}:pit-speed:${car.pitStops + 1}`,
        car,
        infringement: "PIT_SPEEDING",
        reason: "PIT LANE SPEEDING",
        evidence: `${pitEvidence.maximumSpeedKph.toFixed(1)} km/h in ${FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph} km/h zone · ${pitEvidence.durationSeconds.toFixed(2)}s · ${pitEvidence.distanceMetres.toFixed(1)}m`,
        severity: excess > 15 ? 1 : excess >= 6 ? 0.84 : 0.34,
        responsibility: 1,
        repeatCount,
        metrics: {
          speedLimitKph: FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph,
          entrySpeedKph: pitEvidence.entrySpeedKph,
          maximumSpeedKph: pitEvidence.maximumSpeedKph,
          averageExcessKph: averageExcess,
          durationSeconds: pitEvidence.durationSeconds,
          distanceMetres: pitEvidence.distanceMetres,
          stableSampleCount: pitEvidence.sampleCount,
          limiterActive: pitEvidence.limiterActive,
        },
      });
      newPitSpeedingInvestigations += 1;
    }

    if (previous.pitStatus === "PIT_STOP"
      && car.pitStatus === "PIT_EXIT"
      && existingUnsafeReleaseInvestigations + newUnsafeReleaseInvestigations < 1) {
      // Only a moving car approaching from behind can be endangered by a box
      // release. The old absolute-distance check also counted cars already
      // safely ahead and converted routine SC pit trains into mass penalties.
      const nearestPitCar = cars
        .filter((candidate) => candidate.carId !== car.carId
          && (candidate.pitStatus === "PIT_LANE" || candidate.pitStatus === "PIT_EXIT")
          && candidate.currentSpeed > 5
          && candidate.totalDistance <= car.totalDistance)
        .reduce((nearest, candidate) => Math.min(nearest, car.totalDistance - candidate.totalDistance), Number.POSITIVE_INFINITY);
      const releasePenalty = unsafeReleasePenaltyFor({
        heavyBraking: nearestPitCar < 18,
        majorAvoidance: nearestPitCar < 9,
        contact: nearestPitCar < 2.5,
      });
      if (releasePenalty) {
        newUnsafeReleaseInvestigations += 1;
        candidates.push({
          id: `${car.carId}:unsafe-release:${car.pitStops}`,
          car,
          infringement: "UNSAFE_RELEASE",
          reason: "UNSAFE RELEASE",
          evidence: `Release gap ${nearestPitCar.toFixed(1)}m to approaching pit-lane traffic`,
          severity: releasePenalty === "DRIVE_THROUGH" ? 0.9 : releasePenalty === "TIME_10" ? 0.7 : 0.4,
          responsibility: 0.9,
          repeatCount: 1,
          recommendedPenalty: releasePenalty,
          metrics: { nearestPitCarMetres: nearestPitCar },
        });
      }
    }

    // reactionTime is the legal launch delay after lights-out, not an early
    // start. Only a deliberately negative launch offset represents movement
    // before the signal; the previous implementation misread every normal
    // reaction delay as a false start during the opening tenths.
    if (car.reactionTime < 0 && previous.currentSpeed <= 1 && car.currentSpeed > 1 && snapshot.elapsedTime < 0.5) {
      candidates.push({
        id: `${car.carId}:jump-start`,
        car,
        infringement: "JUMP_START",
        reason: "FALSE START",
        evidence: `Movement detected ${Math.abs(car.reactionTime).toFixed(3)}s before lights-out`,
        severity: 0.55,
        responsibility: 1,
        repeatCount: 1,
      });
    }

    if (previous.incidentStatus === "SPUN" && car.incidentStatus === "RUNNING" && car.pitStatus === "TRACK") {
      const nearestTrackCar = cars
        .filter((candidate) => candidate.carId !== car.carId && candidate.pitStatus === "TRACK" && candidate.incidentStatus !== "RETIRED")
        .reduce((nearest, candidate) => Math.min(nearest, Math.abs(candidate.totalDistance - car.totalDistance)), Number.POSITIVE_INFINITY);
      const rejoinPenalty = dangerousRejoinPenaltyFor({
        impeded: nearestTrackCar < 45,
        majorAvoidance: nearestTrackCar < 22,
        collision: nearestTrackCar < 4,
      });
      if (rejoinPenalty) candidates.push({
        id: `${car.carId}:dangerous-rejoin:${Math.round(elapsedTime * 10)}`,
        car,
        infringement: "DANGEROUS_REJOIN",
        reason: "UNSAFE REJOIN",
        evidence: `Rejoined racing line with nearest car ${nearestTrackCar.toFixed(1)}m away`,
        severity: rejoinPenalty === "DRIVE_THROUGH" ? 0.8 : rejoinPenalty === "TIME_10" ? 0.58 : 0.38,
        responsibility: 0.9,
        repeatCount: 1,
        recommendedPenalty: rejoinPenalty,
        metrics: { nearestTrackCarMetres: nearestTrackCar },
      });
    }

    /*
     * The dry-weather two-compound requirement is intentionally not enforced.
     * Strategy plans still build two compounds into a full race distance, but a
     * one-compound race is no longer penalised or disqualified.
     */
  }

  for (const event of incidentEvents) {
    if (!event.carId || !event.message.includes("CONTACT AND DEBRIS")) continue;
    const car = cars.find((candidate) => candidate.carId === event.carId);
    if (!car || (car.battleStatus !== "ATTACKING" && car.battleStatus !== "SIDE_BY_SIDE")) continue;
    const responsibility = car.battleStatus === "ATTACKING" ? 0.78 : 0.62;
    const contactSeverity = car.damageLevel >= 0.65 ? 0.9 : car.damageLevel >= 0.25 ? 0.62 : 0.4;
    const victimPositionLoss = event.message.includes("RETIRED") ? 4 : event.message.includes("SPIN") ? 2 : 1;
    const wetMitigation = snapshot.weather.trackWetness > 0.35 ? 18 : 0;
    const stewardScore = calculateStewardSeverityScore({
      responsibility: responsibility * 100,
      sportingAdvantage: car.lastOvertakeAt !== null && elapsedTime - car.lastOvertakeAt < 8 ? 55 : 15,
      safetyRisk: contactSeverity * 86,
      consequence: Math.min(100, victimPositionLoss * 18 + car.damageLevel * 45),
      intent: 3,
      repeatOffence: snapshot.investigations.filter((investigation) => investigation.carId === car.carId && investigation.infringement === "CAUSING_COLLISION").length * 22,
      mitigation: wetMitigation + (car.battleStatus === "SIDE_BY_SIDE" ? 12 : 0),
    });
    const collisionPenalty = collisionPenaltyFor({
      responsibility,
      contactSeverity,
      avoidability: car.battleStatus === "ATTACKING" ? 0.78 : 0.58,
      victimPositionLoss,
      victimDamage: car.damageLevel,
      deliberateIntentProbability: 0.03,
      positionReturned: false,
    });
    candidates.push({
      id: `${event.id}:collision`,
      car,
      infringement: "CAUSING_COLLISION",
      reason: "CAUSING A COLLISION",
      evidence: `${event.message} · responsibility ${Math.round(responsibility * 100)}% · steward score ${stewardScore.toFixed(1)}`,
      severity: stewardScore / 100,
      responsibility,
      repeatCount: 1,
      recommendedPenalty: collisionPenalty,
      metrics: { stewardScore, contactSeverity, victimPositionLoss, wetMitigation },
    });
  }
  return candidates;
}

function createInvestigation(candidate: InvestigationEvidence, elapsedTime: number): RaceInvestigation {
  const jitter = (candidate.car.gridPosition % 4) * 4.5;
  const postSessionTechnicalDecision = candidate.infringement === "TYRE_RULE";
  return {
    id: `investigation:${candidate.id}`,
    incidentId: candidate.id,
    carId: candidate.car.carId,
    teamId: candidate.car.teamId,
    driverId: candidate.car.driverId,
    infringement: candidate.infringement,
    status: postSessionTechnicalDecision ? "DECISION_PENDING" : "NOTED",
    reason: candidate.reason,
    evidence: candidate.evidence,
    severity: candidate.severity,
    responsibility: candidate.responsibility,
    notedAt: elapsedTime,
    investigationAt: postSessionTechnicalDecision ? elapsedTime : elapsedTime + FIA_2026_PENALTY_RULES.notedDelaySeconds,
    decisionDueAt: postSessionTechnicalDecision ? elapsedTime : elapsedTime + FIA_2026_PENALTY_RULES.investigationDelaySeconds + jitter,
    decidedAt: null,
    outcomePenaltyId: null,
    recommendedPenalty: candidate.recommendedPenalty,
    metrics: { ...candidate.metrics, repeatCount: candidate.repeatCount },
  };
}

function createPenalty(investigation: RaceInvestigation, car: RaceCarState, elapsedTime: number, repeatCount: number, strictness: RaceSnapshot["stewardStrictness"]): RacePenalty | null {
  const pitPenalty = investigation.infringement === "PIT_SPEEDING" && investigation.metrics
    ? pitSpeedingPenaltyFor({
      measuredSpeedKph: Number(investigation.metrics.maximumSpeedKph ?? 0),
      speedLimitKph: Number(investigation.metrics.speedLimitKph ?? FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph),
      durationSeconds: Number(investigation.metrics.durationSeconds ?? 0),
      stableSampleCount: Number(investigation.metrics.stableSampleCount ?? 0),
      repeatCount,
    })
    : undefined;
  const recommendedPenalty = investigation.recommendedPenalty;
  const decision = recommendedPenalty !== undefined
    ? {
      penaltyType: recommendedPenalty,
      reason: recommendedPenalty ? "PENALTY" : "NO FURTHER ACTION",
      holdSeconds: recommendedPenalty ? penaltyHoldSeconds(recommendedPenalty) : 0,
      classificationSeconds: recommendedPenalty ? classificationConversionSeconds(recommendedPenalty) : 0,
    }
    : pitPenalty !== undefined
    ? {
      penaltyType: pitPenalty,
      reason: pitPenalty ? "PENALTY" : "NO FURTHER ACTION",
      holdSeconds: pitPenalty ? penaltyHoldSeconds(pitPenalty) : 0,
      classificationSeconds: pitPenalty ? classificationConversionSeconds(pitPenalty) : 0,
    }
    : decidePenalty(investigation.infringement, investigation.severity, investigation.responsibility, strictness, repeatCount);
  if (!decision.penaltyType) return null;
  const advisory = decision.penaltyType === "WARNING" || decision.penaltyType === "BLACK_AND_WHITE_FLAG";
  return {
    id: `${investigation.id}:penalty`,
    incidentId: investigation.incidentId,
    carId: car.carId,
    teamId: car.teamId,
    driverId: car.driverId,
    infringement: investigation.infringement,
    type: decision.penaltyType,
    status: advisory ? "SERVED" : "PENDING",
    seconds: decision.holdSeconds,
    classificationSeconds: decision.classificationSeconds,
    reason: investigation.reason,
    evidence: investigation.evidence,
    issuedAt: elapsedTime,
    lapNumber: car.currentLap,
    serviceDeadlineCrossings: isMandatoryPitPenalty(decision.penaltyType) ? FIA_2026_PENALTY_RULES.mandatoryPitPenaltyCrossings : null,
    lineCrossingsAfterIssue: 0,
    servedAt: advisory ? elapsedTime : null,
    serviceStartedAt: null,
  };
}

function raceControlMessage(id: string, tick: number, elapsedTime: number, car: RaceCarState, message: string, priority: RadioMessage["priority"]): { event: RaceEvent; radio: RadioMessage } {
  return {
    event: { id: `${tick}-${id}`, elapsedTime, type: message.includes("PENALTY") || message.includes("DISQUALIFIED") ? "PENALTY" : "RACE_CONTROL", message, carId: car.carId },
    radio: { id: `${tick}-${id}-radio`, elapsedTime, carId: car.carId, source: "RACE CONTROL", message, priority },
  };
}

/**
 * Runs the full NOTED → INVESTIGATION → DECISION pipeline. Decisions are
 * deliberately delayed, so the yellow timing-tower marker is real state rather
 * than a transient message heuristic.
 */
export function reviewStewarding({ snapshot, cars, incidentEvents, tick, elapsedTime }: ReviewStewardingInput): StewardingUpdate {
  const evidence = evidenceCandidates(snapshot, cars, incidentEvents, elapsedTime);
  const investigations = [...(snapshot.investigations ?? [])];
  const penalties = [...(snapshot.penalties ?? [])];
  const events: RaceEvent[] = [];
  const radioMessages: RadioMessage[] = [];
  const evidenceByIncident = new Map(evidence.map((candidate) => [candidate.id, candidate]));

  for (const candidate of evidence) {
    if (investigations.some((investigation) => investigation.incidentId === candidate.id)) continue;
    const investigation = createInvestigation(candidate, elapsedTime);
    investigations.push(investigation);
    const message = `${driverSubject(candidate.car)} · INCIDENT NOTED · ${candidate.reason}`;
    const notice = raceControlMessage(`noted-${candidate.id}`, tick, elapsedTime, candidate.car, message, "WARNING");
    events.push(notice.event);
    radioMessages.push(notice.radio);
  }

  for (let index = 0; index < investigations.length; index += 1) {
    const investigation = investigations[index];
    const car = cars.find((candidate) => candidate.carId === investigation.carId);
    if (!car || investigation.status === "DECIDED" || investigation.status === "NO_FURTHER_ACTION") continue;

    if (investigation.status === "NOTED" && elapsedTime >= investigation.investigationAt) {
      investigations[index] = { ...investigation, status: "UNDER_INVESTIGATION" };
      const message = `${driverSubject(car)} · UNDER INVESTIGATION · ${investigation.reason}`;
      const notice = raceControlMessage(`investigating-${investigation.incidentId}`, tick, elapsedTime, car, message, "WARNING");
      events.push(notice.event);
      radioMessages.push(notice.radio);
      continue;
    }

    if (investigation.status === "UNDER_INVESTIGATION" && elapsedTime >= investigation.decisionDueAt - 1) {
      investigations[index] = { ...investigation, status: "DECISION_PENDING" };
      continue;
    }

    if (investigation.status !== "DECISION_PENDING" || elapsedTime < investigation.decisionDueAt) continue;
    const candidate = evidenceByIncident.get(investigation.incidentId);
    const storedRepeatCount = Number(investigation.metrics?.repeatCount ?? 0);
    const repeatCount = candidate?.repeatCount
      ?? (storedRepeatCount > 0
        ? storedRepeatCount
        : Math.max(1, investigations.filter((entry) => entry.carId === investigation.carId && entry.infringement === investigation.infringement && entry.notedAt <= investigation.notedAt).length));
    const penalty = createPenalty(investigation, car, elapsedTime, repeatCount, snapshot.stewardStrictness ?? "BALANCED");
    if (!penalty) {
      investigations[index] = { ...investigation, status: "NO_FURTHER_ACTION", decidedAt: elapsedTime };
      const message = `${driverSubject(car)} · NO FURTHER ACTION · ${investigation.reason}`;
      const notice = raceControlMessage(`nfa-${investigation.incidentId}`, tick, elapsedTime, car, message, "NORMAL");
      events.push(notice.event);
      radioMessages.push(notice.radio);
      continue;
    }
    penalties.push(penalty);
    investigations[index] = { ...investigation, status: "DECIDED", decidedAt: elapsedTime, outcomePenaltyId: penalty.id };
    const telemetrySuffix = investigation.infringement === "PIT_SPEEDING" && investigation.metrics
      ? ` · ${Number(investigation.metrics.maximumSpeedKph ?? 0).toFixed(1)} KM/H IN ${Number(investigation.metrics.speedLimitKph ?? FIA_2026_PENALTY_RULES.pitLaneSpeedLimitKph).toFixed(0)} KM/H ZONE`
      : "";
    const message = `${driverSubject(car)} · ${penaltyLabel(penalty.type)} · ${penalty.reason}${telemetrySuffix}`;
    const notice = raceControlMessage(`decision-${investigation.incidentId}`, tick, elapsedTime, car, message, "URGENT");
    events.push(notice.event);
    radioMessages.push(notice.radio);
  }

  return { investigations, penalties, events, radioMessages };
}

/** Advances service deadlines and result conversions independently of UI state. */
export function advancePenaltyLifecycle({
  penalties,
  cars,
  crossedLineCarIds,
  raceControl,
  elapsedTime,
  servingPenaltyIds = new Set(),
  servedPenaltyIds = new Set(),
}: AdvancePenaltyLifecycleInput): RacePenalty[] {
  const carsById = new Map(cars.map((car) => [car.carId, car]));
  return penalties.map((penalty) => {
    if (servedPenaltyIds.has(penalty.id)) return { ...penalty, status: "SERVED", servedAt: elapsedTime };
    if (servingPenaltyIds.has(penalty.id) && (penalty.status === "PENDING" || penalty.status === "SERVING")) {
      return { ...penalty, status: "SERVING", serviceStartedAt: penalty.serviceStartedAt ?? elapsedTime };
    }
    if (penalty.status !== "PENDING" && penalty.status !== "SERVING") return penalty;

    const car = carsById.get(penalty.carId);
    if (car?.finished && (isTimePenalty(penalty.type) || isMandatoryPitPenalty(penalty.type))) {
      return {
        ...penalty,
        status: "CONVERTED_TO_RACE_TIME",
        classificationSeconds: classificationConversionSeconds(penalty.type),
      };
    }
    if (!isMandatoryPitPenalty(penalty.type) || !crossedLineCarIds.has(penalty.carId)) return penalty;
    if (!canServeMandatoryPenalty(raceControl, car?.pitStatus !== "TRACK")) return penalty;
    return { ...penalty, lineCrossingsAfterIssue: penalty.lineCrossingsAfterIssue + 1 };
  });
}

export function totalUnservedPenaltySeconds(penalties: readonly RacePenalty[], carId: string): number {
  return penalties
    .filter((penalty) => penalty.carId === carId && (penalty.status === "PENDING" || penalty.status === "SERVING" || penalty.status === "CONVERTED_TO_RACE_TIME"))
    .reduce((total, penalty) => total + (penalty.classificationSeconds || penaltyHoldSeconds(penalty.type)), 0);
}
