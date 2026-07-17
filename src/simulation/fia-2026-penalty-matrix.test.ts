import { describe, expect, it } from "vitest";

import type { RaceSnapshot } from "@/domain/race";
import { createInitialSnapshot } from "@/simulation/engine";
import {
  calculateStewardSeverityScore,
  collisionPenaltyFor,
  dangerousRejoinPenaltyFor,
  decidePenalty,
  deduplicateIncidentPenalties,
  jumpStartPenaltyFor,
  lastingAdvantagePenaltyFor,
  miniSectorViolationPenalty,
  neutralisedOvertakePenaltyFor,
  offenceSeverityFromScore,
  penaltyFromStewardScore,
  pitSpeedingPenaltyFor,
  unsafeReleasePenaltyFor,
  yellowFlagPenaltyFor,
} from "@/simulation/fia-2026-rules";

const stablePitSample = (speed: number, durationSeconds = 0.3, stableSampleCount = 3) => pitSpeedingPenaltyFor({
  measuredSpeedKph: speed,
  speedLimitKph: 80,
  durationSeconds,
  stableSampleCount,
});

describe("FIA 2026 pit-lane speeding boundaries", () => {
  it("ignores a one-frame 80.1 km/h sample", () => expect(stablePitSample(80.1, 0.1, 1)).toBeNull());
  it("treats a sustained 80.2 km/h reading as sensor tolerance", () => expect(stablePitSample(80.2)).toBeNull());
  it("gives five seconds at 80.3 km/h", () => expect(stablePitSample(80.3)).toBe("TIME_5"));
  it("gives five seconds at 80.9 km/h", () => expect(stablePitSample(80.9)).toBe("TIME_5"));
  it("gives five seconds at 85.9 km/h", () => expect(stablePitSample(85.9)).toBe("TIME_5"));
  it("switches to drive-through at exactly 86.0 km/h", () => expect(stablePitSample(86)).toBe("DRIVE_THROUGH"));
  it("keeps exactly 95.0 km/h in the drive-through band", () => expect(stablePitSample(95)).toBe("DRIVE_THROUGH"));
  it("switches to stop-and-go at 95.1 km/h", () => expect(stablePitSample(95.1)).toBe("STOP_GO_10"));
  it("rejects a large spike without three stable samples", () => expect(stablePitSample(110, 0.3, 2)).toBeNull());
  it("rejects a stable sample shorter than 0.12 seconds", () => expect(stablePitSample(86, 0.119, 3)).toBeNull());
  it("can optionally escalate a second sub-6 km/h offence to ten seconds", () => expect(pitSpeedingPenaltyFor({ measuredSpeedKph: 82, durationSeconds: 0.3, stableSampleCount: 3, repeatCount: 2, repeatOffenceEscalation: true })).toBe("TIME_10"));
  it("can optionally escalate a third sub-6 km/h offence to drive-through", () => expect(pitSpeedingPenaltyFor({ measuredSpeedKph: 82, durationSeconds: 0.3, stableSampleCount: 3, repeatCount: 3, repeatOffenceEscalation: true })).toBe("DRIVE_THROUGH"));
});

describe("track limits and lasting advantage", () => {
  it("uses a black-and-white flag for strike three", () => expect(decidePenalty("TRACK_LIMITS", 0.2, 1, "BALANCED", 3).penaltyType).toBe("BLACK_AND_WHITE_FLAG"));
  it("uses five seconds for strike four", () => expect(decidePenalty("TRACK_LIMITS", 0.4, 1, "BALANCED", 4).penaltyType).toBe("TIME_5"));
  it("uses another five seconds for strike five", () => expect(decidePenalty("TRACK_LIMITS", 0.5, 1, "BALANCED", 5).penaltyType).toBe("TIME_5"));
  it("ignores less than 0.15 seconds with no position gain", () => expect(lastingAdvantagePenaltyFor({ timeGainSeconds: 0.149, positionsGained: 0, returnedAfterSeconds: null })).toBeNull());
  it("dismisses an off-track pass returned inside eight seconds", () => expect(lastingAdvantagePenaltyFor({ timeGainSeconds: 1.2, positionsGained: 1, returnedAfterSeconds: 4 })).toBeNull());
  it("gives ten seconds when one gained position is retained", () => expect(lastingAdvantagePenaltyFor({ timeGainSeconds: 0.4, positionsGained: 1, returnedAfterSeconds: null })).toBe("TIME_10"));
  it("uses drive-through when two gained positions are retained", () => expect(lastingAdvantagePenaltyFor({ timeGainSeconds: 1.5, positionsGained: 2, returnedAfterSeconds: null })).toBe("DRIVE_THROUGH"));
});

