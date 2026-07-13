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
    useRaceStore.setState({ timingGaps: {}, timingGapUpdatedAt: 0, timingGapRevision: 0 });

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
});
