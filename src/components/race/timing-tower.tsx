"use client";

import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import { TyreBadge } from "@/components/race/tyre-badge";
import { useRaceStore } from "@/store/race-store";

function gapLabel(position: number, gap: number): string {
  if (position === 1) return "LEADER";
  return `+${gap.toFixed(3)}`;
}

function sessionTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hours, minutes, secs].map((value) => value.toString().padStart(2, "0")).join(":");
}

export function TimingTower() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const select = useRaceStore((state) => state.setSelectedCarId);
  const timingGaps = useRaceStore((state) => state.timingGaps);
  const timingGapRevision = useRaceStore((state) => state.timingGapRevision);
  const cars = snapshot ? [...snapshot.cars].sort((a, b) => a.racePosition - b.racePosition) : [];
  const currentLap = cars[0]?.currentLap ?? 1;

  return (
    <aside className="panel timing-panel" data-gap-revision={timingGapRevision}>
      <header className="panel__header panel__header--leader"><h2>Leader Board</h2></header>
      <div className="timing-session-summary">
        <span><small>LAP</small><strong>{currentLap}<em>/ 52</em></strong></span>
        <span><small>RACE TIME</small><strong>{sessionTime(snapshot?.elapsedTime ?? 0)}</strong></span>
      </div>
      <div className="timing-head"><span>P</span><span>DRIVER</span><span>TYRE</span><span>GAP</span><span>STATE</span></div>
      <div className="timing-list">
        {cars.map((car) => {
          const driver = DRIVER_BY_ID.get(car.driverId);
          const team = TEAM_BY_ID.get(car.teamId);
          if (!driver || !team) return null;
          const battleLabel = car.battleStatus === "ATTACKING" ? "ATK" : car.battleStatus === "DEFENDING" ? "DEF" : car.battleStatus === "SIDE_BY_SIDE" ? "DUEL" : null;
          const statusLabel = car.incidentStatus === "RETIRED" ? "OUT" : car.incidentStatus === "SPUN" ? "SPIN" : car.incidentStatus === "DAMAGED" ? "DMG" : snapshot?.raceControl === "VSC" ? `${car.vscDeltaSeconds >= 0 ? "+" : ""}${car.vscDeltaSeconds.toFixed(2)}` : car.pitStatus !== "TRACK" ? "PIT" : battleLabel ?? "RUN";
          return (
            <button
              className={`timing-row ${selectedCarId === car.carId ? "is-selected" : ""} ${car.teamId === snapshot?.playerTeamId ? "is-player" : ""}`}
              key={car.carId}
              onClick={() => select(car.carId)}
              type="button"
            >
              <span className="timing-position">{car.racePosition.toString().padStart(2, "0")}</span>
              <span className="driver-cell">
                <i style={{ backgroundColor: `#${team.primaryColor.toString(16).padStart(6, "0")}` }} />
                <strong>{driver.shortName}</strong>
                <small>{team.shortName}</small>
              </span>
              <span className="timing-tyre"><TyreBadge compound={car.tyreCompound} size="small" title={`${car.tyreCompound} · ${car.tyreAgeLaps.toFixed(1)} laps`} /></span>
              <span className="timing-gap">{gapLabel(car.racePosition, timingGaps[car.carId]?.ahead ?? car.gapToCarAhead)}</span>
              <span className={`timing-state battle-${car.battleStatus.toLowerCase()} incident-${car.incidentStatus.toLowerCase()}`}>{statusLabel}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
