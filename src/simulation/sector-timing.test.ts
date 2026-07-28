import { describe, expect, it } from "vitest";

import {
  beginQualifyingLapTiming,
  classifySectorTiming,
  createQualifyingDriverTimingState,
  createQualifyingSessionTimingState,
  finalizeQualifyingLapTiming,
  invalidateQualifyingLapTiming,
  recordProvisionalSector,
} from "@/simulation/sector-timing";

function completeLap(
  driverId: string,
  sectors: readonly [number, number, number],
  driver = createQualifyingDriverTimingState(),
  session = createQualifyingSessionTimingState(),
) {
  let nextDriver = beginQualifyingLapTiming(driver, true);
  sectors.forEach((time, index) => {
    nextDriver = recordProvisionalSector(nextDriver, session, index as 0 | 1 | 2, time);
  });
  return finalizeQualifyingLapTiming(driverId, nextDriver, session, sectors.reduce((sum, time) => sum + time, 0));
}

describe("qualifying sector timing", () => {
  it("marks the session's first competitive sector as purple", () => {
    const session = createQualifyingSessionTimingState();
    const driver = recordProvisionalSector(beginQualifyingLapTiming(createQualifyingDriverTimingState(), true), session, 0, 28.411);
    expect(driver.currentSectorTones[0]).toBe("PURPLE");
    expect(session.bestSectorTimes[0]).toBeNull();
  });

  it("classifies a new session best before storing it", () => {
    const first = completeLap("driver-a", [28.5, 34.2, 26.1]);
    const challenger = beginQualifyingLapTiming(createQualifyingDriverTimingState(), true);
    const provisional = recordProvisionalSector(challenger, first.sessionTiming, 0, 28.2);
    expect(provisional.currentSectorTones[0]).toBe("PURPLE");
    expect(first.sessionTiming.bestSectorTimes[0]).toBe(28.5);
  });

  it("marks a personal best green when it is not the session best", () => {
    const sessionBest = completeLap("driver-a", [28.1, 34.0, 25.9]).sessionTiming;
    const initial = completeLap("driver-b", [28.8, 34.8, 26.4], createQualifyingDriverTimingState(), sessionBest);
    const nextLap = beginQualifyingLapTiming(initial.driverTiming, true);
    const provisional = recordProvisionalSector(nextLap, initial.sessionTiming, 0, 28.5);
    expect(provisional.currentSectorTones[0]).toBe("GREEN");
  });

  it("marks a sector slower than the personal best yellow", () => {
    const baseline = completeLap("driver-a", [28.2, 34.2, 26.2]);
    const lap = beginQualifyingLapTiming(baseline.driverTiming, true);
    expect(recordProvisionalSector(lap, baseline.sessionTiming, 0, 28.7).currentSectorTones[0]).toBe("YELLOW");
  });

  it("keeps the existing holder for a time within 0.001 seconds", () => {
    const baseline = completeLap("driver-a", [28.2, 34.2, 26.2]);
    const tied = completeLap("driver-b", [28.1994, 34.2, 26.2], createQualifyingDriverTimingState(), baseline.sessionTiming);
    expect(tied.sessionTiming.bestSectorTimes).toEqual([28.2, 34.2, 26.2]);
    expect(tied.sessionTiming.bestSectorDriverIds).toEqual(["driver-a", "driver-a", "driver-a"]);
    expect(tied.sessionTiming.bestLapDriverId).toBe("driver-a");
  });

  it("does not commit a track-limits lap", () => {
    const baseline = completeLap("driver-a", [28.2, 34.2, 26.2]);
    let lap = beginQualifyingLapTiming(createQualifyingDriverTimingState(), true);
    [28.0, 33.9, 25.8].forEach((time, index) => { lap = recordProvisionalSector(lap, baseline.sessionTiming, index as 0 | 1 | 2, time); });
    lap = invalidateQualifyingLapTiming(lap);
    const result = finalizeQualifyingLapTiming("driver-b", lap, baseline.sessionTiming, 87.7);
    expect(result.driverTiming.currentSectorTones).toEqual(["INVALID", "INVALID", "INVALID"]);
    expect(result.driverTiming.personalBestLapTimeSeconds).toBeNull();
    expect(result.sessionTiming).toEqual(baseline.sessionTiming);
  });

  it("cancels a provisional purple sector when the lap is invalidated", () => {
    const baseline = completeLap("driver-a", [28.2, 34.2, 26.2]);
    const provisional = recordProvisionalSector(beginQualifyingLapTiming(createQualifyingDriverTimingState(), true), baseline.sessionTiming, 0, 27.9);
    expect(provisional.currentSectorTones[0]).toBe("PURPLE");
    const invalid = invalidateQualifyingLapTiming(provisional);
    expect(invalid.currentSectorTones[0]).toBe("INVALID");
    expect(baseline.sessionTiming.bestSectorTimes[0]).toBe(28.2);
  });

  it("starts Q2 and Q3 with clean segment records", () => {
    const q1 = completeLap("driver-a", [28.2, 34.2, 26.2]);
    expect(q1.sessionTiming.bestLapTimeSeconds).not.toBeNull();
    const q2 = createQualifyingSessionTimingState();
    const q3 = createQualifyingSessionTimingState();
    expect(q2.bestSectorTimes).toEqual([null, null, null]);
    expect(q3.bestLapDriverId).toBeNull();
  });

  it("keeps SC and VSC laps neutral and out of the records", () => {
    const session = createQualifyingSessionTimingState();
    for (const context of ["SC", "VSC"] as const) {
      let lap = beginQualifyingLapTiming(createQualifyingDriverTimingState(), false);
      lap = recordProvisionalSector(lap, session, 0, context === "SC" ? 42.1 : 41.8);
      const result = finalizeQualifyingLapTiming(context, lap, session, 120);
      expect(result.driverTiming.currentSectorTones[0]).toBe("NEUTRAL");
      expect(result.sessionTiming).toEqual(session);
    }
  });

  it("keeps in-lap and out-lap sectors neutral", () => {
    expect(classifySectorTiming({ timeSeconds: 35, lapValid: true, competitive: false, personalBestSeconds: 34, sessionBestSeconds: 33 })).toBe("NEUTRAL");
    expect(classifySectorTiming({ timeSeconds: null, lapValid: true, competitive: true, personalBestSeconds: 34, sessionBestSeconds: 33 })).toBe("NEUTRAL");
  });

  it("changes the purple holder when another driver is strictly faster", () => {
    const first = completeLap("driver-a", [28.2, 34.2, 26.2]);
    const second = completeLap("driver-b", [28.0, 34.0, 26.0], createQualifyingDriverTimingState(), first.sessionTiming);
    expect(second.sessionTiming.bestSectorDriverIds).toEqual(["driver-b", "driver-b", "driver-b"]);
    expect(second.sessionTiming.bestLapDriverId).toBe("driver-b");
  });
});