describe("collision, rejoin and release discretion", () => {
  it("calls light contact with no consequence a racing incident", () => expect(collisionPenaltyFor({ responsibility: 0.62, contactSeverity: 0.12, avoidability: 0.4, victimPositionLoss: 0, victimDamage: 0.02, deliberateIntentProbability: 0, positionReturned: false })).toBeNull());
  it("uses ten seconds for an avoidable rear impact", () => expect(collisionPenaltyFor({ responsibility: 0.82, contactSeverity: 0.62, avoidability: 0.84, victimPositionLoss: 2, victimDamage: 0.28, deliberateIntentProbability: 0.02, positionReturned: false })).toBe("TIME_10"));
  it("mitigates a returned position and harmless contact to five seconds", () => expect(collisionPenaltyFor({ responsibility: 0.72, contactSeverity: 0.4, avoidability: 0.62, victimPositionLoss: 1, victimDamage: 0.08, deliberateIntentProbability: 0, positionReturned: true })).toBe("TIME_5"));
  it("does not punish a low-responsibility driver for a large result", () => expect(collisionPenaltyFor({ responsibility: 0.42, contactSeverity: 0.9, avoidability: 0.3, victimPositionLoss: 6, victimDamage: 0.9, deliberateIntentProbability: 0, positionReturned: false })).toBeNull());
  it("uses drive-through for a clearly responsible high-risk collision", () => expect(collisionPenaltyFor({ responsibility: 0.92, contactSeverity: 0.9, avoidability: 0.9, victimPositionLoss: 5, victimDamage: 0.75, deliberateIntentProbability: 0.1, positionReturned: false })).toBe("DRIVE_THROUGH"));
  it("uses ten seconds for a dangerous rejoin causing major avoidance", () => expect(dangerousRejoinPenaltyFor({ impeded: true, majorAvoidance: true, collision: false })).toBe("TIME_10"));
  it("uses drive-through for a dangerous rejoin collision", () => expect(dangerousRejoinPenaltyFor({ impeded: true, majorAvoidance: true, collision: true })).toBe("DRIVE_THROUGH"));
  it("uses five seconds for an unsafe release requiring heavy braking", () => expect(unsafeReleasePenaltyFor({ heavyBraking: true })).toBe("TIME_5"));
  it("uses ten seconds for an unsafe release requiring major avoidance", () => expect(unsafeReleasePenaltyFor({ majorAvoidance: true })).toBe("TIME_10"));
  it("uses stop-and-go when released in an unsafe mechanical condition", () => expect(unsafeReleasePenaltyFor({ unsafeCondition: true })).toBe("STOP_GO_10"));
});

describe("starts and neutralised race control", () => {
  it("ignores movement inside the start sensor tolerance", () => expect(jumpStartPenaltyFor({ movementMetres: 0.03, movementDurationSeconds: 0.1 })).toBeNull());
  it("uses five seconds for a small sustained jump start", () => expect(jumpStartPenaltyFor({ movementMetres: 0.08, movementDurationSeconds: 0.1 })).toBe("TIME_5"));
  it("uses ten seconds for a clear 0.2 m jump start", () => expect(jumpStartPenaltyFor({ movementMetres: 0.2, movementDurationSeconds: 0.1 })).toBe("TIME_10"));
  it("uses drive-through for a serious 0.5 m jump start", () => expect(jumpStartPenaltyFor({ movementMetres: 0.5, movementDurationSeconds: 0.1 })).toBe("DRIVE_THROUGH"));
  it("maps three red SC/VSC mini-sectors to five seconds", () => expect(miniSectorViolationPenalty(3)).toBe("TIME_5"));
  it("maps four red SC/VSC mini-sectors to ten seconds", () => expect(miniSectorViolationPenalty(4)).toBe("TIME_10"));
  it("dismisses a neutralised pass returned promptly", () => expect(neutralisedOvertakePenaltyFor({ carsPassed: 1, returnedPromptly: true })).toBeNull());
  it("uses ten seconds for one retained VSC pass", () => expect(neutralisedOvertakePenaltyFor({ carsPassed: 1, returnedPromptly: false })).toBe("TIME_10"));
  it("uses drive-through for two retained SC passes", () => expect(neutralisedOvertakePenaltyFor({ carsPassed: 2, returnedPromptly: false })).toBe("DRIVE_THROUGH"));
  it("uses drive-through for failure to slow under double yellow", () => expect(yellowFlagPenaltyFor({ doubleYellow: true, slowed: false, overtook: false })).toBe("DRIVE_THROUGH"));
});

