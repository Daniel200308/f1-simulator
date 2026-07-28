import { describe, expect, it } from "vitest";

import type { QualifyingCarState } from "@/simulation/weekend";
import {
  activeQualifyingTrafficTargets,
  interpolateTrackProgress,
  QUALIFYING_PIT_BOX_PROGRESS,
  QUALIFYING_PIT_SAMPLE_COUNT,
  QUALIFYING_PIT_SAMPLES,
  QUALIFYING_TRACK_SAMPLE_COUNT,
  QUALIFYING_TRACK_SAMPLES,
  qualifyingTrafficTarget,
  sampledPitPoint,
  sampledTrackPoint,
} from "@/simulation/qualifying-traffic";

function car(overrides: Partial<QualifyingCarState> = {}): QualifyingCarState {
  return {
    carId: "ferrari-1",
    phase: "GARAGE",
    phaseRemainingSeconds: 0,
    phaseDurationSeconds: 0,
    selectedCompound: "SOFT",
    selectedTyreSetId: null,
    fittedRunStartCompletedRuns: 0,
    tyreTemperatures: { frontLeft: 82, frontRight: 82, rearLeft: 82, rearRight: 82 },
    tyreTemperatureC: 82,
    tyreConditionPercent: 100,
    currentSpeedKph: 0,
    previousSpeedKph: 0,
    energyPercent: 100,
    outLapMode: "BALANCED",
    attackMode: "NORMAL",
    energyMode: "QUALI",
    phaseStartProgress: 0,
    releaseRequest: "NONE",
    releaseRequestedAtSeconds: null,
    trafficResponse: "MAINTAIN_GAP",
    fuelPlan: "ONE_LAP",
    fuelLoadKg: 1.8,
    flyingLapsRemaining: 1,
    trafficLevel: "LOW",
    gapAheadSeconds: null,
    gapBehindSeconds: null,
    yielding: false,
    yieldingToCarId: null,
    yieldingDurationSeconds: 0,
    yieldCooldownSeconds: 0,
    impedingInvestigation: false,
    flyingConflictSeconds: 0,
    trafficConflictCarId: null,
    trafficConflictGapSeconds: null,
    trafficDecisionState: "NONE",
    trafficDecisionMessage: null,
    completedRuns: 0,
    bestLapSeconds: null,
    lastLapSeconds: null,
    trafficPenaltySeconds: 0,
    lastRunNote: "NO TIME",
    timing: {
      currentSectorTimes: [null, null, null],
      currentSectorTones: ["NEUTRAL", "NEUTRAL", "NEUTRAL"],
      personalBestSectorTimes: [null, null, null],
      currentLapTimeSeconds: null,
      personalBestLapTimeSeconds: null,
      currentLapValid: true,
      currentLapCompetitive: false,
    },
    provisionalSectorTargets: null,
    provisionalLapOutcome: null,
    provisionalTrafficAppliedSeconds: 0,
    ...overrides,
  };
}

describe("qualifying traffic animation model", () => {
  it("pre-samples fixed centreline and pit-lane coordinate arrays once", () => {
    expect(QUALIFYING_TRACK_SAMPLES).toBeInstanceOf(Float32Array);
    expect(QUALIFYING_TRACK_SAMPLES).toHaveLength(QUALIFYING_TRACK_SAMPLE_COUNT * 2);
    expect(QUALIFYING_PIT_SAMPLES).toHaveLength(QUALIFYING_PIT_SAMPLE_COUNT * 2);
    expect(Object.values(sampledTrackPoint(0.42)).every(Number.isFinite)).toBe(true);
  });

  it("excludes garage cars while retaining track and moving pit-lane cars", () => {
    const targets = activeQualifyingTrafficTargets({
      garage: car({ carId: "garage", phase: "GARAGE" }),
      track: car({ carId: "track", phase: "PUSH_LAP", phaseDurationSeconds: 90, phaseRemainingSeconds: 45 }),
      pit: car({ carId: "pit", phase: "OUT_LAP", phaseDurationSeconds: 100, phaseRemainingSeconds: 95 }),
    });
    expect(targets.map((target) => target.carId)).toEqual(["track", "pit"]);
    expect(targets.find((target) => target.carId === "pit")?.pitLane).toBe(true);
  });

  it("stores every active car position as a normalised progress value", () => {
    const target = qualifyingTrafficTarget(car({ phase: "PUSH_LAP", phaseDurationSeconds: 100, phaseRemainingSeconds: 35 }));
    expect(target?.progress).toBeCloseTo(0.65, 6);
    expect(target?.progress).toBeGreaterThanOrEqual(0);
    expect(target?.progress).toBeLessThan(1);
  });

  it("keeps an in-lap on track, then follows pit entry to the garage box", () => {
    const inLapStart = qualifyingTrafficTarget(car({
      phase: "IN_LAP",
      phaseStartProgress: 0.31,
      phaseDurationSeconds: 60,
      phaseRemainingSeconds: 60,
    }));
    const inLapEnd = qualifyingTrafficTarget(car({
      phase: "IN_LAP",
      phaseStartProgress: 0.31,
      phaseDurationSeconds: 60,
      phaseRemainingSeconds: 0,
    }));
    const pitStart = qualifyingTrafficTarget(car({ phase: "PIT_ENTRY", phaseDurationSeconds: 7, phaseRemainingSeconds: 7 }));
    const pitBox = qualifyingTrafficTarget(car({ phase: "PIT_ENTRY", phaseDurationSeconds: 7, phaseRemainingSeconds: 0 }));

    expect(inLapStart?.pitLane).toBe(false);
    expect(inLapStart?.progress).toBeCloseTo(0.31, 8);
    expect(inLapEnd?.pitLane).toBe(false);
    expect(pitStart).toMatchObject({ pitLane: true, progress: 0 });
    expect(pitBox?.pitLane).toBe(true);
    expect(pitBox?.progress).toBeCloseTo(QUALIFYING_PIT_BOX_PROGRESS, 8);
    expect(sampledPitPoint(pitStart!.progress)).not.toEqual(sampledPitPoint(pitBox!.progress));
  });

  it("interpolates smoothly across the start-finish wrap", () => {
    const halfway = interpolateTrackProgress(0.98, 0.02, 0.5);
    expect(Math.min(halfway, 1 - halfway)).toBeLessThan(0.001);
    expect(interpolateTrackProgress(0.2, 0.4, 0.5)).toBeCloseTo(0.3, 6);
  });
});
