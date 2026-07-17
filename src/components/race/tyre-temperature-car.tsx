import Image from "next/image";
import { BatteryCharging, CircleGauge, Cog, Disc3, Thermometer } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { TyreCompound, TyreTemperatureState } from "@/domain/race";
import { THERMAL_THRESHOLDS, TYRE_TEMPERATURE_WINDOWS, tyreThermalSeverity } from "@/simulation/thermal-management";

interface ThermalBand {
  label: "COLD" | "WARMING" | "OPTIMAL" | "HOT" | "CRITICAL";
  color: string;
}

function tyreThermalBand(temperature: number, compound: TyreCompound): ThermalBand {
  const [minimum, maximum] = TYRE_TEMPERATURE_WINDOWS[compound];
  if (temperature < minimum - 8) return { label: "COLD", color: "#398cff" };
  if (temperature < minimum) return { label: "WARMING", color: "#20d7e7" };
  if (temperature <= maximum) return { label: "OPTIMAL", color: "#4bde95" };
  if (tyreThermalSeverity(temperature, compound) !== "CRITICAL") return { label: "HOT", color: "#ff5269" };
  return { label: "CRITICAL", color: "#ff5269" };
}

function systemThermalBand(temperature: number, thresholds: readonly [number, number, number]): ThermalBand {
  const [coldBelow, hotAbove, criticalAbove] = thresholds;
  if (temperature < coldBelow) return { label: "COLD", color: "#398cff" };
  if (temperature <= hotAbove) return { label: "OPTIMAL", color: "#4bde95" };
  if (temperature <= criticalAbove) return { label: "HOT", color: "#f4d35e" };
  return { label: "CRITICAL", color: "#ff5269" };
}

function ThermalWheel({
  className,
  label,
  temperature,
  compound,
}: {
  className: string;
  label: "FL" | "FR" | "RL" | "RR";
  temperature: number;
  compound: TyreCompound;
}) {
  const band = tyreThermalBand(temperature, compound);
  return (
    <span
      className={`thermal-wheel ${className}`}
      data-state={band.label.toLowerCase()}
      style={{ "--thermal-color": band.color } as CSSProperties}
      title={`${label} tyre ${temperature.toFixed(1)}°C · ${band.label.toLowerCase()}`}
    >
      <small>{label}</small>
      <strong>{Math.round(temperature)}°</strong>
      <i aria-hidden="true" />
    </span>
  );
}

function SystemTemperature({
  icon,
  label,
  temperature,
  thresholds,
}: {
  icon: ReactNode;
  label: string;
  temperature: number;
  thresholds: readonly [number, number, number];
}) {
  const band = systemThermalBand(temperature, thresholds);
  return (
    <span
      className="system-temperature"
      data-state={band.label.toLowerCase()}
      style={{ "--thermal-color": band.color } as CSSProperties}
      title={`${label} ${temperature.toFixed(1)}°C · ${band.label.toLowerCase()}`}
    >
      <i aria-hidden="true">{icon}</i>
      <small>{label}</small>
      <strong>{Math.round(temperature)}°</strong>
      <b aria-hidden="true" />
    </span>
  );
}

interface VehicleThermalMapProps {
  temperatures: TyreTemperatureState;
  compound: TyreCompound;
  brakeTemperatures: TyreTemperatureState;
  brakeTemperature: number;
  powerUnitTemperature: number;
  gearboxTemperature: number;
  energyStoreTemperature: number;
  thermalDeratePercent: number;
  thermalRiskPercent: number;
}

