import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialSnapshot } from "@/simulation/engine";
import { useRaceStore } from "@/store/race-store";

describe("race timing store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("samples displayed gaps once per real second", () => {
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    useRaceStore.setState({ timingGaps: {}, timingGapUpdatedAt: 0, timingGapRevision: 0, classificationSignature: "" });

    const initial = createInitialSnapshot();
    const carId = initial.cars[1].carId;
    useRaceStore.getState().setSnapshot(initial, 1, false);
    const firstGap = useRaceStore.getState().timingGaps[carId].leader;
    expect(useRaceStore.getState().timingGapRevision).toBe(1);

    now += 999;
    const changed = {
      ...initial,
      cars: initial.cars.map((car) => car.carId === carId ? { ...car, gapToLeader: firstGap + 1.234 } : car),
    };
    useRaceStore.getState().setSnapshot(changed, 1, false);
    expect(useRaceStore.getState().timingGaps[carId].leader).toBe(firstGap);
    expect(useRaceStore.getState().timingGapRevision).toBe(1);

    now += 1;
    useRaceStore.getState().setSnapshot(changed, 1, false);
    expect(useRaceStore.getState().timingGaps[carId].leader).toBe(firstGap + 1.234);
    expect(useRaceStore.getState().timingGapRevision).toBe(2);
  });

  it("keeps worker-side event auto-pause metadata in sync", () => {
    const snapshot = createInitialSnapshot();
    useRaceStore.getState().setSnapshot(snapshot, 16, true, false, "SAFETY CAR DEPLOYED");

    expect(useRaceStore.getState()).toMatchObject({
      speed: 16,
      paused: true,
      autoPauseEnabled: false,
      autoPauseReason: "SAFETY CAR DEPLOYED",
    });
  });

  it("publishes a pit-lane position change immediately without changing the normal gap cadence", () => {
    vi.spyOn(Date, "now").mockReturnValue(200_000);
    useRaceStore.setState({ timingGaps: {}, timingGapUpdatedAt: 0, timingGapRevision: 0, classificationSignature: "" });

    const initial = createInitialSnapshot(9_092);
    useRaceStore.getState().setSnapshot(initial, 1, true);
    const firstRevision = useRaceStore.getState().timingGapRevision;
    const pittingCar = initial.cars[2];
    const passedCar = initial.cars[3];
    const pitShuffle = {
      ...initial,
      tick: initial.tick + 1,
      cars: initial.cars.map((car) => car.carId === pittingCar.carId
        ? { ...car, racePosition: 4, pitStatus: "PIT_LANE" as const, gapToCarAhead: 0.8 }
        : car.carId === passedCar.carId
          ? { ...car, racePosition: 3, gapToCarAhead: 0.2 }
          : car),
    };
    useRaceStore.getState().setSnapshot(pitShuffle, 1, true);

    expect(useRaceStore.getState().timingGapRevision).toBe(firstRevision + 1);
    expect(useRaceStore.getState().timingGaps[pittingCar.carId].ahead).toBe(0.8);
  });
});
