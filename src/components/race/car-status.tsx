"use client";

import type { CSSProperties } from "react";

import type { RaceCarState } from "@/domain/race";
import { EnergyTelemetry } from "@/components/race/energy-telemetry";
import { formatLapTime } from "@/components/race/format";
import { VehicleThermalMap } from "@/components/race/tyre-temperature-car";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { estimatePitOutPosition } from "@/simulation/engine";
import { penaltyLabel } from "@/simulation/stewarding";
import { useRaceStore } from "@/store/race-store";

function CarCard({ car, selected, predictedPitPosition }: { car: RaceCarState; selected: boolean; predictedPitPosition: number }) {
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  const select = useRaceStore((state) => state.setSelectedCarId);
  const snapshot = useRaceStore((state) => state.snapshot);
  const displayedGap = useRaceStore((state) => state.timingGaps[car.carId]?.ahead ?? car.gapToCarAhead);
  if (!driver || !team) return null;
  const teamColor = `#${team.primaryColor.toString(16).padStart(6, "0")}`;
  const tacticalLabel = car.battleStatus === "ATTACKING" ? "ATK" : car.battleStatus === "DEFENDING" ? "DEF" : car.battleStatus === "SIDE_BY_SIDE" ? "DUEL" : car.racingLineMode === "RACING" ? "RUN" : car.racingLineMode;
  const activePenalty = snapshot?.penalties.find((penalty) => penalty.carId === car.carId && (penalty.status === "PENDING" || penalty.status === "SERVING"));
  const penaltyShort = activePenalty?.type === "TIME_5" ? "+5"
    : activePenalty?.type === "TIME_10" ? "+10"
      : activePenalty?.type === "DRIVE_THROUGH" ? "DT" : activePenalty?.type === "STOP_GO_10" ? "SG" : activePenalty ? "PEN" : null;
  const pitLabel = car.pitStatus !== "TRACK"
    ? car.pitStatus === "PIT_STOP"
      ? car.pitServicePhase === "PENALTY_HOLD" || car.pitServicePhase === "STOP_GO_HOLD"
        ? `PEN ${car.penaltyHoldElapsedSeconds?.toFixed(1) ?? "0.0"}/${car.penaltyHoldSeconds?.toFixed(1) ?? "0.0"}s`
        : `TYRE ${car.pitTyreServiceElapsedSeconds?.toFixed(1) ?? car.pitTimer.toFixed(1)}/${car.pitTyreServiceTargetSeconds?.toFixed(1) ?? car.pitStopTargetSeconds.toFixed(1)}s`
      : `${car.pitStatus.replace("PIT_", "")} ${car.pitLaneTimer.toFixed(1)}s`
    : car.scheduledPitCompound
      ? `BOX ${car.scheduledPitCompound[0]}${penaltyShort ? ` · ${penaltyShort}` : ""}`
      : penaltyShort
        ? `${penaltyShort} PENDING`
      : car.lastPitStopTime !== null
        ? `${car.lastPitStopTime.toFixed(2)}s / ${car.lastPitLaneTime?.toFixed(1) ?? "—"}s`
        : `PRED P${predictedPitPosition}`;
  const pitTitle = car.pitStatus !== "TRACK"
    ? `Current total pit time ${car.pitLaneTimer.toFixed(1)}s · penalty hold ${(car.penaltyHoldElapsedSeconds ?? 0).toFixed(1)} of ${(car.penaltyHoldSeconds ?? 0).toFixed(1)}s · tyre change ${(car.pitTyreServiceElapsedSeconds ?? 0).toFixed(1)} of ${(car.pitTyreServiceTargetSeconds ?? car.pitStopTargetSeconds).toFixed(1)}s`
    : activePenalty
      ? `${penaltyLabel(activePenalty.type)} · ${activePenalty.reason} · ${activePenalty.status}`
    : car.lastPitStopTime !== null
      ? `Last tyre change ${car.lastPitStopTime.toFixed(2)}s · total pit lane ${car.lastPitLaneTime?.toFixed(1) ?? "—"}s · ${car.pitStopIssue.replace("_", " ")}`
      : car.pitStopIssue === "NONE" ? "Pit stop nominal" : car.pitStopIssue.replace("_", " ");

  return (
    <button className={`car-card ${selected ? "is-selected" : ""}`} onClick={() => select(car.carId)} style={{ "--team-color": teamColor } as CSSProperties} type="button">
      <div className="car-card__top">
        <span className="car-position">P{car.racePosition}</span>
        <div className="car-card__identity"><strong>{driver.name}</strong></div>
        <span className={`status-chip status-chip--${car.battleStatus.toLowerCase()}`}>{tacticalLabel}</span>
        <span className="car-number">#{driver.number.toString().padStart(2, "0")}</span>
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
      <EnergyTelemetry car={car} />
      <div className="resource-line">
        <span>S{car.currentSector} <strong>{formatLapTime(car.currentLapTime)}</strong></span>
        <span>BEST <strong>{formatLapTime(car.bestLapTime)}</strong></span>
        <span>ERS <strong className={car.overtakeActive ? "accent" : ""}>{car.overtakeActive ? "OVT" : (car.energySystem?.deploymentMode ?? car.energyMode).slice(0, 3)}</strong></span>
        <span>PIT <strong className={car.pitStatus !== "TRACK" || car.scheduledPitCompound ? "accent" : ""} title={pitTitle}>{pitLabel}</strong></span>
      </div>
    </button>
  );
}

export function CarStatusPanel() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const playerTeamId = snapshot?.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID;
  const playerCarIds = playerCarIdsFor(playerTeamId);
  const playerCars = playerCarIds.map((id) => snapshot?.cars.find((car) => car.carId === id)).filter((car): car is RaceCarState => Boolean(car));

  return (
    <aside className="status-column">
      {playerCars.map((car) => (
        <CarCard key={car.carId} car={car} selected={selectedCarId === car.carId} predictedPitPosition={snapshot ? estimatePitOutPosition(snapshot, car.carId) : car.racePosition} />
      ))}
    </aside>
  );
}
