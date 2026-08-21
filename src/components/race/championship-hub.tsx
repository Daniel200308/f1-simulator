"use client";

import { Flag, Gauge, ShieldCheck, Trophy, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";

import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import {
  currentChampionshipRound,
  driverStandings,
  teamStandings,
  type ChampionshipState,
} from "@/simulation/championship";
import {
  assessReliability,
  RELIABILITY_COMPONENTS,
  reliabilityCondition,
  type MaintenanceAction,
  type ReliabilityState,
} from "@/simulation/reliability";
import { circuitById } from "@/simulation/track";

import styles from "./championship-hub.module.css";

interface ChampionshipHubProps {
  championship: ChampionshipState;
  reliability: ReliabilityState;
  onClose: () => void;
  onMaintenance: (actions: readonly MaintenanceAction[]) => void;
  onStartRound: () => void;
}

export function ChampionshipHub({ championship, reliability, onClose, onMaintenance, onStartRound }: ChampionshipHubProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const round = currentChampionshipRound(championship);
  const circuit = circuitById(round?.circuitId);
  const drivers = driverStandings(championship);
  const teams = teamStandings(championship);
  const assessment = assessReliability(reliability, { horizonKm: circuit.lengthMeters * circuit.totalLaps / 1_000 });
  const championshipComplete = championship.status === "COMPLETED";
  const maintenanceAvailable = Boolean(!championshipComplete && round && round.roundNumber > reliability.currentRound);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <main aria-label="Championship operations" aria-modal="true" className={styles.panel} role="dialog">
        <header className={styles.header}>
          <span><Trophy aria-hidden="true" size={26} /></span>
          <div><small>PROJECT PITWALL · MINI CHAMPIONSHIP</small><h1>{championshipComplete ? "Season complete" : `Round ${round?.roundNumber} ready`}</h1></div>
          <button onClick={onClose} ref={closeRef} type="button">Return to pitwall</button>
        </header>

        <section className={styles.roundRail}>
          {championship.schedule.map((scheduled) => {
            const venue = circuitById(scheduled.circuitId);
            const completed = championship.roundResults.some((result) => result.roundNumber === scheduled.roundNumber);
            const active = scheduled.roundNumber === round?.roundNumber;
            return <article data-active={active} data-completed={completed} key={scheduled.roundNumber}><span>R{scheduled.roundNumber}</span><strong>{venue.shortName}</strong><small>{completed ? "CLASSIFIED" : active ? "NEXT" : "LOCKED"}</small></article>;
          })}
        </section>

        <section className={styles.hero}>
          <div><Flag aria-hidden="true" size={18} /><span>NEXT EVENT</span><h2>{championshipComplete ? "Championship classified" : circuit.name}</h2><p>{championshipComplete ? `${championship.roundResults.length} rounds complete` : `${circuit.country} · ${(circuit.lengthMeters / 1_000).toFixed(3)} km · ${circuit.totalLaps} laps · ${circuit.turns} turns`}</p></div>
          {!championshipComplete && <button onClick={onStartRound} type="button">Enter race weekend</button>}
        </section>

        <div className={styles.workspace}>
          <section className={styles.standings}>
            <header><span>DRIVERS</span><small>{championship.roundResults.length}/{championship.schedule.length} ROUNDS</small></header>
            <div>{drivers.length === 0 ? <p>No points awarded yet.</p> : drivers.slice(0, 10).map((entry) => <article key={entry.driverId}><b>{entry.rank}</b><span><strong>{DRIVER_BY_ID.get(entry.driverId)?.shortName ?? entry.driverId}</strong><small>{TEAM_BY_ID.get(entry.teamId)?.name ?? entry.teamId}</small></span><em>{entry.points} PTS</em></article>)}</div>
          </section>

          <section className={styles.standings}>
            <header><span>CONSTRUCTORS</span><small>TEAM POINTS</small></header>
            <div>{teams.length === 0 ? <p>No points awarded yet.</p> : teams.slice(0, 10).map((entry) => <article key={entry.teamId}><b>{entry.rank}</b><span><strong>{TEAM_BY_ID.get(entry.teamId)?.name ?? entry.teamId}</strong><small>{entry.wins} WINS · {entry.fastestLaps} FL</small></span><em>{entry.points} PTS</em></article>)}</div>
          </section>

          <section className={styles.reliability}>
            <header><span>CAR RELIABILITY</span><small>{assessment.failureRiskPercent.toFixed(1)}% RACE RISK</small></header>
            {reliability.pendingGridPenaltyPlaces > 0 && <div className={styles.gridPenalty}><Flag aria-hidden="true" size={16} /><span><strong>GRID PENALTY PENDING</strong><small>Both team cars drop {reliability.pendingGridPenaltyPlaces} places at race start.</small></span><b>−{reliability.pendingGridPenaltyPlaces}</b></div>}
            <div className={styles.healthSummary}><Gauge aria-hidden="true" size={20} /><span><strong>{assessment.condition}</strong><small>{assessment.performanceDeratePercent.toFixed(2)}% projected derate</small></span></div>
            <div className={styles.components}>{RELIABILITY_COMPONENTS.map((kind) => {
              const component = reliability.components[kind];
              return <article data-condition={reliabilityCondition(component.health)} key={kind}><span>{kind}</span><strong>{component.health.toFixed(0)}%</strong><i><b style={{ width: `${component.health}%` }} /></i><small>UNIT {component.unitNumber} · {component.mileageKm.toFixed(0)} KM</small></article>;
            })}</div>
            {!championshipComplete && <footer data-locked={!maintenanceAvailable}><button disabled={!maintenanceAvailable} onClick={() => onMaintenance([{ type: "REPAIR", component: assessment.limitingComponent, level: "STANDARD" }])} type="button"><Wrench aria-hidden="true" size={14} />Repair {assessment.limitingComponent}</button><button disabled={!maintenanceAvailable} onClick={() => onMaintenance([{ type: "REPLACE", component: assessment.limitingComponent }])} type="button"><ShieldCheck aria-hidden="true" size={14} />Fit new unit</button>{!maintenanceAvailable && <small>{round?.roundNumber === reliability.currentRound ? "Maintenance opens after this round" : "Between-round service already completed"}</small>}</footer>}
          </section>
        </div>
      </main>
    </div>
  );
}