describe("steward score, compound incidents and persistence", () => {
  const baseScore = { responsibility: 80, sportingAdvantage: 30, safetyRisk: 60, consequence: 45, intent: 10, repeatOffence: 0, mitigation: 0 };

  it("reduces the final severity when strong mitigation is present", () => {
    expect(calculateStewardSeverityScore({ ...baseScore, mitigation: 80 })).toBeLessThan(calculateStewardSeverityScore(baseScore));
  });
  it("maps a low score to no further action", () => expect(offenceSeverityFromScore(19.9)).toBe("NONE"));
  it("requires minimum responsibility even after a severe consequence", () => expect(penaltyFromStewardScore({ responsibility: 40, sportingAdvantage: 90, safetyRisk: 100, consequence: 100, intent: 80, repeatOffence: 80, mitigation: 0 })).toBeNull());
  it("deduplicates rejoin and collision sanctions from the same action", () => {
    const decisions = deduplicateIncidentPenalties([
      { incidentId: "one", actionGroup: "rejoin", infringement: "DANGEROUS_REJOIN", penaltyType: "TIME_10", independent: false },
      { incidentId: "one", actionGroup: "rejoin", infringement: "CAUSING_COLLISION", penaltyType: "DRIVE_THROUGH", independent: false },
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].penaltyType).toBe("DRIVE_THROUGH");
  });
  it("preserves independent pit-speeding and unsafe-release sanctions", () => {
    const decisions = deduplicateIncidentPenalties([
      { incidentId: "pit", actionGroup: "speed", infringement: "PIT_SPEEDING", penaltyType: "TIME_5", independent: true },
      { incidentId: "pit", actionGroup: "release", infringement: "UNSAFE_RELEASE", penaltyType: "TIME_10", independent: true },
    ]);
    expect(decisions).toHaveLength(2);
  });
  it("survives JSON save/load with active evidence and steward metrics", () => {
    const initial = createInitialSnapshot(6001);
    const car = initial.cars[0];
    const snapshot: RaceSnapshot = {
      ...initial,
      cars: initial.cars.map((candidate) => candidate.carId === car.carId ? {
        ...candidate,
        pitLimiterFaultSeconds: 0.2,
        pitSpeedingEvidence: { active: true, confirmed: false, startedAt: 12, entrySpeedKph: 80.7, maximumSpeedKph: 80.7, excessSpeedSumKph: 1.4, sampleCount: 2, durationSeconds: 0.2, distanceMetres: 4.5, limiterActive: false },
      } : candidate),
      investigations: [{ id: "save-test", incidentId: "save-incident", carId: car.carId, teamId: car.teamId, driverId: car.driverId, infringement: "PIT_SPEEDING", status: "UNDER_INVESTIGATION", reason: "PIT LANE SPEEDING", evidence: "80.7 km/h", severity: 0.3, responsibility: 1, notedAt: 12, investigationAt: 15, decisionDueAt: 77, decidedAt: null, outcomePenaltyId: null, metrics: { maximumSpeedKph: 80.7, stableSampleCount: 3 } }],
    };
    const restored = JSON.parse(JSON.stringify(snapshot)) as RaceSnapshot;
    expect(restored.cars[0].pitSpeedingEvidence?.maximumSpeedKph).toBe(80.7);
    expect(restored.investigations[0].metrics?.stableSampleCount).toBe(3);
  });
});
