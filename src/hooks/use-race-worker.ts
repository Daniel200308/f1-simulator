"use client";

import { useCallback, useEffect, useRef } from "react";

import type { CoolingMode, EnergyMode, PaceMode, SimulationSpeed, TyreCompound, TyreMode } from "@/domain/race";
import { DEFAULT_SEED } from "@/simulation/engine";
import type { WorkerCommand, WorkerEvent } from "@/simulation/protocol";
import { useRaceStore } from "@/store/race-store";

export function useRaceWorker() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/race.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (message: MessageEvent<WorkerEvent>) => {
      if (message.data.type === "SNAPSHOT") {
        useRaceStore.getState().setSnapshot(
          message.data.snapshot,
          message.data.speed,
          message.data.paused,
          message.data.autoPauseEnabled,
          message.data.autoPauseReason,
        );
      } else {
        useRaceStore.getState().setError(message.data.message);
      }
    };
    worker.onerror = (event) => useRaceStore.getState().setError(event.message || "Simulation worker crashed");
    worker.postMessage({ type: "INIT", seed: DEFAULT_SEED } satisfies WorkerCommand);
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = useCallback((command: WorkerCommand) => workerRef.current?.postMessage(command), []);

  return {
    play: () => send({ type: "PLAY" }),
    pause: () => send({ type: "PAUSE" }),
    setAutoPause: (enabled: boolean) => send({ type: "SET_AUTO_PAUSE", enabled }),
    setSpeed: (speed: SimulationSpeed) => send({ type: "SET_SPEED", speed }),
    setPace: (carId: string, mode: PaceMode) => send({ type: "SET_PACE", carId, mode }),
    setTyreMode: (carId: string, mode: TyreMode) => send({ type: "SET_TYRE_MODE", carId, mode }),
    setEnergyMode: (carId: string, mode: EnergyMode) => send({ type: "SET_ENERGY_MODE", carId, mode }),
    setCoolingMode: (carId: string, mode: CoolingMode) => send({ type: "SET_COOLING_MODE", carId, mode }),
    setBrakeBias: (carId: string, brakeBiasPercent: number) => send({ type: "SET_BRAKE_BIAS", carId, brakeBiasPercent }),
    box: (carId: string, compound: TyreCompound) => send({ type: "BOX", carId, compound }),
    stayOut: (carId: string) => send({ type: "CANCEL_PIT", carId }),
    setStartingTyre: (carId: string, compound: TyreCompound) => send({ type: "SET_START_TYRE", carId, compound }),
    reset: (seed = DEFAULT_SEED) => send({ type: "RESET", seed }),
  };
}
