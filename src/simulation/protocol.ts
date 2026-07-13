import type { PaceMode, RaceSnapshot, SimulationSpeed, TyreCompound, TyreMode } from "@/domain/race";

export type WorkerCommand =
  | { type: "INIT"; seed: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SET_SPEED"; speed: SimulationSpeed }
  | { type: "SET_PACE"; carId: string; mode: PaceMode }
  | { type: "SET_TYRE_MODE"; carId: string; mode: TyreMode }
  | { type: "BOX"; carId: string; compound: TyreCompound }
  | { type: "CANCEL_PIT"; carId: string }
  | { type: "SET_START_TYRE"; carId: string; compound: TyreCompound }
  | { type: "RESET"; seed: number };

export type WorkerEvent =
  | { type: "SNAPSHOT"; snapshot: RaceSnapshot; speed: SimulationSpeed; paused: boolean }
  | { type: "ERROR"; message: string };
