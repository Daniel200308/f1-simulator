import type { CoolingMode, EnergyMode, PaceMode, RaceSnapshot, SimulationSpeed, TyreCompound, TyreMode, WeekendTyreUsage } from "@/domain/race";

export type WorkerCommand =
  | { type: "INIT"; seed: number; playerTeamId?: string; gridOrder?: readonly string[]; weekendTyreUsage?: WeekendTyreUsage; setupPerformanceByCar?: Readonly<Record<string, number>> }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SET_AUTO_PAUSE"; enabled: boolean }
  | { type: "SET_SPEED"; speed: SimulationSpeed }
  | { type: "SET_PACE"; carId: string; mode: PaceMode }
  | { type: "SET_TYRE_MODE"; carId: string; mode: TyreMode }
  | { type: "SET_ENERGY_MODE"; carId: string; mode: EnergyMode }
  | { type: "SET_COOLING_MODE"; carId: string; mode: CoolingMode }
  | { type: "SET_BRAKE_BIAS"; carId: string; brakeBiasPercent: number }
  | { type: "BOX"; carId: string; compound: TyreCompound }
  | { type: "CANCEL_PIT"; carId: string }
  | { type: "SET_START_TYRE"; carId: string; compound: TyreCompound }
  | { type: "RESET"; seed: number; playerTeamId?: string; gridOrder?: readonly string[]; weekendTyreUsage?: WeekendTyreUsage; setupPerformanceByCar?: Readonly<Record<string, number>> };

export type WorkerEvent =
  | { type: "SNAPSHOT"; snapshot: RaceSnapshot; speed: SimulationSpeed; paused: boolean; autoPauseEnabled: boolean; autoPauseReason: string | null }
  | { type: "ERROR"; message: string };
