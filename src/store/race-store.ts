import { create } from "zustand";

import type { RaceSnapshot, SimulationSpeed } from "@/domain/race";
import { PLAYER_CAR_IDS } from "@/fixtures/grid";

interface RaceStore {
  snapshot: RaceSnapshot | null;
  speed: SimulationSpeed;
  paused: boolean;
  selectedCarId: string;
  error: string | null;
  snapshotCount: number;
  snapshotReceivedAt: number;
  timingGaps: Record<string, { leader: number; ahead: number; behind: number }>;
  timingGapUpdatedAt: number;
  timingGapRevision: number;
  setSnapshot: (snapshot: RaceSnapshot, speed: SimulationSpeed, paused: boolean) => void;
  setSelectedCarId: (carId: string) => void;
  setError: (message: string) => void;
}

export const useRaceStore = create<RaceStore>((set) => ({
  snapshot: null,
  speed: 1,
  paused: true,
  selectedCarId: PLAYER_CAR_IDS[0],
  error: null,
  snapshotCount: 0,
  snapshotReceivedAt: 0,
  timingGaps: {},
  timingGapUpdatedAt: 0,
  timingGapRevision: 0,
  setSnapshot: (snapshot, speed, paused) => set((state) => {
    const now = Date.now();
    const updateTiming = state.timingGapUpdatedAt === 0 || now - state.timingGapUpdatedAt >= 1_000;
    return {
      snapshot,
      speed,
      paused,
      error: null,
      snapshotCount: state.snapshotCount + 1,
      snapshotReceivedAt: now,
      timingGaps: updateTiming
        ? Object.fromEntries(snapshot.cars.map((car) => [car.carId, {
          leader: car.gapToLeader,
          ahead: car.gapToCarAhead,
          behind: car.gapToCarBehind,
        }]))
        : state.timingGaps,
      timingGapUpdatedAt: updateTiming ? now : state.timingGapUpdatedAt,
      timingGapRevision: updateTiming ? state.timingGapRevision + 1 : state.timingGapRevision,
    };
  }),
  setSelectedCarId: (selectedCarId) => set({ selectedCarId }),
  setError: (error) => set({ error }),
}));
