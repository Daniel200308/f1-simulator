import { describe, expect, it } from "vitest";

import type { EnergyDeploymentMode, EnergyManagementContext, EnergySystemState } from "@/domain/energy";
import { ENERGY_SYSTEM_CONFIG } from "@/simulation/energy/energy-config";
import { deserializeRaceSnapshot, serializeRaceSnapshot } from "@/simulation/energy/energy-persistence";
import { buildTrackEnergyPlan, predictEnergySoc } from "@/simulation/energy/energy-prediction";
import { chooseAiEnergyMode } from "@/simulation/energy/energy-strategy";
import { completeEnergyLap, createEnergySystemState, updateEnergySystem } from "@/simulation/energy/energy-system";
import { createInitialSnapshot } from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

function context(overrides: Partial<EnergyManagementContext> = {}): EnergyManagementContext {
  return {
    sessionType: "RACE",
    lapNumber: 12,
    totalLaps: 52,
    lapProgress: 0.3,
    currentSoc: 0.7,
    targetLapEndSoc: 0.55,
    predictedLapEndSoc: 0.58,
    trackPosition: 4,
    gapAheadSeconds: 0.7,
    gapBehindSeconds: 1.8,
    currentSegmentType: "STRAIGHT",
    segmentLength: 620,
    segmentProgress: 0.25,
    vehicleSpeed: 260,
    previousVehicleSpeed: 260,
    tyreGrip: 0.98,
    weatherGrip: 1,
    airTemperatureC: 22,
    trafficCoolingLoss: 0,
    safetyCarActive: false,
    virtualSafetyCarActive: false,
    pitLaneActive: false,
    overtakeEntitled: false,
    overtakeActivationZone: false,
    driverAttackIntent: 0.8,
    driverDefenceIntent: 0.2,
    ...overrides,
  };
}

function advance(state: EnergySystemState, seconds: number, step: number, mode: EnergyDeploymentMode = "ATTACK", overrides: Partial<EnergyManagementContext> = {}): EnergySystemState {
  let next = state;
  const count = Math.round(seconds / step);
  for (let index = 0; index < count; index += 1) {
    next = updateEnergySystem({ state: next, requestedMode: mode, context: context(overrides), deltaTimeSeconds: step }).state;
  }
  return next;
}

