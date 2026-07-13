"use client";

import type { RaceCarState } from "@/domain/race";
import { formatLapTime } from "@/components/race/format";
import { DRIVER_BY_ID, PLAYER_CAR_IDS, TEAM_BY_ID } from "@/fixtures/grid";
import { estimatePitOutPosition } from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";

function CarCard({ car, title, selected, predictedPitPosition }: { car: RaceCarState; title: string; selected: boolean; predictedPitPosition: number }) {
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  const select = useRaceStore((state) => state.setSelectedCarId);
  const displayedGap = useRaceStore((state) => state.timingGaps[car.carId]?.ahead ?? car.gapToCarAhead);
  if (!driver || !team) return null;
  const conditionPercent = car.incidentStatus === "RETIRED" ? 0 : Math.max(0, 100 - car.damageLevel * 100);
  const conditionLabel = car.incidentStatus === "RUNNING" ? "NOMINAL" : car.incidentStatus;

  return (
    <button className={`car-card ${selected ? "is-selected" : ""}`} onClick={() => select(car.carId)} type="button">
      <div className="car-card__top">
        <span className="eyebrow">{title}</span>
        <span className="car-position">P{car.racePosition}</span>
      </div>
      <div className="car-card__identity">
        <span className="car-number">#{driver.number.toString().padStart(2, "0")}</span>
        <div><strong>{driver.name}</strong><small>{driver.shortName} · {team.shortName}</small></div>
      </div>
      <div className="metric-grid">
        <div><span>SPEED</span><strong>{Math.round(car.currentSpeed)}</strong><small>km/h</small><div className="mini-meter"><i style={{ width: `${Math.min(100, car.currentSpeed / 3.5)}%` }} /></div></div>
        <div><span>INTERVAL</span><strong>{car.racePosition === 1 ? "—" : `+${displayedGap.toFixed(3)}`}</strong><small>ahead</small><div className={`status-chip status-chip--${car.battleStatus.toLowerCase()}`}>{car.battleStatus === "CLEAR" ? car.racingLineMode : car.battleStatus}</div></div>
        <div className="tyre-visual"><div className={`tyre-life-ring tyre-${car.tyreCompound.toLowerCase()}`} style={{ background: `conic-gradient(currentColor ${car.tyreLife * 3.6}deg, #14242b 0deg)` }}><i>{car.tyreCompound[0]}</i></div><div><span>TYRE HEALTH</span><strong className={car.tyreLife < 35 ? "warning" : ""}>{car.tyreLife.toFixed(0)}%</strong><small>{car.tyreAgeLaps.toFixed(1)} laps</small></div></div>
        <div><span>FUEL LOAD</span><strong>{car.fuelRemainingKg.toFixed(1)}</strong><small>kg</small><div className="mini-meter mini-meter--fuel"><i style={{ width: `${Math.min(100, car.fuelRemainingKg / 1.05)}%` }} /></div></div>
      </div>
      <div className="systems-strip">
        <div><span>TYRE TEMP</span><strong>{Math.round(car.tyreTemperature)}°</strong><i><b style={{ width: `${Math.min(100, Math.max(0, (car.tyreTemperature - 60) * 1.8))}%` }} /></i></div>
        <div><span>BRAKES</span><strong>{Math.round(car.brakeTemperature)}°</strong><i><b style={{ width: `${Math.min(100, car.brakeTemperature / 10)}%` }} /></i></div>
        <div className="energy-system"><span>ENERGY · {car.energyState}</span><strong>{Math.round(car.batteryPercent)}%</strong><i><b style={{ width: `${car.batteryPercent}%` }} /></i></div>
        <div className="aero-system"><span>ACTIVE AERO</span><strong>{car.activeAeroMode}</strong><i><b style={{ width: `${car.activeAeroMode === "STRAIGHT" ? 100 : car.activeAeroMode === "PARTIAL" ? 55 : 20}%` }} /></i></div>
      </div>
      <div className="resource-line">
        <span>S{car.currentSector} <strong>{formatLapTime(car.currentLapTime)}</strong></span>
        <span>BEST <strong>{formatLapTime(car.bestLapTime)}</strong></span>
        <span>PACE <strong>{car.paceMode}</strong></span>
        <span>OVT <strong className={car.overtakeActive ? "accent" : ""}>{car.overtakeActive ? "ACTIVE" : car.overtakeEligible ? "READY" : "—"}</strong></span>
        <span>PIT <strong className={car.pitStatus !== "TRACK" || car.scheduledPitCompound ? "accent" : ""}>{car.pitStatus !== "TRACK" ? car.pitStatus : car.scheduledPitCompound ? `BOX ${car.scheduledPitCompound}` : `PRED P${predictedPitPosition}`}</strong></span>
      </div>
      <div className={`condition-strip condition-strip--${car.incidentStatus.toLowerCase()}`}>
        <span>CAR CONDITION</span><strong>{conditionLabel}</strong><div><i style={{ width: `${conditionPercent}%` }} /></div>
      </div>
      <div className="progress-label"><span>LAP PROGRESS</span><span>{Math.round((car.lapDistance / SILVERSTONE_CIRCUIT.lengthMeters) * 100)}%</span></div>
      <div className="progress-track"><i style={{ width: `${(car.lapDistance / SILVERSTONE_CIRCUIT.lengthMeters) * 100}%` }} /></div>
    </button>
  );
}

export function CarStatusPanel() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const playerCars = PLAYER_CAR_IDS.map((id) => snapshot?.cars.find((car) => car.carId === id)).filter((car): car is RaceCarState => Boolean(car));
  const radioMessages = snapshot?.radioMessages.filter((message) => message.carId === null || message.carId === selectedCarId).slice(0, 5) ?? [];

  return (
    <aside className="status-column">
      {playerCars.map((car, index) => (
        <CarCard key={car.carId} car={car} title={`PLAYER CAR ${index + 1}`} selected={selectedCarId === car.carId} predictedPitPosition={snapshot ? estimatePitOutPosition(snapshot, car.carId) : car.racePosition} />
      ))}
      <div className="panel engineer-panel">
        <span className="eyebrow">TEAM RADIO / RACE CONTROL</span>
        <div className="event-list" aria-label="Team radio log">
          {radioMessages.length ? radioMessages.map((message) => (
            <div className={`event-row event-row--${message.priority.toLowerCase()}`} key={message.id}>
              <time>{Math.floor(message.elapsedTime / 60).toString().padStart(2, "0")}:{Math.floor(message.elapsedTime % 60).toString().padStart(2, "0")}</time>
              <p><b>{message.source}</b>{message.message}</p>
            </div>
          )) : <p className="event-empty">Radio check complete. Strategy and race-control calls will appear here.</p>}
        </div>
        <div className={`engineer-meta engineer-meta--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}><i /> {(snapshot?.raceControl ?? "GREEN").replace("_", " ")} · PIT {snapshot?.pitLaneOpen === false ? "CLOSED" : "OPEN"}</div>
      </div>
    </aside>
  );
}
