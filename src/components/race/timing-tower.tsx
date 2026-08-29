"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDown, ArrowUp, CircleAlert, X } from "lucide-react";

import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import { TyreBadge } from "@/components/race/tyre-badge";
import { useRaceStore } from "@/store/race-store";
import { penaltyLabel } from "@/simulation/stewarding";
import { circuitById } from "@/simulation/track";

function gapLabel(position: number, gap: number): string {
  if (position === 1) return "LEADER";
  return `+${gap.toFixed(3)}`;
}

export function TimingTower() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const select = useRaceStore((state) => state.setSelectedCarId);
  const timingGaps = useRaceStore((state) => state.timingGaps);
  const timingGapRevision = useRaceStore((state) => state.timingGapRevision);
  const cars = useMemo(() => snapshot ? [...snapshot.cars].sort((a, b) => a.racePosition - b.racePosition) : [], [snapshot]);
  const currentLap = cars[0]?.currentLap ?? 1;
  const totalLaps = circuitById(snapshot?.circuitId).totalLaps;
  const [sportingNoticeCarId, setSportingNoticeCarId] = useState<string | null>(null);
  const [positionChanges, setPositionChanges] = useState<Record<string, "UP" | "DOWN">>({});
  const previousRaceSeedRef = useRef<number | null>(null);
  const previousPositionsRef = useRef(new Map<string, number>());
  const positionChangeApplyTimeoutRef = useRef<number | null>(null);
  const positionChangeTimeoutRef = useRef<number | null>(null);
  const positionSignature = cars.map((car) => `${car.carId}:${car.racePosition}`).join("|");
  const raceSeed = snapshot?.seed ?? null;
  const noticeCar = cars.find((car) => car.carId === sportingNoticeCarId);
  const noticeDriver = noticeCar ? DRIVER_BY_ID.get(noticeCar.driverId) : undefined;
  const noticePenalty = sportingNoticeCarId ? snapshot?.penalties.find((penalty) => penalty.carId === sportingNoticeCarId && penalty.status !== "EXPIRED") : undefined;
  const noticeInvestigation = sportingNoticeCarId ? snapshot?.investigations.find((investigation) => investigation.carId === sportingNoticeCarId && (investigation.status === "NOTED" || investigation.status === "UNDER_INVESTIGATION" || investigation.status === "DECISION_PENDING")) : undefined;
  const activeSportingNotice = noticePenalty ?? noticeInvestigation;

  useEffect(() => {
    const previousPositions = previousPositionsRef.current;
    const nextPositions = new Map(cars.map((car) => [car.carId, car.racePosition]));
    const nextChanges: Record<string, "UP" | "DOWN"> = {};

    for (const car of cars) {
      const previousPosition = previousPositions.get(car.carId);
      if (previousPosition === undefined || previousPosition === car.racePosition) continue;
      nextChanges[car.carId] = car.racePosition < previousPosition ? "UP" : "DOWN";
    }

    if (raceSeed !== previousRaceSeedRef.current) {
      previousRaceSeedRef.current = raceSeed;
      previousPositionsRef.current = nextPositions;
      if (positionChangeApplyTimeoutRef.current !== null) window.clearTimeout(positionChangeApplyTimeoutRef.current);
      if (positionChangeTimeoutRef.current !== null) window.clearTimeout(positionChangeTimeoutRef.current);
      window.setTimeout(() => setPositionChanges({}), 0);
      return;
    }

    previousPositionsRef.current = nextPositions;
    if (Object.keys(nextChanges).length === 0) return;

    if (positionChangeApplyTimeoutRef.current !== null) window.clearTimeout(positionChangeApplyTimeoutRef.current);
    positionChangeApplyTimeoutRef.current = window.setTimeout(() => {
      setPositionChanges(nextChanges);
      if (positionChangeTimeoutRef.current !== null) window.clearTimeout(positionChangeTimeoutRef.current);
      positionChangeTimeoutRef.current = window.setTimeout(() => {
        setPositionChanges({});
        positionChangeTimeoutRef.current = null;
      }, 1800);
      positionChangeApplyTimeoutRef.current = null;
    }, 0);
  }, [cars, positionSignature, raceSeed]);

  useEffect(() => () => {
    if (positionChangeApplyTimeoutRef.current !== null) window.clearTimeout(positionChangeApplyTimeoutRef.current);
    if (positionChangeTimeoutRef.current !== null) window.clearTimeout(positionChangeTimeoutRef.current);
  }, []);

  return (
    <aside className="panel timing-panel" data-gap-revision={timingGapRevision}>
      {/*
        * Title and lap count on one line. Stacking a large numeral above a "/ 52"
        * and a clock made the block tall and top-heavy for the little it said.
        */}
      <header className="timing-masthead">
        <span className="timing-masthead__label">LEADER BOARD</span>
        <span className="timing-masthead__lap">
          <small>LAP</small>
          <strong>{currentLap}</strong>
          <em>/ {totalLaps}</em>
        </span>
        <i aria-hidden="true" style={{ "--race-progress": `${Math.min(100, (currentLap / totalLaps) * 100)}%` } as CSSProperties} />
      </header>
      <div className="timing-head"><span title="Position">P</span><span title="Driver">DRIVER</span><span title="Tyre compound">TYRE</span><span title="Tyre life">LIFE</span><span title="Gap to the car ahead">GAP</span><span aria-hidden="true" /></div>
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
          const pendingPenalty = snapshot?.penalties.find((penalty) => penalty.carId === car.carId && penalty.status !== "EXPIRED");
          const investigation = snapshot?.investigations.find((candidate) => candidate.carId === car.carId && (candidate.status === "NOTED" || candidate.status === "UNDER_INVESTIGATION" || candidate.status === "DECISION_PENDING"));
          const positionChange = positionChanges[car.carId];
          const positionChangeLabel = positionChange === "UP" ? "Gained position" : positionChange === "DOWN" ? "Lost position" : undefined;
          const warningTitle = pendingPenalty
            ? `${penaltyLabel(pendingPenalty.type)} · ${pendingPenalty.reason} · ${pendingPenalty.status}`
            : investigation ? `${investigation.status.replaceAll("_", " ")} · ${investigation.reason}` : undefined;
          return (
            <div
              aria-label={`Select ${driver.name}${positionChangeLabel ? ` · ${positionChangeLabel}` : ""}`}
              className={`timing-row ${selectedCarId === car.carId ? "is-selected" : ""} ${car.teamId === snapshot?.playerTeamId ? "is-player" : ""} ${isRetired ? "is-retired" : ""} ${positionChange ? `has-position-change is-position-${positionChange.toLowerCase()}` : ""} ${pendingPenalty ? "has-penalty" : investigation ? "has-investigation" : ""}`}
              data-position-change={positionChange?.toLowerCase()}
              data-sporting-status={pendingPenalty ? "penalty" : investigation ? "investigation" : undefined}
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
              <span className="timing-position-cell">
                {positionChange === "UP" && <ArrowUp aria-label="Position gained" className="timing-position-change timing-position-change--up" size={15} strokeWidth={3.2} />}
                {positionChange === "DOWN" && <ArrowDown aria-label="Position lost" className="timing-position-change timing-position-change--down" size={15} strokeWidth={3.2} />}
                {!positionChange && <span aria-hidden="true" className="timing-position-change-placeholder" />}
                <span className="timing-position">{car.racePosition.toString().padStart(2, "0")}</span>
              </span>
              <span className="driver-cell">
                <i style={{ backgroundColor: `#${team.primaryColor.toString(16).padStart(6, "0")}` }} />
                <strong title={driver.name}>{driver.shortName}</strong>
              </span>
              <span className="timing-tyre"><TyreBadge compound={car.tyreCompound} size="small" title={`${car.tyreCompound} · ${car.tyreAgeLaps.toFixed(1)} laps`} /></span>
              <span className={`timing-tyre-life ${car.tyreLife < 30 ? "is-critical" : car.tyreLife < 50 ? "is-warning" : ""}`}>{Math.round(car.tyreLife)}%</span>
              <span className={`timing-gap ${isRetired ? "is-out" : ""}`} title={isRetired ? car.retiredReason ?? "Retired" : car.racePosition === 1 ? "Race leader" : `Gap to car ahead: ${(timingGaps[car.carId]?.ahead ?? car.gapToCarAhead).toFixed(3)} seconds`}>
                {isRetired ? "OUT" : gapLabel(car.racePosition, timingGaps[car.carId]?.ahead ?? car.gapToCarAhead)}
              </span>
              {(pendingPenalty || investigation)
                ? <button
                    aria-label={`${warningTitle}. Show reason`}
                    className={`timing-warning ${pendingPenalty ? "is-penalty" : "is-investigation"}`}
                    onClick={(event) => { event.stopPropagation(); setSportingNoticeCarId(car.carId); }}
                    title={`${warningTitle} · Click for details`}
                    type="button"
                  ><span aria-hidden="true">!</span></button>
                : <span aria-hidden="true" className="timing-warning" />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
