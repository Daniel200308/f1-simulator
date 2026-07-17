"use client";

import { useState } from "react";
import { CircleAlert, X } from "lucide-react";

import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import { TyreBadge } from "@/components/race/tyre-badge";
import { useRaceStore } from "@/store/race-store";
import { penaltyLabel } from "@/simulation/stewarding";

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
  const [sportingNoticeCarId, setSportingNoticeCarId] = useState<string | null>(null);
  const noticeCar = cars.find((car) => car.carId === sportingNoticeCarId);
  const noticeDriver = noticeCar ? DRIVER_BY_ID.get(noticeCar.driverId) : undefined;
  const noticePenalty = sportingNoticeCarId ? snapshot?.penalties.find((penalty) => penalty.carId === sportingNoticeCarId && (penalty.status === "PENDING" || penalty.status === "SERVING" || penalty.status === "ESCALATED")) : undefined;
  const noticeInvestigation = sportingNoticeCarId ? snapshot?.investigations.find((investigation) => investigation.carId === sportingNoticeCarId && (investigation.status === "NOTED" || investigation.status === "UNDER_INVESTIGATION" || investigation.status === "DECISION_PENDING")) : undefined;
  const activeSportingNotice = noticePenalty ?? noticeInvestigation;

  return (
    <aside className="panel timing-panel" data-gap-revision={timingGapRevision}>
      <header className="panel__header panel__header--leader"><h2>Leader Board</h2></header>
      <div className="timing-session-summary">
        <span><small>LAP</small><strong>{currentLap}<em>/ 52</em></strong></span>
        <span><small>RACE TIME</small><strong>{sessionTime(snapshot?.elapsedTime ?? 0)}</strong></span>
      </div>
      <div className="timing-head"><span>P</span><span>DRIVER</span><span>TYRE</span><span>LIFE</span><span>GAP</span><span aria-hidden="true" /></div>
      {activeSportingNotice && <section aria-live="polite" className={`sporting-explainer ${noticePenalty ? "is-penalty" : "is-investigation"}`}>
        <header>
          <span>{noticePenalty ? "STEWARDS DECISION" : "INCIDENT REVIEW"}</span>
          <button aria-label="Close penalty reason" onClick={() => setSportingNoticeCarId(null)} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <div><CircleAlert aria-hidden="true" fill="currentColor" size={24} strokeWidth={2.7} /><span><strong>{noticeDriver?.shortName ?? sportingNoticeCarId}</strong><small>{noticePenalty ? penaltyLabel(noticePenalty.type) : noticeInvestigation?.status.replaceAll("_", " ")}</small></span></div>
        <p>{activeSportingNotice.reason}</p>
        <small className="sporting-explainer__evidence">{activeSportingNotice.evidence}</small>
        {noticeInvestigation && <footer>STEWARDS REVIEW IN PROGRESS · DECISION AFTER 60+ SECONDS</footer>}
        {noticePenalty?.status === "SERVING" && <footer>PENALTY SERVICE IN PROGRESS</footer>}
      </section>}
      <div className="timing-list">
        {cars.map((car) => {
          const driver = DRIVER_BY_ID.get(car.driverId);
          const team = TEAM_BY_ID.get(car.teamId);
          if (!driver || !team) return null;
          const isRetired = car.incidentStatus === "RETIRED";
          const pendingPenalty = snapshot?.penalties.find((penalty) => penalty.carId === car.carId && (penalty.status === "PENDING" || penalty.status === "SERVING" || penalty.status === "ESCALATED"));
          const investigation = snapshot?.investigations.find((candidate) => candidate.carId === car.carId && (candidate.status === "NOTED" || candidate.status === "UNDER_INVESTIGATION" || candidate.status === "DECISION_PENDING"));
          const warningTitle = pendingPenalty
            ? `${penaltyLabel(pendingPenalty.type)} · ${pendingPenalty.reason} · ${pendingPenalty.status}`
            : investigation ? `${investigation.status.replaceAll("_", " ")} · ${investigation.reason}` : undefined;
          return (
            <div
              aria-label={`Select ${driver.name}`}
              className={`timing-row ${selectedCarId === car.carId ? "is-selected" : ""} ${car.teamId === snapshot?.playerTeamId ? "is-player" : ""} ${isRetired ? "is-retired" : ""}`}
              key={car.carId}
              onClick={() => select(car.carId)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                select(car.carId);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="timing-position">{car.racePosition.toString().padStart(2, "0")}</span>
              <span className="driver-cell">
                <i style={{ backgroundColor: `#${team.primaryColor.toString(16).padStart(6, "0")}` }} />
                <strong>{driver.shortName}</strong>
                <small>{team.shortName}</small>
              </span>
              <span className="timing-tyre"><TyreBadge compound={car.tyreCompound} size="small" title={`${car.tyreCompound} · ${car.tyreAgeLaps.toFixed(1)} laps`} /></span>
              <span className={`timing-tyre-life ${car.tyreLife < 30 ? "is-critical" : car.tyreLife < 50 ? "is-warning" : ""}`}>{Math.round(car.tyreLife)}%</span>
              <span className={`timing-gap ${isRetired ? "is-out" : ""}`} title={isRetired ? car.retiredReason ?? "Retired" : undefined}>
                {isRetired ? "OUT" : gapLabel(car.racePosition, timingGaps[car.carId]?.ahead ?? car.gapToCarAhead)}
              </span>
              {(pendingPenalty || investigation)
                ? <button
                    aria-label={`${warningTitle}. Show reason`}
                    className={`timing-warning ${pendingPenalty ? "is-penalty" : "is-investigation"}`}
                    onClick={(event) => { event.stopPropagation(); setSportingNoticeCarId(car.carId); }}
                    title={`${warningTitle} · Click for details`}
                    type="button"
                  ><CircleAlert aria-hidden="true" fill="currentColor" size={18} strokeWidth={2.8} /></button>
                : <span aria-hidden="true" className="timing-warning" />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
