import type { RaceCarState, RadioMessage } from "@/domain/race";
import { DRIVER_BY_ID } from "@/fixtures/grid";
import { migrateEnergySystemState } from "@/simulation/energy/energy-system";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

function message(car: RaceCarState, tick: number, elapsedTime: number, suffix: string, text: string, priority: RadioMessage["priority"]): RadioMessage {
  const driver = DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId;
  return {
    id: `${tick}-${car.carId}-energy-${suffix}`,
    elapsedTime,
    carId: car.carId,
    source: "ENGINEER",
    message: `${driver}, ${text}`,
    priority,
  };
}

/** Transition-based calls prevent a 10 Hz physics loop from spamming radio. */
export function buildEnergyRadioMessages(
  previousCars: readonly RaceCarState[],
  cars: readonly RaceCarState[],
  playerTeamId: string,
  tick: number,
  elapsedTime: number,
  existingMessages: readonly RadioMessage[] = [],
): readonly RadioMessage[] {
  const calls: RadioMessage[] = [];
  for (const car of cars) {
    if (car.teamId !== playerTeamId || car.finished || car.incidentStatus === "RETIRED") continue;
    const previousCar = previousCars.find((candidate) => candidate.carId === car.carId);
    if (!previousCar) continue;
    const before = migrateEnergySystemState(previousCar.energySystem, previousCar.batteryPercent, previousCar.energyStoreTemperature);
    const after = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
    const recentlyCalled = (fragment: string, cooldownSeconds: number) => existingMessages.some((candidate) => candidate.carId === car.carId
      && candidate.source === "ENGINEER"
      && candidate.message.toLowerCase().includes(fragment)
      && elapsedTime - candidate.elapsedTime < cooldownSeconds);
    if (after.clippingActive && !before.clippingActive && !recentlyCalled("energy clipping", 120)) {
      calls.push(message(car, tick, elapsedTime, "clipping", "energy clipping on the straight. Deployment is limited; recharge required.", "URGENT"));
    } else if (!after.clippingActive && before.clippingActive && after.stateOfCharge >= after.targetSocAtLapEnd - 0.04 && !recentlyCalled("target recovered", 120)) {
      calls.push(message(car, tick, elapsedTime, "target-recovered", "energy target recovered. Full programmed deployment is available again.", "NORMAL"));
    } else if ((after.thermalBand === "HOT" || after.thermalBand === "CRITICAL") && before.thermalBand !== after.thermalBand) {
      calls.push(message(car, tick, elapsedTime, "temperature", `battery ${after.thermalBand.toLowerCase()} at ${Math.round(after.batteryTemperatureC)} degrees. Electrical power will derate.`, after.thermalBand === "CRITICAL" ? "URGENT" : "WARNING"));
    } else if (after.overtakeEligible && !before.overtakeEligible && !recentlyCalled("overtake energy available", 150)) {
      calls.push(message(car, tick, elapsedTime, "overtake-ready", `overtake energy available. ${Math.round(after.stateOfCharge * 100)} percent state of charge.`, "NORMAL"));
    } else if (car.currentLap >= SILVERSTONE_CIRCUIT.totalLaps && previousCar.currentLap < SILVERSTONE_CIRCUIT.totalLaps) {
      calls.push(message(car, tick, elapsedTime, "final-lap", "final lap. Use the remaining electrical energy; no lap-end reserve required.", "WARNING"));
    } else if (after.stateOfCharge < after.targetSocAtLapEnd - 0.12 && tick % 900 === 0 && !recentlyCalled("below target soc", 150)) {
      calls.push(message(car, tick, elapsedTime, "below-target", `we are below target SOC: ${Math.round(after.stateOfCharge * 100)} percent versus ${Math.round(after.targetSocAtLapEnd * 100)}.`, "WARNING"));
    }
  }
  return calls.slice(0, 2);
}
