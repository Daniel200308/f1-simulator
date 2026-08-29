import type { RaceCarState } from "@/domain/race";
import { normalizeLapDistance, wingZoneAtDistance } from "@/simulation/track";

/**
 * Side profile of the car with its movable aerodynamic flaps.
 *
 * Both wings open together inside Silverstone's two zones — the Wellington
 * Straight after Aintree and the Hangar Straight after Chapel — and shut at the
 * braking point for Brooklands and Stowe respectively. The flap angle is driven
 * from the car's own lap distance, so the drawing matches where the car is
 * rather than animating on a timer.
 */
export function AeroWingCar({ car }: { car: RaceCarState }) {
  const lapDistance = normalizeLapDistance(car.lapDistance);
  const zone = car.pitStatus === "TRACK" ? wingZoneAtDistance(lapDistance) : null;
  const open = Boolean(zone);

  return (
    <div
      aria-label={open ? `Wings open on the ${zone!.label}` : "Wings closed"}
      className="aero-wing-car"
      data-wing-state={open ? "OPEN" : "CLOSED"}
      role="img"
      title={open ? `Front and rear flaps open · ${zone!.label}` : "Front and rear flaps closed"}
    >
      <svg aria-hidden="true" viewBox="0 0 260 84" preserveAspectRatio="xMidYMid meet">
        {/* Airflow streaks that only run while the flaps are open, so the graphic
            reads as a car on a straight rather than a static diagram. */}
        <g className="aero-wing-car__flow" aria-hidden="true">
          <path d="M52 26 H96" />
          <path d="M40 34 H84" />
          <path d="M60 18 H104" />
        </g>

        {/* Nose, floor, sidepod and engine cover as one silhouette. */}
        <path
          className="aero-wing-car__body"
          d="M26 62 L58 60 L74 52 L108 50 L124 40 L150 38 L162 30 L182 30 L190 38 L206 40 L220 50 L232 52 L236 62 Z"
        />
        <path className="aero-wing-car__halo" d="M150 38 Q164 24 182 30" />
        {/* Rear-wing pylon joining the wing to the engine cover. */}
        <path className="aero-wing-car__plane" d="M226 34 L232 34 L232 52 L226 52 Z" />

        <circle className="aero-wing-car__wheel" cx="72" cy="62" r="14" />
        <circle className="aero-wing-car__wheel" cx="204" cy="62" r="14" />
        <circle className="aero-wing-car__hub" cx="72" cy="62" r="4.5" />
        <circle className="aero-wing-car__hub" cx="204" cy="62" r="4.5" />

        {/* Front wing: main plane fixed, upper flap lifts at its trailing edge. */}
        <path className="aero-wing-car__plane" d="M8 66 L40 66 L40 70 L6 70 Z" />
        <g className="aero-wing-car__flap aero-wing-car__flap--front">
          <path d="M10 59 L38 59 L38 63 L10 63 Z" />
        </g>

        {/* Rear wing. The endplate and lower main plane are fixed; the upper flap
            lifts upward from its leading edge, the way a real DRS flap opens. */}
        <path className="aero-wing-car__plane" d="M246 18 L250 18 L250 44 L246 44 Z" />
        <path className="aero-wing-car__plane" d="M220 38 L252 38 L252 43 L220 43 Z" />
        <g className="aero-wing-car__flap aero-wing-car__flap--rear">
          <path d="M221 27 L251 27 L251 33 L221 33 Z" />
          {/* Slot gap edge, brightest at full opening. */}
          <path className="aero-wing-car__slot" d="M223 33 H249" />
        </g>
      </svg>

      <span className="aero-wing-car__state">
        <b>{open ? "DRS OPEN" : "DRS CLOSED"}</b>
      </span>
    </div>
  );
}
