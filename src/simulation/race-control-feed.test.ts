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
      scope: "Sector",
      sector: 2,
      message: "YELLOW FLAG IN TRACK SECTOR 2",
    });
  });
});
