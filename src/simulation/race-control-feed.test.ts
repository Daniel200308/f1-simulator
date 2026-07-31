import { describe, expect, it } from "vitest";

import { createInitialSnapshot } from "@/simulation/engine";
import { latestRaceControlNotice } from "@/simulation/race-control-feed";

describe("OpenF1-style race control feed", () => {
  it("keeps a stable track-wide monitoring notice when no directive exists", () => {
    const snapshot = createInitialSnapshot(31);
    expect(latestRaceControlNotice(snapshot)).toMatchObject({
      category: "Other",
      flag: "GREEN",
      scope: "Track",
      headline: "TRACK CLEAR",
      detail: "RACE CONTROL MONITORING · PIT LANE OPEN",
      message: "TRACK CLEAR · RACE CONTROL MONITORING",
    });
  });

  it("maps a car-specific flag message to driver, lap and flag fields", () => {
    const initial = createInitialSnapshot(32);
    const car = initial.cars.find((candidate) => candidate.carId === "ferrari-1")!;
    const snapshot = {
      ...initial,
      radioMessages: [{
        id: "track-limits-16",
        elapsedTime: 90,
        carId: car.carId,
        source: "RACE CONTROL" as const,
        message: "BLACK AND WHITE FLAG FOR CAR 16 (LEC) · TRACK LIMITS",
        priority: "WARNING" as const,
      }],
    };
    expect(latestRaceControlNotice(snapshot)).toMatchObject({
      category: "Flag",
      driverNumber: 16,
      flag: "BLACK AND WHITE",
      headline: "BLACK AND WHITE FLAG",
      detail: "FOR CAR 16 (LEC) · TRACK LIMITS",
      lapNumber: car.currentLap,
      scope: "Driver",
      sector: null,
    });
  });

  it("exposes a sector-scoped yellow even before a text message arrives", () => {
    const snapshot = { ...createInitialSnapshot(33), raceControl: "YELLOW" as const, yellowSector: 2 as const };
    expect(latestRaceControlNotice(snapshot)).toMatchObject({
      category: "Flag",
      flag: "YELLOW",
      headline: "YELLOW FLAG",
      // With no incident on file the sector is all the notice can name.
      detail: "SECTOR 2 INCIDENT · REDUCE SPEED · NO OVERTAKING",
      scope: "Sector",
      sector: 2,
      message: "YELLOW FLAG IN TRACK SECTOR 2",
    });
  });

  it("formats VSC as a yellow-style headline with a separate instruction detail", () => {
    const snapshot = { ...createInitialSnapshot(34), raceControl: "VSC" as const };
    expect(latestRaceControlNotice(snapshot)).toMatchObject({
      flag: "VSC",
      headline: "VIRTUAL SAFETY CAR",
      detail: "MAINTAIN POSITIVE DELTA · NO OVERTAKING",
    });
  });

  it("names the car and place that caused a neutralisation alongside the directive", () => {
    const initial = createInitialSnapshot(35);
    const incidentCar = initial.cars[5];
    const snapshot = {
      ...initial,
      raceControl: "SAFETY_CAR" as const,
      safetyCarPhase: "DEPLOYED" as const,
      activeIncident: {
        carId: incidentCar.carId,
        distanceMeters: 2_840,
        cornerNumber: 15,
        cornerName: "Stowe",
        sector: 2 as const,
        status: "RETIRED" as const,
      },
      radioMessages: [{
        id: "incident-under-investigation",
        elapsedTime: 91,
        carId: incidentCar.carId,
        source: "RACE CONTROL" as const,
        message: "CAR STOPPED · INCIDENT UNDER INVESTIGATION",
        priority: "URGENT" as const,
      }],
    };
    const notice = latestRaceControlNotice(snapshot);
    expect(notice.headline).toBe("SAFETY CAR");
    expect(notice.detail).toContain("FOLLOW SAFETY CAR DELTA");
    /*
     * The pit wall needs to know why the race is neutralised, so the notice names
     * the car, its number and where it stopped before the procedural instruction.
     */
    expect(notice.detail).toContain("STOPPED");
    expect(notice.detail).toContain("STOWE");
    expect(notice.detail).toMatch(/CAR \d+/);
    // The stale investigation message still must not replace the directive.
    expect(notice.detail).not.toContain("UNDER INVESTIGATION");
  });

  it("announces the lap-down wave-by without contradicting it with a no-overtaking instruction", () => {
    const initial = createInitialSnapshot(351);
    const notice = latestRaceControlNotice({
      ...initial,
      raceControl: "SAFETY_CAR",
      safetyCarPhase: "BUNCHING",
      safetyCarLappedCarsMayOvertake: true,
      safetyCarWaveBy: [{ carId: initial.cars.at(-1)!.carId, startDistance: 0, targetDistance: 5_891, completed: false }],
    });

    expect(notice.headline).toContain("MAY NOW OVERTAKE");
    expect(notice.detail).toContain("MAY PASS THE SAFETY CAR");
    expect(notice.detail).not.toContain("OVERTAKING PROHIBITED");
  });

  it("recognises future red-flag messages and preserves their cause", () => {
    const initial = createInitialSnapshot(36);
    const snapshot = {
      ...initial,
      radioMessages: [{
        id: "red-flag-debris",
        elapsedTime: 141,
        carId: null,
        source: "RACE CONTROL" as const,
        message: "RED FLAG · BARRIER REPAIRS REQUIRED AT STOWE",
        priority: "URGENT" as const,
      }],
    };
    expect(latestRaceControlNotice(snapshot)).toMatchObject({
      flag: "RED",
      headline: "RED FLAG",
      detail: "BARRIER REPAIRS REQUIRED AT STOWE",
      priority: "URGENT",
    });
  });
});
