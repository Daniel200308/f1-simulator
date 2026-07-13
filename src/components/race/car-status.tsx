"use client";

import type { CSSProperties } from "react";

import type { RaceCarState } from "@/domain/race";
import type { CommandDockControls } from "@/components/race/command-dock";
import { formatLapTime } from "@/components/race/format";
import { VehicleThermalMap } from "@/components/race/tyre-temperature-car";
import { DRIVER_BY_ID, PLAYER_CAR_IDS, TEAM_BY_ID } from "@/fixtures/grid";
import { estimatePitOutPosition } from "@/simulation/engine";
import { assessVehicleThermals, type ThermalAlert } from "@/simulation/thermal-management";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";

function CarCard({ car, title, selected, predictedPitPosition }: { car: RaceCarState; title: string; selected: boolean; predictedPitPosition: number }) {
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  const select = useRaceStore((state) => state.setSelectedCarId);
  const displayedGap = useRaceStore((state) => state.timingGaps[car.carId]?.ahead ?? car.gapToCarAhead);
  if (!driver || !team) return null;
  const conditionPercent = car.incidentStatus === "RETIRED" ? 0 : Math.max(0, 100 - car.damageLevel * 100);
  const lapProgressPercent = (car.lapDistance / SILVERSTONE_CIRCUIT.lengthMeters) * 100;
  const conditionLabel = car.incidentStatus === "RUNNING" ? "NOMINAL" : car.incidentStatus;
  const teamColor = `#${team.primaryColor.toString(16).padStart(6, "0")}`;
  const tacticalLabel = car.battleStatus === "ATTACKING" ? "ATK" : car.battleStatus === "DEFENDING" ? "DEF" : car.battleStatus === "SIDE_BY_SIDE" ? "DUEL" : car.racingLineMode === "RACING" ? "RUN" : car.racingLineMode;
  const pitLabel = car.pitStatus !== "TRACK"
    ? car.pitStatus === "PIT_STOP" ? `${car.pitTimer.toFixed(1)} / ${car.pitStopTargetSeconds.toFixed(1)}s` : car.pitStatus
    : car.scheduledPitCompound
      ? `BOX ${car.scheduledPitCompound}`
      : car.lastPitStopTime !== null ? `LAST ${car.lastPitStopTime.toFixed(1)}s` : `PRED P${predictedPitPosition}`;

  return (
    <button className={`car-card ${selected ? "is-selected" : ""}`} onClick={() => select(car.carId)} style={{ "--team-color": teamColor } as CSSProperties} type="button">
      <div className="car-card__top">
        <span className="car-number">#{driver.number.toString().padStart(2, "0")}</span>
        <div className="car-card__identity"><span>{title}</span><strong>{driver.name}</strong><small>{driver.shortName} · {team.shortName}</small></div>
        <span className={`status-chip status-chip--${car.battleStatus.toLowerCase()}`}>{tacticalLabel}</span>
        <span className="car-position">P{car.racePosition}</span>
      </div>
      <div className="car-kpi-rail">
        <div><span>SPEED</span><strong>{Math.round(car.currentSpeed)}</strong><small>km/h</small></div>
        <div><span>GAP</span><strong>{car.racePosition === 1 ? "—" : `+${displayedGap.toFixed(3)}`}</strong><small>ahead</small></div>
        <div className="tyre-visual"><div className={`tyre-life-ring tyre-${car.tyreCompound.toLowerCase()}`} style={{ background: `conic-gradient(currentColor ${car.tyreLife * 3.6}deg, #14242b 0deg)` }}><i>{car.tyreCompound[0]}</i></div><div><span>TYRE</span><strong className={car.tyreLife < 35 ? "warning" : ""}>{car.tyreLife.toFixed(0)}%</strong></div></div>
        <div><span>FUEL</span><strong>{car.fuelRemainingKg.toFixed(1)}</strong><small>kg</small></div>
      </div>
      <div className="vehicle-telemetry">
        <VehicleThermalMap
          brakeTemperature={car.brakeTemperature}
          brakeTemperatures={car.brakeTemperatures}
          compound={car.tyreCompound}
          energyStoreTemperature={car.energyStoreTemperature}
          gearboxTemperature={car.gearboxTemperature}
          powerUnitTemperature={car.powerUnitTemperature}
          thermalDeratePercent={car.thermalDeratePercent}
          thermalRiskPercent={car.thermalRiskPercent}
          temperatures={car.tyreTemperatures}
        />
      </div>
      <div className="resource-line">
        <span>S{car.currentSector} <strong>{formatLapTime(car.currentLapTime)}</strong></span>
        <span>BEST <strong>{formatLapTime(car.bestLapTime)}</strong></span>
        <span>ERS <strong className={car.overtakeActive ? "accent" : ""}>{car.batteryPercent.toFixed(0)}%</strong></span>
        <span>PIT <strong className={car.pitStatus !== "TRACK" || car.scheduledPitCompound ? "accent" : ""} title={car.pitStopIssue === "NONE" ? "Pit stop nominal" : car.pitStopIssue.replace("_", " ")}>{pitLabel}</strong></span>
      </div>
      <div className="car-card__health-grid">
        <div className={`car-health car-health--${car.incidentStatus.toLowerCase()}`}><span>CAR <strong>{conditionLabel}</strong></span><i><b style={{ width: `${conditionPercent}%` }} /></i></div>
        <div className="car-health car-health--lap"><span>LAP <strong>{Math.round(lapProgressPercent)}%</strong></span><i><b style={{ width: `${lapProgressPercent}%` }} /></i></div>
      </div>
    </button>
  );
}

