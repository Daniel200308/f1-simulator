"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CircleGauge,
  Flag,
  Gauge,
  Scale,
  Thermometer,
  Trophy,
  Wrench,
  X,
} from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import type { RaceReport } from "@/simulation/race-report";
import { penaltyLabel } from "@/simulation/stewarding";

import styles from "./replay-report-panel.module.css";

export interface ReplayReportPanelProps {
  open: boolean;
  report: RaceReport;
  onClose: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = Math.floor(safe % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function classificationGap(position: number, status: string, gapSeconds: number, retiredReason: string | null): string {
  if (status === "RETIRED") return retiredReason ? `DNF · ${retiredReason}` : "DNF";
  if (status === "RUNNING") return "RUNNING";
  if (position === 1) return "WINNER";
  return `+${gapSeconds.toFixed(3)}`;
}

export function ReplayReportPanel({
  open,
  report,
  onClose,
  onContinue,
  continueLabel = "Continue championship",
}: ReplayReportPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const winner = report.classification[0];

  function closePanel() {
    onClose();
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) closePanel();
    }}>
      <section aria-labelledby="race-review-title" aria-modal="true" className={styles.panel} ref={panelRef} role="dialog">
        <header className={styles.header}>
          <div className={styles.titleMark}><Flag aria-hidden="true" size={21} strokeWidth={2.2} /></div>
          <div className={styles.title}>
            <span>{report.completed ? "FIA POST-RACE" : "RACE OPERATIONS"}</span>
            <h2 id="race-review-title">{report.completed ? "Official classification" : "Race review"}</h2>
          </div>
          <div aria-label="Review view" className={styles.viewSwitch} role="group"><span><Trophy aria-hidden="true" size={15} />{report.completed ? "Official report" : "Live review"}</span></div>
          {onContinue && <button className={styles.continueButton} onClick={onContinue} type="button">{continueLabel}<ChevronRight aria-hidden="true" size={16} /></button>}
          <button aria-label="Close race review" className={styles.closeButton} onClick={closePanel} ref={closeRef} type="button"><X aria-hidden="true" size={19} /></button>
        </header>

        <div className={styles.reportView}>
            <section className={styles.reportHero} data-completed={report.completed}>
              <div className={styles.winnerMark}><Trophy aria-hidden="true" size={28} /></div>
              <div>
                <span>{report.completed ? "RACE WINNER" : "CURRENT LEADER"}</span>
                <strong>{winner?.driverName ?? "Classification pending"}</strong>
                <small>{winner ? `${winner.teamName} · P${winner.position}${winner.onTrackPosition !== winner.position ? ` · P${winner.onTrackPosition} ON TRACK` : ""}${report.completed ? "" : " · PROVISIONAL"} · ${formatClock(report.elapsedTimeSeconds)}` : "No classified cars"}</small>
              </div>
              <div className={styles.fastestLap}>
                <Gauge aria-hidden="true" size={19} />
                <span>FASTEST LAP</span>
                <strong>{report.fastestLap ? formatLapTime(report.fastestLap.lapTimeSeconds) : "—"}</strong>
                <small>{report.fastestLap?.driverShortName ?? "NO TIME"}</small>
              </div>
            </section>

            <section aria-label="Race totals" className={styles.statRail}>
              <div><Flag aria-hidden="true" size={16} /><span>FINISHERS</span><strong>{report.totals.finishers}/{report.totals.classifiedCars}</strong></div>
              <div><ChevronRight aria-hidden="true" size={16} /><span>OVERTAKES</span><strong>{report.totals.overtakes}</strong></div>
              <div><Wrench aria-hidden="true" size={16} /><span>PIT STOPS</span><strong>{report.totals.pitStops}</strong></div>
              <div><AlertTriangle aria-hidden="true" size={16} /><span>INCIDENTS</span><strong>{report.totals.incidents}</strong></div>
              <div><Scale aria-hidden="true" size={16} /><span>PENALTIES</span><strong>{report.totals.penalties}</strong></div>
            </section>

