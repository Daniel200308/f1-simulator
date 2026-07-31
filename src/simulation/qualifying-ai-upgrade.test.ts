import { describe, expect, it } from "vitest";

import { raceStartTyreInventory } from "@/simulation/tyre-allocation";
import {
  createWeekendState,
  isQualifyingRecoveryLap,
  practiceReadinessFor,
  runWeekendSession,
  startLiveQualifying,
  tickLiveQualifying,
  type WeekendState,
} from "@/simulation/weekend";

function throughPractice(seed: number, team = "ferrari"): WeekendState {
  const weekend = createWeekendState(seed, team);
  return runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
}

function throughQualifying(seed: number, team = "ferrari"): WeekendState {
  let weekend = throughPractice(seed, team);
  for (const duration of [1_500, 1_250, 1_100]) {
    weekend = startLiveQualifying(weekend);
    weekend = tickLiveQualifying(weekend, duration);
  }
  return weekend;
}

describe("qualifying in-lap consolidation", () => {
  it("has no cool-down phase and recovers between flying laps on an in lap", () => {
    let weekend = throughPractice(20_260_712);
    weekend = startLiveQualifying(weekend);
    const seenPhases = new Set<string>();
    let sawRecoveryLap = false;
    for (let second = 0; second < 1_100 && weekend.currentSession === "Q1"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      for (const car of Object.values(weekend.qualifyingLive?.cars ?? {})) {
        seenPhases.add(car.phase);
        if (isQualifyingRecoveryLap(car)) sawRecoveryLap = true;
      }
    }
    expect([...seenPhases]).not.toContain("COOL_DOWN");
    expect(sawRecoveryLap).toBe(true);
  });

  it("never leaves a car stuck on an in lap once the session ends", () => {
    const weekend = throughQualifying(20_260_712);
    expect(weekend.currentSession).toBe("RACE");
    expect(weekend.results.filter((result) => result.session.startsWith("Q"))).toHaveLength(3);
  });
});

describe("recovery-lap traffic discipline", () => {
  it("keeps recovery laps clear of flying cars and spaced from each other", () => {
    let weekend = throughPractice(20_260_820);
    weekend = startLiveQualifying(weekend);
    let flyingConflicts = 0;
    let convoyed = 0;
    let samples = 0;

    for (let second = 0; second < 1_100 && weekend.currentSession === "Q1"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      const live = weekend.qualifyingLive;
      if (!live || live.session !== "Q1") break;
      const cars = Object.values(live.cars);
      const recovering = cars.filter((car) => isQualifyingRecoveryLap(car));
      if (recovering.length === 0) continue;
      samples += 1;

      /*
       * A recovery lap must not be *scheduled* to reach the timing line
       * alongside a flying car. Only cars that still have room to wait are
       * counted: inside the final seconds of a session the lap cannot be
       * re-timed without throwing away the attempt itself, and close-quarters
       * running there is handled by yielding on track instead.
       */
      for (const car of recovering) {
        for (const other of cars) {
          if (other.carId === car.carId || other.phase !== "PUSH_LAP") continue;
          // Mirrors the simulation's own budget: waiting is only possible while
          // the car's next flying lap still fits inside the session.
          const roomToWait = live.remainingSeconds - car.phaseRemainingSeconds > 96;
          if (roomToWait && Math.abs(car.phaseRemainingSeconds - other.phaseRemainingSeconds) < 2) flyingConflicts += 1;
        }
      }

      /*
       * Recovery laps should not rejoin as a convoy. As with flying traffic,
       * only pairs where the following car still has time to wait are counted.
       */
      for (let index = 0; index < recovering.length; index += 1) {
        for (let other = index + 1; other < recovering.length; other += 1) {
          const later = recovering[index].phaseRemainingSeconds >= recovering[other].phaseRemainingSeconds
            ? recovering[index]
            : recovering[other];
          const roomToWait = live.remainingSeconds - later.phaseRemainingSeconds > 96;
          if (roomToWait && Math.abs(recovering[index].phaseRemainingSeconds - recovering[other].phaseRemainingSeconds) < 2) convoyed += 1;
        }
      }
    }

    expect(samples).toBeGreaterThan(0);
    expect({ flyingConflicts, convoyed }).toEqual({ flyingConflicts: 0, convoyed: 0 });
  });

  it("still yields to an approaching flying car while on a recovery lap", () => {
    let weekend = throughPractice(20_260_825);
    weekend = startLiveQualifying(weekend);
    let yieldedWhileRecovering = false;
    for (let second = 0; second < 1_100 && weekend.currentSession === "Q1"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      for (const car of Object.values(weekend.qualifyingLive?.cars ?? {})) {
        if (isQualifyingRecoveryLap(car) && car.yielding) yieldedWhileRecovering = true;
      }
    }
    expect(yieldedWhileRecovering).toBe(true);
  });

  it("either keeps recovery laps clear of flying cars or makes them respond", () => {
    let weekend = throughPractice(20_260_820);
    weekend = startLiveQualifying(weekend);
    let closeEncounters = 0;
    let respondedToEncounter = 0;

    for (let second = 0; second < 1_100 && weekend.currentSession === "Q1"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      const cars = Object.values(weekend.qualifyingLive?.cars ?? {});
      for (const car of cars) {
        if (!isQualifyingRecoveryLap(car)) continue;
        const flyingNearby = cars.some((other) => other.carId !== car.carId
          && other.phase === "PUSH_LAP"
          && Math.abs(car.phaseRemainingSeconds - other.phaseRemainingSeconds) < 2);
        if (!flyingNearby) continue;
        closeEncounters += 1;
        // The car must be doing something about it: yielding, or already
        // holding a slower spacing pace than its own free-running speed.
        if (car.yielding || car.trafficLevel !== "LOW" || car.currentSpeedKph < 200) respondedToEncounter += 1;
      }
    }

    /*
     * Zero encounters is the better outcome: the re-timed recovery lap kept the
     * car out of the flying car's window in the first place. Whenever one does
     * occur, the car must be reacting to it rather than holding racing pace.
     */
    expect(respondedToEncounter).toBe(closeEncounters);
  });
});