export function VehicleThermalMap({
  temperatures,
  compound,
  brakeTemperatures,
  brakeTemperature,
  powerUnitTemperature,
  gearboxTemperature,
  energyStoreTemperature,
  thermalDeratePercent,
  thermalRiskPercent,
}: VehicleThermalMapProps) {
  const [minimum, maximum] = TYRE_TEMPERATURE_WINDOWS[compound];
  const wheelTemperatures = Object.values(temperatures);
  const hottestTyre = Math.max(...wheelTemperatures);
  const hottestBand = tyreThermalBand(hottestTyre, compound);
  const description = [
    `front left tyre ${temperatures.frontLeft.toFixed(1)} degrees`,
    `front right tyre ${temperatures.frontRight.toFixed(1)} degrees`,
    `rear left tyre ${temperatures.rearLeft.toFixed(1)} degrees`,
    `rear right tyre ${temperatures.rearRight.toFixed(1)} degrees`,
    `brakes ${brakeTemperature.toFixed(1)} degrees`,
    `power unit ${powerUnitTemperature.toFixed(1)} degrees`,
    `gearbox ${gearboxTemperature.toFixed(1)} degrees`,
    `energy store ${energyStoreTemperature.toFixed(1)} degrees`,
  ].join(", ");

  return (
    <section aria-label={`Live vehicle temperatures. ${description}`} className="vehicle-thermal" role="img">
      <header className="vehicle-thermal__header">
        <span><Thermometer size={12} aria-hidden="true" /> LIVE THERMAL MAP</span>
        <b style={{ color: hottestBand.color }}>{hottestBand.label}</b>
        <small>{thermalDeratePercent > 0.05 ? `DERATE ${thermalDeratePercent.toFixed(1)}%` : `${minimum}–${maximum}° WINDOW`} · RISK {thermalRiskPercent.toFixed(0)}%</small>
      </header>

      <div className="vehicle-thermal__stage">
        <ThermalWheel className="thermal-wheel--fl" compound={compound} label="FL" temperature={temperatures.frontLeft} />
        <ThermalWheel className="thermal-wheel--fr" compound={compound} label="FR" temperature={temperatures.frontRight} />
        <ThermalWheel className="thermal-wheel--rl" compound={compound} label="RL" temperature={temperatures.rearLeft} />
        <ThermalWheel className="thermal-wheel--rr" compound={compound} label="RR" temperature={temperatures.rearRight} />
        {(["frontLeft", "frontRight", "rearLeft", "rearRight"] as const).map((corner) => {
          const brakeBand = systemThermalBand(brakeTemperatures[corner], [THERMAL_THRESHOLDS.brakes.cold, THERMAL_THRESHOLDS.brakes.warning, THERMAL_THRESHOLDS.brakes.critical]);
          return (
            <span className={`brake-heat brake-heat--${corner}`} data-state={brakeBand.label.toLowerCase()} key={corner} style={{ "--thermal-color": brakeBand.color } as CSSProperties} title={`${corner} brake ${brakeTemperatures[corner].toFixed(1)}°C`}>
              <Disc3 size={8} aria-hidden="true" /><b>{Math.round(brakeTemperatures[corner])}</b>
            </span>
          );
        })}
        <Image
          alt=""
          aria-hidden="true"
          className="vehicle-thermal__car"
          height={118}
          priority
          src="/assets/telemetry/formula-car-top.png"
          unoptimized
          width={71}
        />
        <span className="vehicle-thermal__core" aria-hidden="true"><CircleGauge size={11} /></span>
      </div>

      <div className="vehicle-thermal__systems">
        <SystemTemperature icon={<Disc3 size={12} />} label="BRAKE" thresholds={[350, 900, 1050]} temperature={brakeTemperature} />
        <SystemTemperature icon={<CircleGauge size={12} />} label="PU" thresholds={[82, 118, 125]} temperature={powerUnitTemperature} />
        <SystemTemperature icon={<Cog size={12} />} label="GBX" thresholds={[65, 110, 120]} temperature={gearboxTemperature} />
        <SystemTemperature icon={<BatteryCharging size={12} />} label="E-STORE" thresholds={[18, 55, 63]} temperature={energyStoreTemperature} />
      </div>
    </section>
  );
}
