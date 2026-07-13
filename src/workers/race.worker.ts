/// <reference lib="webworker" />

import type { RaceSnapshot, SimulationSpeed } from "@/domain/race";
import { cancelCarPit, createInitialSnapshot, FIXED_STEP_SECONDS, setCarEnergyMode, setCarPace, setCarPit, setCarStartingTyre, setCarTyreMode, stepSnapshot } from "@/simulation/engine";
import type { WorkerCommand, WorkerEvent } from "@/simulation/protocol";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const STEP_MS = FIXED_STEP_SECONDS * 1_000;
const MAX_STEPS_PER_PULSE = 500;

let snapshot: RaceSnapshot = createInitialSnapshot();
let speed: SimulationSpeed = 1;
let paused = true;
let accumulator = 0;
let previousWallTime = performance.now();
let previousPublishTime = 0;

function publish(): void {
  const event: WorkerEvent = { type: "SNAPSHOT", snapshot, speed, paused };
  context.postMessage(event);
}

function pulse(now: number): void {
  const wallDelta = Math.min(250, now - previousWallTime);
  previousWallTime = now;

  if (!paused && snapshot.status !== "FINISHED") {
    accumulator += wallDelta * speed;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_PULSE) {
      snapshot = stepSnapshot(snapshot);
      accumulator -= STEP_MS;
      steps += 1;
    }
  }

  if (now - previousPublishTime >= 50 || snapshot.status === "FINISHED") {
    publish();
    previousPublishTime = now;
  }
}

context.onmessage = (message: MessageEvent<WorkerCommand>) => {
  try {
    switch (message.data.type) {
      case "INIT":
      case "RESET":
        snapshot = createInitialSnapshot(message.data.seed);
        paused = true;
        accumulator = 0;
        previousWallTime = performance.now();
        publish();
        break;
      case "PLAY":
        paused = false;
        snapshot = { ...snapshot, status: snapshot.status === "FINISHED" ? "FINISHED" : "RUNNING" };
        previousWallTime = performance.now();
        publish();
        break;
      case "PAUSE":
        paused = true;
        snapshot = { ...snapshot, status: snapshot.status === "FINISHED" ? "FINISHED" : "PAUSED" };
        publish();
        break;
      case "SET_SPEED":
        speed = message.data.speed;
        publish();
        break;
      case "SET_PACE":
        snapshot = setCarPace(snapshot, message.data.carId, message.data.mode);
        publish();
        break;
      case "SET_TYRE_MODE":
        snapshot = setCarTyreMode(snapshot, message.data.carId, message.data.mode);
        publish();
        break;
      case "SET_ENERGY_MODE":
        snapshot = setCarEnergyMode(snapshot, message.data.carId, message.data.mode);
        publish();
        break;
      case "BOX":
        snapshot = setCarPit(snapshot, message.data.carId, message.data.compound);
        publish();
        break;
      case "CANCEL_PIT":
        snapshot = cancelCarPit(snapshot, message.data.carId);
        publish();
        break;
      case "SET_START_TYRE":
        snapshot = setCarStartingTyre(snapshot, message.data.carId, message.data.compound);
        publish();
        break;
    }
  } catch (error) {
    const event: WorkerEvent = { type: "ERROR", message: error instanceof Error ? error.message : "Unknown worker error" };
    context.postMessage(event);
  }
};

setInterval(() => pulse(performance.now()), 16);
