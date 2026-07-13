import type { TyreCompound, TyreTemperatureState } from "@/domain/race";

interface ThermalBand {
  label: "COLD" | "WARMING" | "OPTIMAL" | "HOT" | "OVERHEAT";
  color: string;
}

const IDEAL_TEMPERATURES: Record<TyreCompound, readonly [number, number]> = {
  SOFT: [92, 108],
  MEDIUM: [90, 105],
  HARD: [87, 102],
  INTERMEDIATE: [70, 90],
  WET: [60, 80],
};

function thermalBand(temperature: number, compound: TyreCompound): ThermalBand {
  const [minimum, maximum] = IDEAL_TEMPERATURES[compound];
  if (temperature < minimum - 8) return { label: "COLD", color: "#398cff" };
  if (temperature < minimum) return { label: "WARMING", color: "#20d7e7" };
  if (temperature <= maximum) return { label: "OPTIMAL", color: "#4bde95" };
  if (temperature <= maximum + 10) return { label: "HOT", color: "#f4d35e" };
  return { label: "OVERHEAT", color: "#ff5269" };
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
  const band = thermalBand(temperature, compound);
  return (
    <span
      className={`thermal-wheel ${className}`}
      data-temperature={temperature.toFixed(1)}
      data-wheel={label}
      style={{ color: band.color }}
      title={`${label} ${temperature.toFixed(1)}°C · ${band.label.toLowerCase()}`}
    >
      <small>{label}</small>
      <strong>{Math.round(temperature)}°</strong>
      <i />
    </span>
  );
}

function FormulaCarSilhouette() {
  return (
    <svg aria-hidden="true" className="tyre-thermal__car" viewBox="0 0 48 82">
      <path className="tyre-thermal__wing" d="M4 5h40v5H29l-2 5h-6l-2-5H4z" />
      <path className="tyre-thermal__body" d="M24 5c3 0 4 6 4 13l5 10-2 14 5 17-4 12H16l-4-12 5-17-2-14 5-10c0-7 1-13 4-13z" />
      <path className="tyre-thermal__floor" d="m15 31 5 5h8l5-5 4 30-8-3H19l-8 3z" />
      <path className="tyre-thermal__cockpit" d="M24 23c4 0 6 5 5 12l-5 5-5-5c-1-7 1-12 5-12z" />
      <path className="tyre-thermal__halo" d="M18 30c0-10 12-10 12 0M24 24v13" />
      <rect className="tyre-thermal__tyre" x="3" y="18" width="8" height="18" rx="2" />
      <rect className="tyre-thermal__tyre" x="37" y="18" width="8" height="18" rx="2" />
      <rect className="tyre-thermal__tyre" x="2" y="54" width="9" height="20" rx="2" />
      <rect className="tyre-thermal__tyre" x="37" y="54" width="9" height="20" rx="2" />
      <path className="tyre-thermal__wing" d="M6 70h36v7H6z" />
      <path className="tyre-thermal__spine" d="M24 13v53" />
    </svg>
  );
}

export function TyreTemperatureCar({ temperatures, compound }: { temperatures: TyreTemperatureState; compound: TyreCompound }) {
  const [minimum, maximum] = IDEAL_TEMPERATURES[compound];
  const description = [
    `Front left ${temperatures.frontLeft.toFixed(1)} degrees`,
    `front right ${temperatures.frontRight.toFixed(1)} degrees`,
    `rear left ${temperatures.rearLeft.toFixed(1)} degrees`,
    `rear right ${temperatures.rearRight.toFixed(1)} degrees`,
  ].join(", ");

  return (
    <div aria-label={`Live four-wheel tyre temperatures. ${description}`} className="tyre-thermal" role="img">
      <div className="tyre-thermal__header">
        <span>4-WHEEL TEMPS</span>
        <b>{minimum}–{maximum}° OPT</b>
      </div>
      <div className="tyre-thermal__diagram">
        <ThermalWheel className="thermal-wheel--fl" compound={compound} label="FL" temperature={temperatures.frontLeft} />
        <ThermalWheel className="thermal-wheel--fr" compound={compound} label="FR" temperature={temperatures.frontRight} />
        <ThermalWheel className="thermal-wheel--rl" compound={compound} label="RL" temperature={temperatures.rearLeft} />
        <ThermalWheel className="thermal-wheel--rr" compound={compound} label="RR" temperature={temperatures.rearRight} />
        <FormulaCarSilhouette />
      </div>
    </div>
  );
}