describe("2026 electrical energy system", () => {
  it("decreases SOC under deployment and increases it under braking recovery", () => {
    const deployed = advance(createEnergySystemState(0.8), 2, 0.1, "ATTACK");
    const harvested = advance(createEnergySystemState(0.4), 2, 0.1, "HARVEST", { currentSegmentType: "SLOW", segmentLength: 180, vehicleSpeed: 135 });
    expect(deployed.stateOfCharge).toBeLessThan(0.8);
    expect(deployed.currentDeployPowerKW).toBeGreaterThan(100);
    expect(harvested.stateOfCharge).toBeGreaterThan(0.4);
    expect(harvested.currentHarvestPowerKW).toBeGreaterThan(100);
  });

  it("automatically deploys on straights and recovers under braking in every driver tendency", () => {
    const modes: readonly EnergyDeploymentMode[] = ["HARVEST", "CONSERVE", "BALANCED", "ATTACK", "BOOST", "OVERTAKE"];
    for (const mode of modes) {
      const entitled = mode === "OVERTAKE";
      const straight = updateEnergySystem({
        state: createEnergySystemState(0.72),
        requestedMode: mode,
        context: context({ overtakeEntitled: entitled, overtakeActivationZone: entitled }),
        deltaTimeSeconds: 0.1,
      }).state;
      const braking = updateEnergySystem({
        state: createEnergySystemState(0.5),
        requestedMode: mode,
        context: context({ currentSegmentType: "SLOW", vehicleSpeed: 120, previousVehicleSpeed: 250 }),
        deltaTimeSeconds: 0.1,
      }).state;
      expect(straight.currentDeployPowerKW, `${mode} straight deployment`).toBeGreaterThan(20);
      expect(braking.currentHarvestPowerKW, `${mode} braking recovery`).toBeGreaterThan(100);
    }
  });

  it("never leaves the physical battery bounds", () => {
    const empty = advance(createEnergySystemState(0.001), 30, 0.1, "ATTACK");
    const full = advance(createEnergySystemState(0.999), 30, 0.1, "HARVEST", { currentSegmentType: "SLOW", vehicleSpeed: 120 });
    expect(empty.storedEnergyMJ).toBeGreaterThanOrEqual(0);
    expect(empty.stateOfCharge).toBeGreaterThanOrEqual(0);
    expect(full.storedEnergyMJ).toBeLessThanOrEqual(ENERGY_SYSTEM_CONFIG.batteryCapacityMJ);
    expect(full.stateOfCharge).toBeLessThanOrEqual(1);
  });

  it("is stable across different deltaTime sizes", () => {
    const fine = advance(createEnergySystemState(0.76), 5, 0.1, "BALANCED");
    const coarse = advance(createEnergySystemState(0.76), 5, 0.5, "BALANCED");
    expect(Math.abs(fine.stateOfCharge - coarse.stateOfCharge)).toBeLessThan(0.006);
    expect(Math.abs(fine.batteryTemperatureC - coarse.batteryTemperatureC)).toBeLessThan(0.08);
  });

  it("limits deployment at minimum SOC and recovery at maximum SOC", () => {
    const low = updateEnergySystem({ state: createEnergySystemState(ENERGY_SYSTEM_CONFIG.minimumUsableSoc), requestedMode: "BOOST", context: context(), deltaTimeSeconds: 0.1 }).state;
    const high = updateEnergySystem({ state: createEnergySystemState(ENERGY_SYSTEM_CONFIG.maximumUsableSoc), requestedMode: "HARVEST", context: context({ currentSegmentType: "SLOW" }), deltaTimeSeconds: 0.1 }).state;
    expect(low.currentDeployPowerKW).toBe(0);
    expect(high.currentHarvestPowerKW).toBe(0);
  });

  it("derates a hot pack and reduces cold-pack efficiency", () => {
    const warm = updateEnergySystem({ state: createEnergySystemState(0.8, 42), requestedMode: "BOOST", context: context(), deltaTimeSeconds: 0.1 }).state;
    const hot = updateEnergySystem({ state: createEnergySystemState(0.8, 68), requestedMode: "BOOST", context: context(), deltaTimeSeconds: 0.1 }).state;
    const cold = updateEnergySystem({ state: createEnergySystemState(0.8, 8), requestedMode: "BOOST", context: context({ airTemperatureC: 5 }), deltaTimeSeconds: 0.1 }).state;
    expect(hot.deratingActive).toBe(true);
    expect(hot.currentDeployPowerKW).toBeLessThan(warm.currentDeployPowerKW);
    expect(cold.currentDeployPowerKW).toBeLessThan(warm.currentDeployPowerKW);
  });

  it("activates clipping late on a straight when predicted SOC is below target", () => {
    const clipping = updateEnergySystem({
      state: { ...createEnergySystemState(0.14), predictedSocAtLapEnd: 0.12, targetSocAtLapEnd: 0.55 },
      requestedMode: "ATTACK",
      context: context({ segmentProgress: 0.82, lapProgress: 0.74, currentSoc: 0.14, predictedLapEndSoc: 0.12 }),
      deltaTimeSeconds: 0.1,
    }).state;
    expect(clipping.clippingActive).toBe(true);
    expect(clipping.currentDeployPowerKW).toBeLessThan(ENERGY_SYSTEM_CONFIG.maxDeployPowerKW * 0.5);
  });

  it("resets lap counters while retaining totals", () => {
    const used = advance(createEnergySystemState(0.8), 3, 0.1, "ATTACK");
    const reset = completeEnergyLap(used);
    expect(reset.deployedEnergyThisLapMJ).toBe(0);
    expect(reset.harvestedEnergyThisLapMJ).toBe(0);
    expect(reset.lastLapDeployedEnergyMJ).toBeGreaterThan(0);
    expect(reset.totalDeployedEnergyMJ).toBe(used.totalDeployedEnergyMJ);
  });

  it("enforces Boost conditions and activates Overtake automatically in an entitled zone", () => {
    const boost = updateEnergySystem({ state: createEnergySystemState(0.8), requestedMode: "BOOST", context: context({ gapAheadSeconds: 2 }), deltaTimeSeconds: 0.1 }).state;
    const unavailable = updateEnergySystem({ state: createEnergySystemState(0.8), requestedMode: "OVERTAKE", context: context({ overtakeEntitled: false, overtakeActivationZone: true }), deltaTimeSeconds: 0.1 }).state;
    const available = updateEnergySystem({ state: createEnergySystemState(0.8), requestedMode: "BALANCED", context: context({ overtakeEntitled: true, overtakeActivationZone: true }), deltaTimeSeconds: 0.1 }).state;
    const restored = updateEnergySystem({ state: available, requestedMode: "BALANCED", context: context({ overtakeEntitled: true, overtakeActivationZone: false }), deltaTimeSeconds: 0.1 }).state;
    expect(boost.boostActive).toBe(true);
    expect(unavailable.overtakeActive).toBe(false);
    expect(available.overtakeEligible).toBe(true);
    expect(available.overtakeActive).toBe(true);
    expect(available.deploymentMode).toBe("OVERTAKE");
    expect(restored.overtakeActive).toBe(false);
    expect(restored.deploymentMode).toBe("BALANCED");
  });

  it("recovers under Safety Car and releases the final-lap reserve", () => {
    const safety = updateEnergySystem({ state: createEnergySystemState(0.45), requestedMode: "BALANCED", context: context({ safetyCarActive: true, vehicleSpeed: 120 }), deltaTimeSeconds: 1 }).state;
    const finalLap = updateEnergySystem({ state: createEnergySystemState(0.7), requestedMode: "ATTACK", context: context({ lapNumber: 52 }), deltaTimeSeconds: 0.1 }).state;
    expect(safety.currentDeployPowerKW).toBe(0);
    expect(safety.currentHarvestPowerKW).toBeGreaterThan(0);
    expect(safety.stateOfCharge).toBeGreaterThan(0.45);
    expect(finalLap.targetSocAtLapEnd).toBe(0.09);
  });

  it("uses deterministic utility AI with no hidden battery bonus", () => {
    const low = createEnergySystemState(0.12);
    const neutralised = chooseAiEnergyMode(low, context({ safetyCarActive: true, currentSoc: 0.12 }));
    const pass = chooseAiEnergyMode({ ...createEnergySystemState(0.78), overtakeEligible: true }, context({ gapAheadSeconds: 0.5 }));
    // The AI picks from the same three usage levels the player has, so a
    // neutralised lap takes the saving level rather than a separate map.
    expect(neutralised.mode).toBe("CONSERVE");
    expect(pass.mode).toBe("OVERTAKE");
  });

  it("uses different qualifying recovery and flying-lap deployment programmes", () => {
    const state = createEnergySystemState(0.76);
    const outLap = chooseAiEnergyMode(state, context({ sessionType: "QUALIFYING", lapProgress: 0.08 }));
    const flyingLap = chooseAiEnergyMode(state, context({ sessionType: "QUALIFYING", lapProgress: 0.52 }));
    const outLapState = updateEnergySystem({ state, requestedMode: outLap.mode, context: context({ sessionType: "QUALIFYING", lapProgress: 0.08, currentSegmentType: "SLOW" }), deltaTimeSeconds: 1 }).state;
    const flyingLapState = updateEnergySystem({ state, requestedMode: flyingLap.mode, context: context({ sessionType: "QUALIFYING", lapProgress: 0.52 }), deltaTimeSeconds: 1 }).state;
    expect(outLap.mode).toBe("CONSERVE");
    expect(flyingLap.mode).toBe("ATTACK");
    expect(outLapState.targetSocAtLapEnd).toBe(0.88);
    expect(flyingLapState.targetSocAtLapEnd).toBe(0.1);
    expect(flyingLapState.currentDeployPowerKW).toBeGreaterThan(outLapState.currentDeployPowerKW);
  });

  it("builds bounded multi-lap forecasts and a segment energy plan", () => {
    const state = createEnergySystemState(0.72);
    const forecast = predictEnergySoc(state, "ATTACK");
    const plan = buildTrackEnergyPlan(SILVERSTONE_CIRCUIT.segments, "BALANCED", state);
    expect(forecast).toHaveLength(4);
    expect(forecast.every((soc) => soc >= 0 && soc <= 1)).toBe(true);
    expect(forecast[3]).toBeLessThan(forecast[1]);
    expect(plan).toHaveLength(12);
    expect(plan.some((segment) => segment.action === "DEPLOY")).toBe(true);
    expect(plan.some((segment) => segment.expectedHarvestMJ > 0)).toBe(true);
  });

  it("creates independent energy state for every car in the 22-car field", () => {
    const snapshot = createInitialSnapshot(2026);
    expect(snapshot.cars).toHaveLength(22);
    expect(snapshot.cars.every((car) => car.energySystem !== undefined)).toBe(true);
    expect(new Set(snapshot.cars.map((car) => car.energySystem)).size).toBe(22);
    const originalSecondSoc = snapshot.cars[1].energySystem!.stateOfCharge;
    snapshot.cars[0].energySystem!.stateOfCharge = 0.1;
    expect(snapshot.cars[1].energySystem!.stateOfCharge).toBe(originalSecondSoc);
  });

  it("round-trips energy state and migrates legacy saves", () => {
    const snapshot = createInitialSnapshot(91);
    const restored = deserializeRaceSnapshot(serializeRaceSnapshot(snapshot));
    expect(restored.cars[0].energySystem).toEqual(snapshot.cars[0].energySystem);

    const legacy = { ...snapshot, cars: snapshot.cars.map((car) => ({ ...car, energySystem: undefined, batteryPercent: 37 })) };
    const migrated = deserializeRaceSnapshot(JSON.stringify(legacy));
    expect(migrated.cars.every((car) => Math.round(car.energySystem!.stateOfCharge * 100) === 37)).toBe(true);
  });
});
