import { describe, expect, it } from "vitest";
import type { RaceCarState, RaceSnapshot } from "@/domain/race";
import { createInitialSnapshot } from "@/simulation/engine";
import { calculateRacecraftDecision } from "@/simulation/racecraft";
import { SILVERSTONE_WING_ZONES } from "@/simulation/track";

function scenario(
  snapshot: RaceSnapshot,
  attacker: Partial<RaceCarState>,
  defender: Partial<RaceCarState>,
): { cars: readonly RaceCarState[]; attackerId: string } {
  const [first, second] = snapshot.cars;
  const leader: RaceCarState = {
    ...second,
    racePosition: 1,
    totalDistance: 12_000,
    gapToCarAhead: 0,
    gapToCarBehind: 0.6,
    tyreLife: 80,
    batteryPercent: 70,
    incidentStatus: "RUNNING",
    pitStatus: "TRACK",
    finished: false,
    ...defender,
  };
  const chaser: RaceCarState = {
    ...first,
    racePosition: 2,
    totalDistance: 11_970,
    gapToCarAhead: 0.6,
    gapToCarBehind: 9,
    tyreLife: 80,
    batteryPercent: 70,
    incidentStatus: "RUNNING",
    pitStatus: "TRACK",
    finished: false,
    ...attacker,
  };
  return { cars: [leader, chaser], attackerId: chaser.carId };
}

function decide(snapshot: RaceSnapshot, cars: readonly RaceCarState[], carId: string) {
  return calculateRacecraftDecision({ raceControl: "GREEN", weather: snapshot.weather, cars }, carId);
}

describe("racecraft wing-zone awareness", () => {
  it("commits to an attack inside a movable-aero zone", () => {
    const snapshot = createInitialSnapshot(4_401);
    const [wellington] = SILVERSTONE_WING_ZONES;
    const inZone = (wellington.openAtMeters + wellington.closeAtMeters) / 2;
    const { cars, attackerId } = scenario(snapshot, { lapDistance: inZone, gapToCarAhead: 0.8 }, { lapDistance: inZone + 30 });

    const decision = decide(snapshot, cars, attackerId);
    expect(decision.intent).toBe("ATTACK");
    expect(decision.reasons.join(" ")).toContain(wellington.label);
  });

  it("sets the move up while still approaching the zone", () => {
    const snapshot = createInitialSnapshot(4_402);
    const [wellington] = SILVERSTONE_WING_ZONES;
    const approaching = wellington.openAtMeters - 180;
    const { cars, attackerId } = scenario(snapshot, { lapDistance: approaching, gapToCarAhead: 0.9 }, { lapDistance: approaching + 30 });

    expect(decide(snapshot, cars, attackerId).intent).toBe("ATTACK");
  });

  it("presses a clear tyre advantage from beyond the usual attack range", () => {
    const snapshot = createInitialSnapshot(4_403);
    const midLap = 2_400;
    const { cars, attackerId } = scenario(
      snapshot,
      { lapDistance: midLap, gapToCarAhead: 1.8, tyreLife: 88, batteryPercent: 64 },
      { lapDistance: midLap + 60, tyreLife: 52, gapToCarAhead: 12 },
    );

    const decision = decide(snapshot, cars, attackerId);
    expect(decision.intent).toBe("ATTACK");
    expect(decision.reasons.join(" ")).toMatch(/tyre advantage/i);
  });

  it("defends into a zone when the car behind is in range", () => {
    const snapshot = createInitialSnapshot(4_404);
    const hangar = SILVERSTONE_WING_ZONES[1];
    const inZone = (hangar.openAtMeters + hangar.closeAtMeters) / 2;
    const { cars } = scenario(
      snapshot,
      { lapDistance: inZone - 25, gapToCarAhead: 0.9 },
      { lapDistance: inZone, gapToCarBehind: 0.9 },
    );

    expect(decide(snapshot, cars, cars[0].carId).intent).toBe("DEFEND");
  });

  it("does not attack on a low battery even inside a zone", () => {
    const snapshot = createInitialSnapshot(4_405);
    const [wellington] = SILVERSTONE_WING_ZONES;
    const inZone = (wellington.openAtMeters + wellington.closeAtMeters) / 2;
    const { cars, attackerId } = scenario(
      snapshot,
      { lapDistance: inZone, gapToCarAhead: 0.8, batteryPercent: 12 },
      { lapDistance: inZone + 30 },
    );

    expect(decide(snapshot, cars, attackerId).intent).toBe("HARVEST");
  });
});
