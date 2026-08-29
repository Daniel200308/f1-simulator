import type { RaceCarState, RaceSnapshot } from "@/domain/race";
import { migrateEnergySystemState } from "@/simulation/energy/energy-system";

export interface RaceSaveEnvelope {
  version: 2;
  savedAt: string;
  snapshot: RaceSnapshot;
}

function migrateCar(car: RaceCarState): RaceCarState {
  const energySystem = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
  return {
    ...car,
    energyMode: energySystem.deploymentMode,
    energyState: energySystem.clippingActive ? "CLIPPING"
      : energySystem.overtakeActive ? "OVERTAKE"
        : energySystem.boostActive ? "DEFENDING"
          : energySystem.currentDeployPowerKW > 1 ? "DEPLOYING"
            : energySystem.currentHarvestPowerKW > 1 ? "HARVESTING" : "NEUTRAL",
    energySystem,
    batteryPercent: energySystem.stateOfCharge * 100,
    energyStoreTemperature: energySystem.batteryTemperatureC,
  };
}

export function serializeRaceSnapshot(snapshot: RaceSnapshot): string {
  const envelope: RaceSaveEnvelope = { version: 2, savedAt: new Date().toISOString(), snapshot: { ...snapshot, cars: snapshot.cars.map(migrateCar) } };
  return JSON.stringify(envelope);
}

export function deserializeRaceSnapshot(serialized: string): RaceSnapshot {
  const parsed = JSON.parse(serialized) as Partial<RaceSaveEnvelope> | RaceSnapshot;
  const snapshot = "snapshot" in parsed && parsed.snapshot ? parsed.snapshot : parsed as RaceSnapshot;
  if (!Array.isArray(snapshot.cars)) throw new TypeError("Invalid race save: cars are missing.");
  return { ...snapshot, cars: snapshot.cars.map(migrateCar) };
}
