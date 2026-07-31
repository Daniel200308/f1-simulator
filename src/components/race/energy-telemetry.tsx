import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium } from "lucide-react";
import type { CSSProperties } from "react";

import type { RaceCarState } from "@/domain/race";
import { AeroWingCar } from "@/components/race/aero-wing-car";
import { predictEnergySoc } from "@/simulation/energy/energy-prediction";
import { migrateEnergySystemState } from "@/simulation/energy/energy-system";

export function EnergyTelemetry({ car }: { car: RaceCarState }) {
  const energy = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
  const soc = Math.round(energy.stateOfCharge * 100);
  const target = Math.round(energy.targetSocAtLapEnd * 100);
  const deploying = energy.currentDeployPowerKW >= energy.currentHarvestPowerKW && energy.currentDeployPowerKW > 1;
  const harvesting = energy.currentHarvestPowerKW > energy.currentDeployPowerKW && energy.currentHarvestPowerKW > 1;
  const flow = energy.clippingActive ? "CLIPPING" : deploying ? "DEPLOY" : harvesting ? "HARVEST" : "IDLE";
  const [, oneLapSoc, threeLapSoc, fiveLapSoc] = predictEnergySoc(energy, energy.deploymentMode).map((value) => Math.round(value * 100));
  const rechargeThreshold = Math.max(18, target - 8);
  const rechargeAt = ([oneLapSoc, threeLapSoc, fiveLapSoc] as const).findIndex((value) => value <= rechargeThreshold);
  const rechargeInLaps = rechargeAt < 0 ? null : ([1, 3, 5] as const)[rechargeAt];
  const statusColor = energy.clippingActive || energy.thermalBand === "CRITICAL" ? "var(--red)"
    : harvesting ? "#398cff"
      : deploying ? "var(--red)"
        : soc < 24 || energy.thermalBand === "HOT" ? "var(--yellow)" : "var(--green)";
  const flowLabel = harvesting ? "CHARGING" : deploying ? "DEPLOYING" : energy.clippingActive ? "CLIPPING" : "STANDBY";
  const BatteryIcon = harvesting ? BatteryCharging : soc >= 66 ? BatteryFull : soc >= 30 ? BatteryMedium : BatteryLow;

  return (
    <div
      aria-label={`Electrical energy. ${soc} percent state of charge, ${energy.storedEnergyMJ.toFixed(2)} megajoules, ${Math.round(energy.currentDeployPowerKW)} kilowatts deployed, ${Math.round(energy.currentHarvestPowerKW)} kilowatts recovered, ${energy.batteryTemperatureC.toFixed(1)} degrees, ${flow.toLowerCase()}. Forecast ${oneLapSoc} percent in one lap, ${threeLapSoc} percent in three laps, ${fiveLapSoc} percent in five laps. ${rechargeInLaps === null ? "No recharge predicted in five laps." : `Recharge predicted in ${rechargeInLaps} laps.`}`}
      className="energy-telemetry"
      data-alert={energy.clippingActive || energy.deratingActive}
      data-flow={flow.toLowerCase()}
      role="img"
      style={{ "--energy-status": statusColor } as CSSProperties}
      title={energy.modeReason}
    >
      <div className="energy-battery-readout">
        <BatteryIcon aria-hidden="true" className="energy-battery-icon" size={48} strokeWidth={1.65} />
        <div
          aria-label={`Battery ${soc} percent`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={soc}
          className="energy-battery-shell"
          role="progressbar"
        >
          <span>BATTERY</span>
          <strong>{soc}<small>%</small></strong>
          <i aria-hidden="true"><b style={{ width: `${soc}%` }} /></i>
        </div>
        <span className="energy-battery-state">{flowLabel}</span>
      </div>

      <AeroWingCar car={car} />
    </div>
  );
}