describe("practice readiness feeds qualifying pace", () => {
  it("rates a converged setup above a poor one", () => {
    const weekend = throughPractice(20_260_712);
    const target = weekend.setups["ferrari-1"];
    expect(target).toBeDefined();

    const converged = practiceReadinessFor(weekend, "red-bull-1");
    const scrambled = practiceReadinessFor({
      ...weekend,
      setups: {
        ...weekend.setups,
        "red-bull-1": { frontWing: 35, rearWing: -35, suspension: 35, rideHeight: -35, differential: 35, cooling: -35 },
      },
    }, "red-bull-1");
    expect(converged).toBeGreaterThan(scrambled);
  });

  it("reports readiness inside the documented range for every car", () => {
    const weekend = throughPractice(20_260_712);
    for (const carId of Object.keys(weekend.setups)) {
      const readiness = practiceReadinessFor(weekend, carId);
      expect(readiness).toBeGreaterThanOrEqual(0);
      expect(readiness).toBeLessThanOrEqual(1);
    }
  });
});

describe("post-Q3 tyre life reaches race preparation", () => {
  it("exposes scrubbed sets with the life they have left after qualifying", () => {
    const weekend = throughQualifying(20_260_712);
    // An AI car runs its own programme across all three segments, so its
    // allocation shows the wear that qualifying actually put into the sets.
    const sets = raceStartTyreInventory("red-bull-1", weekend.tyreInventory);
    expect(sets.length).toBeGreaterThan(0);

    const scrubbed = sets.filter((set) => set.freshness === "USED");
    expect(scrubbed.length).toBeGreaterThan(0);
    // A used set must report real wear rather than a placeholder 100%.
    expect(scrubbed.some((set) => set.condition < 100)).toBe(true);
    expect(sets.every((set) => set.condition >= 0 && set.condition <= 100)).toBe(true);
  });

  it("records the exact segment each scrubbed set was used in", () => {
    const weekend = throughQualifying(20_260_712);
    const used = (weekend.tyreInventory["red-bull-1"] ?? []).filter((set) => set.sessionHistory.length > 0);
    expect(used.length).toBeGreaterThan(0);
    // Q3 running must be represented, so race preparation reflects post-Q3 life.
    expect(used.some((set) => set.sessionHistory.includes("Q3"))).toBe(true);
    expect(used.every((set) => set.wearPercent > 0 && set.lapsCompleted > 0)).toBe(true);
  });
});