            <section aria-label="Player team result" className={styles.playerSpotlight}>
              <header><span>TEAM RESULT</span><small>{report.playerReports.length} CONTROLLED CARS · {report.completed ? "CLASSIFIED" : "LIVE PROVISIONAL"}</small></header>
              <div className={styles.playerSpotlightGrid}>
                {report.playerReports.map((player) => {
                  const entry = report.classification.find((candidate) => candidate.carId === player.carId);
                  const strategy = report.tyreStrategies.find((candidate) => candidate.carId === player.carId);
                  const gainLabel = player.positionsGained > 0 ? `+${player.positionsGained}` : player.positionsGained === 0 ? "—" : `${player.positionsGained}`;
                  return (
                    <article data-status={player.incidentStatus} key={player.carId}>
                      <div className={styles.playerSpotlightIdentity}>
                        <span className={styles.driverSignal}>{player.finishPosition <= 3 ? <Trophy aria-hidden="true" size={17} /> : player.driverShortName}</span>
                        <div><strong>{player.driverName}</strong><small>{entry?.teamName ?? "PLAYER CAR"} · GRID P{player.gridPosition}</small></div>
                        <b>P{player.finishPosition}</b>
                      </div>
                      <div className={styles.playerSpotlightMetrics}>
                        <span><small>GAIN</small><strong>{gainLabel}</strong></span>
                        <span><small>OVT</small><strong>{player.overtakes}</strong></span>
                        <span><small>STOPS</small><strong>{player.pitStops}</strong></span>
                        <span><small>THERMAL</small><strong className={player.criticalThermalWarningCount > 0 ? styles.warning : undefined}>{player.thermalWarnings.length}</strong></span>
                      </div>
                      <div className={styles.playerSpotlightStrategy}>
                        <span>STRATEGY</span>
                        <div>{(strategy?.compounds ?? player.tyreStrategy).map((compound, index) => <i data-compound={compound} key={`${player.carId}-${compound}-${index}`}>{compound.slice(0, 1)}</i>)}</div>
                        <b>{strategy?.stintCount ?? player.tyreStrategy.length} STINT{(strategy?.stintCount ?? player.tyreStrategy.length) === 1 ? "" : "S"}</b>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className={styles.reportGrid}>
              <section className={styles.classification}>
                <header><span>CLASSIFICATION</span><small>{report.completed ? "OFFICIAL" : "PROVISIONAL"}</small></header>
                <div className={styles.tableHead}><span>P</span><span>DRIVER</span><span>GAP / STATUS</span><span>STRATEGY</span><span>PEN</span></div>
                <div className={styles.classificationList}>
                  {report.classification.map((entry) => (
                    <div className={styles.classificationRow} data-penalized={entry.penaltySeconds > 0} data-player={report.playerReports.some((player) => player.carId === entry.carId)} data-status={entry.status} key={entry.carId}>
                      <strong>{String(entry.position).padStart(2, "0")}</strong>
                      <span><b>{entry.driverShortName}</b><small>{entry.teamName}{entry.onTrackPosition !== entry.position ? ` · P${entry.onTrackPosition} ON TRACK` : ""}</small></span>
                      <time>{classificationGap(entry.position, entry.status, entry.gapToWinnerSeconds, entry.retiredReason)}</time>
                      <div className={styles.compactTyres} aria-label={`Tyre strategy ${report.tyreStrategies.find((strategy) => strategy.carId === entry.carId)?.strategyLabel ?? "unknown"}`}>
                        {(report.tyreStrategies.find((strategy) => strategy.carId === entry.carId)?.compounds ?? []).map((compound, index) => <span data-compound={compound} key={`${entry.carId}-${compound}-${index}`}>{compound.slice(0, 1)}</span>)}
                      </div>
                      <i>{entry.penaltySeconds > 0 ? `+${entry.penaltySeconds.toFixed(3)}` : "—"}</i>
                    </div>
                  ))}
                </div>
              </section>

              <aside className={styles.sideColumn}>
                <section className={styles.stewards}>
                  <header><span>FIA STEWARDS</span><small>{report.penalties.length} DECISIONS</small></header>
                  <div className={styles.stewardList}>
                    {report.penalties.length === 0 ? <p><Scale aria-hidden="true" size={17} />No sporting penalties issued.</p> : report.penalties.map((penalty) => {
                      const entry = report.classification.find((candidate) => candidate.carId === penalty.carId);
                      return <article key={penalty.id}><strong>{entry?.driverShortName ?? penalty.carId} · {penaltyLabel(penalty.type)}</strong><span>{penalty.reason}</span><small>LAP {penalty.lapNumber} · {penalty.evidence}</small></article>;
                    })}
                  </div>
                </section>
                <section className={styles.debrief}>
                  <header><span>PLAYER DEBRIEF</span><small>{report.playerReports.length} CARS</small></header>
                  <div className={styles.debriefList}>
                    {report.playerReports.map((player) => (
                      <article key={player.carId}>
                        <div className={styles.debriefDriver}><span>{player.driverShortName}</span><strong>P{player.finishPosition}</strong></div>
                        <div className={styles.debriefMetrics}><span>GRID <b>P{player.gridPosition}</b></span><span>GAIN <b>{player.positionsGained > 0 ? `+${player.positionsGained}` : player.positionsGained}</b></span><span>OVT <b>{player.overtakes}</b></span></div>
                        <div className={styles.tyreSequence}>{player.tyreStrategy.map((compound, index) => <span data-compound={compound} key={`${compound}-${index}`}>{compound.slice(0, 1)}</span>)}</div>
                        <footer><span><CircleGauge aria-hidden="true" size={13} />{player.strategyEvents.length} calls</span><span className={player.criticalThermalWarningCount > 0 ? styles.warning : undefined}><Thermometer aria-hidden="true" size={13} />{player.thermalWarnings.length} thermal</span></footer>
                      </article>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
        </div>
      </section>
    </div>
  );
}