type CarStatusControls = Pick<CommandDockControls, "setTyreMode" | "setEnergyMode" | "setCoolingMode" | "box">;

export function CarStatusPanel({ controls }: { controls: CarStatusControls }) {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const playerCars = PLAYER_CAR_IDS.map((id) => snapshot?.cars.find((car) => car.carId === id)).filter((car): car is RaceCarState => Boolean(car));
  const selectedCar = playerCars.find((car) => car.carId === selectedCarId);
  const thermalAlert = selectedCar
    ? [...assessVehicleThermals(selectedCar).alerts].sort((a, b) => (a.severity === "CRITICAL" ? -1 : 1) - (b.severity === "CRITICAL" ? -1 : 1))[0]
    : undefined;
  const radioMessages = snapshot?.radioMessages.filter((message) => message.carId === null || message.carId === selectedCarId).slice(0, thermalAlert ? 1 : 2) ?? [];

  function applyThermalAction(alert: ThermalAlert) {
    if (!selectedCar || !snapshot) return;
    if (alert.action === "TYRE_COOL") controls.setTyreMode(selectedCar.carId, "TEMPERATURE");
    else if (alert.action === "BRAKE_COOL") controls.setCoolingMode(selectedCar.carId, "LIFT_AND_COAST");
    else if (alert.action === "LIFT_AND_COAST") controls.setCoolingMode(selectedCar.carId, alert.severity === "CRITICAL" ? "MAX_COOLING" : "LIFT_AND_COAST");
    else if (alert.action === "RECHARGE") controls.setEnergyMode(selectedCar.carId, "RECHARGE");
    else {
      const preferred = snapshot.weather.trackWetness > 0.68 ? "WET" : snapshot.weather.trackWetness > 0.22 ? "INTERMEDIATE" : selectedCar.tyreCompound === "MEDIUM" ? "HARD" : "MEDIUM";
      const available = selectedCar.tyreSets.find((set) => set.compound === preferred && set.status === "AVAILABLE")
        ?? selectedCar.tyreSets.find((set) => set.status === "AVAILABLE");
      if (available) controls.box(selectedCar.carId, available.compound);
    }
  }

  return (
    <aside className="status-column">
      {playerCars.map((car, index) => (
        <CarCard key={car.carId} car={car} title={`PLAYER CAR ${index + 1}`} selected={selectedCarId === car.carId} predictedPitPosition={snapshot ? estimatePitOutPosition(snapshot, car.carId) : car.racePosition} />
      ))}
      <div className="panel engineer-panel">
        <span className="eyebrow">TEAM RADIO / RACE CONTROL</span>
        {thermalAlert && (
          <div className={`thermal-alert thermal-alert--${thermalAlert.severity.toLowerCase()}`} role="status">
            <span><b>{thermalAlert.title}</b><small>{thermalAlert.message}</small></span>
            <button onClick={() => applyThermalAction(thermalAlert)} type="button">{thermalAlert.actionLabel}</button>
          </div>
        )}
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
