"use client";

import type { RaceSnapshot } from "@/domain/race";
import { DRIVER_BY_ID } from "@/fixtures/grid";
import type { EnergyDebugAction } from "@/simulation/protocol";
import { migrateEnergySystemState } from "@/simulation/energy/energy-system";

export function EnergyDebugPanel({ snapshot, onAction }: { snapshot: RaceSnapshot | null; onAction: (carId: string, action: EnergyDebugAction) => void }) {
  const visible = process.env.NODE_ENV !== "production"
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("energyDebug");
  if (!visible || !snapshot) return null;
  return (
    <aside aria-label="Energy development debug panel" className="energy-debug-panel">
      <header><strong>ENERGY DEBUG · DEVELOPMENT ONLY</strong><span>22 CARS · TICK {snapshot.tick}</span></header>
      <div className="energy-debug-table">
        {snapshot.cars.map((car) => {
          const driver = DRIVER_BY_ID.get(car.driverId);
          const energy = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
          return (
            <div key={car.carId}>
              <b>{driver?.shortName ?? car.carId}</b><span>{Math.round(energy.stateOfCharge * 100)}%</span><span>{Math.round(energy.currentDeployPowerKW)}kW</span><span>↙{Math.round(energy.currentHarvestPowerKW)}kW</span><span>{Math.round(energy.batteryTemperatureC)}°</span><span>P{Math.round(energy.predictedSocAtLapEnd * 100)}%</span><span>D{energy.deployedEnergyThisLapMJ.toFixed(2)} / H{energy.harvestedEnergyThisLapMJ.toFixed(2)}MJ</span><span>{energy.deploymentMode}</span><span>{energy.clippingActive ? "CLIP" : energy.modeReason}</span>
              <nav>{(["SOC_FULL", "SOC_LOW", "HEAT", "CLIPPING", "BOOST", "OVERTAKE", "TOGGLE_AI"] as const).map((action) => <button key={action} onClick={() => onAction(car.carId, action)} type="button">{action.replace("SOC_", "")}</button>)}</nav>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
