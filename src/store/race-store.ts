import { create } from "zustand";

import type { RaceSnapshot, SimulationSpeed } from "@/domain/race";
import { PLAYER_CAR_IDS } from "@/fixtures/grid";

interface RaceStore {
  snapshot: RaceSnapshot | null;
  speed: SimulationSpeed;
  paused: boolean;
  autoPauseEnabled: boolean;
  autoPauseReason: string | null;
  selectedCarId: string;
  error: string | null;
  snapshotCount: number;
  snapshotReceivedAt: number;
  timingGaps: Record<string, { leader: number; ahead: number; behind: number }>;
  timingGapUpdatedAt: number;
  timingGapRevision: number;
  classificationSignature: string;
  setSnapshot: (snapshot: RaceSnapshot, speed: SimulationSpeed, paused: boolean, autoPauseEnabled?: boolean, autoPauseReason?: string | null) => void;
  setSelectedCarId: (carId: string) => void;
  setError: (message: string) => void;
}

export const useRaceStore = create<RaceStore>((set) => ({
  snapshot: null,
  speed: 1,
  paused: true,
  autoPauseEnabled: true,
  autoPauseReason: null,
  selectedCarId: PLAYER_CAR_IDS[0],
  error: null,
  snapshotCount: 0,
  snapshotReceivedAt: 0,
  timingGaps: {},
  timingGapUpdatedAt: 0,
  timingGapRevision: 0,
  classificationSignature: "",
  setSnapshot: (snapshot, speed, paused, autoPauseEnabled, autoPauseReason) => set((state) => {
    const now = Date.now();
    const classificationSignature = snapshot.cars
      .map((car) => `${car.carId}:${car.racePosition}:${car.pitStatus}`)
      .join("|");
    // Keep normal timing intervals at the broadcast-style one-second cadence,
    // but publish position and gap changes immediately when a pit stop reshuffles
    // the field (including while the Safety Car order is frozen on track).
    const updateTiming = state.timingGapUpdatedAt === 0
      || now - state.timingGapUpdatedAt >= 1_000
      || classificationSignature !== state.classificationSignature;
    return {
      snapshot,
      speed,
      paused,
      autoPauseEnabled: autoPauseEnabled ?? state.autoPauseEnabled,
      autoPauseReason: autoPauseReason ?? null,
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
      classificationSignature,
    };
  }),
  setSelectedCarId: (selectedCarId) => set({ selectedCarId }),
  setError: (error) => set({ error }),
}));
