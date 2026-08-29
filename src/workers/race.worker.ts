/// <reference lib="webworker" />

import type { RaceSnapshot, SimulationSpeed } from "@/domain/race";
import { cancelCarPit, createInitialSnapshot, debugEnergyState, FIXED_STEP_SECONDS, requestPenaltyService, setCarCoolingMode, setCarEnergyMode, setCarPace, setCarPit, setCarStartingTyre, setCarTyreMode, setTeamOrder, stepSnapshot } from "@/simulation/engine";
import type { WorkerCommand, WorkerEvent } from "@/simulation/protocol";
import { criticalRaceControlTransition } from "@/simulation/race-control-transitions";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const STEP_MS = FIXED_STEP_SECONDS * 1_000;
const MAX_STEPS_PER_PULSE = 500;

let snapshot: RaceSnapshot = createInitialSnapshot();
let speed: SimulationSpeed = 1;
let paused = true;
let autoPauseEnabled = true;
let autoPauseReason: string | null = null;
let accumulator = 0;
let previousWallTime = performance.now();
let previousPublishTime = 0;
let lastPublishedTick = -1;

function publish(): void {
  const event: WorkerEvent = { type: "SNAPSHOT", snapshot, speed, paused, autoPauseEnabled, autoPauseReason };
  context.postMessage(event);
  lastPublishedTick = snapshot.tick;
}

function pulse(now: number): void {
  const wallDelta = Math.min(250, now - previousWallTime);
  previousWallTime = now;

  if (!paused && snapshot.status !== "FINISHED") {
    accumulator += wallDelta * speed;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_PULSE) {
      const previous = snapshot;
      snapshot = stepSnapshot(snapshot);
      accumulator -= STEP_MS;
      steps += 1;
      const transitionReason = autoPauseEnabled ? criticalRaceControlTransition(previous, snapshot) : null;
      if (transitionReason) {
        autoPauseReason = transitionReason;
        paused = true;
        accumulator = 0;
        snapshot = { ...snapshot, status: snapshot.status === "FINISHED" ? "FINISHED" : "PAUSED" };
        break;
      }
    }
  }

  const snapshotAdvanced = snapshot.tick !== lastPublishedTick;
  const livePublishDue = !paused && snapshot.status !== "FINISHED" && now - previousPublishTime >= 50;
  const settledSnapshotChanged = snapshotAdvanced && (paused || snapshot.status === "FINISHED");
  if (livePublishDue || settledSnapshotChanged) {
    publish();
    previousPublishTime = now;
  }
}

context.onmessage = (message: MessageEvent<WorkerCommand>) => {
  try {
    switch (message.data.type) {
      case "INIT":
      case "RESET":
        snapshot = createInitialSnapshot(message.data.seed, "PAUSED", message.data.gridOrder, message.data.weekendTyreUsage, message.data.setupPerformanceByCar, message.data.playerTeamId, message.data.weekendTyreInventory, message.data.circuitId, message.data.reliabilityByCar);
        paused = true;
        autoPauseReason = null;
        accumulator = 0;
        previousWallTime = performance.now();
        publish();
        break;
      case "LOAD_SNAPSHOT":
        snapshot = message.data.snapshot;
        speed = message.data.speed ?? 1;
        paused = message.data.paused ?? true;
        autoPauseReason = null;
        accumulator = 0;
        previousWallTime = performance.now();
        if (paused && snapshot.status === "RUNNING") snapshot = { ...snapshot, status: "PAUSED" };
        publish();
        break;
      case "PLAY":
        paused = false;
        autoPauseReason = null;
        snapshot = { ...snapshot, status: snapshot.status === "FINISHED" ? "FINISHED" : "RUNNING" };
        previousWallTime = performance.now();
        publish();
        break;
      case "PAUSE":
        paused = true;
        autoPauseReason = null;
        snapshot = { ...snapshot, status: snapshot.status === "FINISHED" ? "FINISHED" : "PAUSED" };
        publish();
        break;
      case "SET_AUTO_PAUSE":
        autoPauseEnabled = message.data.enabled;
        if (!autoPauseEnabled) autoPauseReason = null;
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
      case "SET_TEAM_ORDER":
        snapshot = setTeamOrder(snapshot, message.data.order);
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
      case "DEBUG_ENERGY":
        snapshot = debugEnergyState(snapshot, message.data.carId, message.data.action);
        publish();
        break;
      case "SET_COOLING_MODE":
        snapshot = setCarCoolingMode(snapshot, message.data.carId, message.data.mode);
        publish();
        break;
      case "BOX":
        snapshot = setCarPit(snapshot, message.data.carId, message.data.compound, message.data.tyreSetId);
        publish();
        break;
      case "SERVE_PENALTY":
        snapshot = requestPenaltyService(snapshot, message.data.carId);
        publish();
        break;
      case "CANCEL_PIT":
        snapshot = cancelCarPit(snapshot, message.data.carId);
        publish();
        break;
      case "SET_START_TYRE":
        snapshot = setCarStartingTyre(snapshot, message.data.carId, message.data.compound, message.data.tyreSetId);
        publish();
        break;
    }
  } catch (error) {
    const event: WorkerEvent = { type: "ERROR", message: error instanceof Error ? error.message : "Unknown worker error" };
    context.postMessage(event);
  }
};

setInterval(() => pulse(performance.now()), 16);
