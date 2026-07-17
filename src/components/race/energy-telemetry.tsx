import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Gauge, Zap } from "lucide-react";
import type { CSSProperties } from "react";

import type { RaceCarState } from "@/domain/race";
import { boostSecondsRemaining, buildTrackEnergyPlan, predictEnergySoc } from "@/simulation/energy/energy-prediction";
import { migrateEnergySystemState } from "@/simulation/energy/energy-system";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

export function EnergyTelemetry({ car }: { car: RaceCarState }) {
  const energy = migrateEnergySystemState(car.energySystem, car.batteryPercent, car.energyStoreTemperature);
  const soc = Math.round(energy.stateOfCharge * 100);
  const target = Math.round(energy.targetSocAtLapEnd * 100);
  const deploying = energy.currentDeployPowerKW >= energy.currentHarvestPowerKW && energy.currentDeployPowerKW > 1;
  const harvesting = energy.currentHarvestPowerKW > energy.currentDeployPowerKW && energy.currentHarvestPowerKW > 1;
  const flow = energy.clippingActive ? "CLIPPING" : deploying ? "DEPLOY" : harvesting ? "HARVEST" : "IDLE";
  const plan = buildTrackEnergyPlan(SILVERSTONE_CIRCUIT.segments, energy.deploymentMode, energy);
  const [, oneLapSoc, threeLapSoc, fiveLapSoc] = predictEnergySoc(energy, energy.deploymentMode).map((value) => Math.round(value * 100));
  const rechargeThreshold = Math.max(18, target - 8);
  const rechargeAt = ([oneLapSoc, threeLapSoc, fiveLapSoc] as const).findIndex((value) => value <= rechargeThreshold);
  const rechargeInLaps = rechargeAt < 0 ? null : ([1, 3, 5] as const)[rechargeAt];
  const modeDisplay = energy.clippingActive ? "CLIP" : energy.deratingActive ? "DER"
    : ({ HARVEST: "HAR", CONSERVE: "CON", BALANCED: "BAL", ATTACK: "ATK", BOOST: "BST", OVERTAKE: "OVT" } as const)[energy.deploymentMode];
  const rechargeDisplay = energy.rechargeMode === "AUTO" ? "A" : energy.rechargeMode === "HIGH" ? "H" : "L";
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

      <div className="energy-flow">
        <header><span>ENERGY FLOW · R:{rechargeDisplay}</span><strong>{modeDisplay}</strong></header>
        <div className="energy-flow__path">
          <span><small>{harvesting ? "BRAKE" : "BATTERY"}</small><b>{harvesting ? `${Math.round(energy.currentHarvestPowerKW)}kW` : `${soc}%`}</b></span>
          <i aria-hidden="true"><b /></i>
          <span className="energy-flow__mgu"><Zap aria-hidden="true" size={11} /><small>MGU-K</small><b>350kW</b></span>
          <i aria-hidden="true"><b /></i>
          <span><small>ICE + RW</small><b>{deploying ? `${Math.round(energy.currentDeployPowerKW)}kW` : "READY"}</b></span>
        </div>
      </div>

      <div className="energy-vitals">
        <span><Gauge aria-hidden="true" size={11} /><small>1 LAP</small><b className={oneLapSoc < rechargeThreshold ? "is-warning" : ""}>{oneLapSoc}%</b></span>
        <span><Gauge aria-hidden="true" size={11} /><small>3 LAP</small><b className={threeLapSoc < rechargeThreshold ? "is-warning" : ""}>{threeLapSoc}%</b></span>
        <span><Zap aria-hidden="true" size={11} /><small>BOOST</small><b className={energy.deratingActive ? "is-warning" : ""}>{boostSecondsRemaining(energy).toFixed(1)}s</b></span>
      </div>

      <div aria-label="Predicted track energy plan" className="energy-track-plan">
        {plan.map((segment, index) => {
          const trackSegment = SILVERSTONE_CIRCUIT.segments[index];
          const lapTimeDelta = segment.action === "DEPLOY" ? -segment.expectedDeployMJ * 0.13
            : segment.action === "HARVEST" || segment.action === "COAST" ? segment.expectedHarvestMJ * 0.16 + 0.02
              : segment.action === "CLIPPING_RISK" ? 0.18 : 0;
          return <i data-action={segment.action.toLowerCase()} key={segment.id} title={`${segment.label} · ${trackSegment.kind} · ${segment.action} · entry ${Math.round(trackSegment.speedLimitKph)}km/h · deploy ${segment.expectedDeployMJ.toFixed(2)}MJ · harvest ${segment.expectedHarvestMJ.toFixed(2)}MJ · SOC ${segment.expectedSocDelta >= 0 ? "+" : ""}${(segment.expectedSocDelta * 100).toFixed(1)}% · lap ${lapTimeDelta >= 0 ? "+" : ""}${lapTimeDelta.toFixed(2)}s`} />;
        })}
      </div>
    </div>
  );
}
