"use client";

import type { CSSProperties } from "react";
import { ChevronRight, Flag, Gauge, Headphones, Settings2, Timer, Trophy, Wrench, X } from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import type { TyreCompound } from "@/domain/race";
import { DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import {
  currentWeekendRule,
  latestWeekendResult,
  setupFeedbackFor,
  STANDARD_WEEKEND_RULES,
  type CarSetup,
  type WeekendSessionReport,
  type WeekendState,
} from "@/simulation/weekend";

import styles from "./weekend-hub.module.css";

const COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const TYRE_SHORT: Record<TyreCompound, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

interface WeekendHubProps {
  state: WeekendState;
  startingTyres: Readonly<Record<string, TyreCompound>>;
  onRunSession: () => void;
  onSetupChange: (carId: string, setup: CarSetup) => void;
  onStartingTyreChange: (carId: string, compound: TyreCompound) => void;
  onStartRace: () => void;
  activeReport: WeekendSessionReport | null;
  onCloseReport: () => void;
}

function SessionRail({ state }: { state: WeekendState }) {
  return (
    <ol className={styles.sessionRail} aria-label="Race weekend progress">
      {STANDARD_WEEKEND_RULES.map((rule, index) => {
        const complete = state.completedSessions.includes(rule.id as never);
        const active = state.currentSession === rule.id;
        return (
          <li className={complete ? styles.complete : active ? styles.active : ""} key={rule.id}>
            <span>{complete ? "✓" : index + 1}</span>
            <div><b>{rule.id}</b><small>{rule.group}</small></div>
            {index < STANDARD_WEEKEND_RULES.length - 1 && <ChevronRight aria-hidden="true" size={13} />}
          </li>
        );
      })}
    </ol>
  );
}

function SetupControl({ carId, setup, knowledge, onChange }: { carId: string; setup: CarSetup; knowledge: number; onChange: (setup: CarSetup) => void }) {
  const driver = DRIVER_BY_ID.get(carId);
  if (!driver) return null;
  const controls: readonly { key: keyof CarSetup; label: string; minimum: number; maximum: number; low: string; high: string }[] = [
    { key: "frontWing", label: "FRONT WING", minimum: 1, maximum: 10, low: "SPEED", high: "GRIP" },
    { key: "suspension", label: "SUSPENSION", minimum: 1, maximum: 10, low: "SOFT", high: "FIRM" },
    { key: "cooling", label: "COOLING", minimum: 1, maximum: 5, low: "TIGHT", high: "OPEN" },
  ];
  return (
    <section className={styles.setupCar}>
      <header><span>#{driver.number}</span><div><strong>{driver.shortName}</strong><small>{driver.name}</small></div><b>{knowledge}% DATA</b></header>
      {controls.map((control) => (
        <label key={control.key}>
          <span>{control.label}<b>{setup[control.key]}</b></span>
          <input
            aria-label={`${driver.shortName} ${control.label}`}
            max={control.maximum}
            min={control.minimum}
            onChange={(event) => onChange({ ...setup, [control.key]: Number(event.target.value) })}
            type="range"
            value={setup[control.key]}
          />
          <small><i>{control.low}</i><i>{control.high}</i></small>
        </label>
      ))}
    </section>
  );
}

function Classification({ state }: { state: WeekendState }) {
  const latest = latestWeekendResult(state);
  if (!latest) {
    return (
      <div className={styles.emptyTiming}>
        <Gauge aria-hidden="true" size={30} />
        <strong>NO SESSION DATA</strong>
        <span>Run FP1 to establish the first Silverstone baseline.</span>
      </div>
    );
  }
  return (
    <div className={styles.classification}>
      <header><span>POS</span><span>DRIVER</span><span>COMPOUND</span><span>BEST</span><span>GAP</span></header>
      <div>
        {latest.entries.map((entry) => {
          const driver = DRIVER_BY_ID.get(entry.carId);
          const team = driver ? TEAM_BY_ID.get(driver.teamId) : undefined;
          if (!driver || !team) return null;
          return (
            <div className={entry.eliminated ? styles.eliminated : ""} key={entry.carId}>
              <b>{entry.position.toString().padStart(2, "0")}</b>
              <span style={{ "--team": `#${team.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}><i /><strong>{driver.shortName}</strong><small>{team.shortName}</small></span>
              <em data-compound={entry.compound}>{entry.compound[0]}</em>
              <time>{formatLapTime(entry.bestLapSeconds)}</time>
              <small>{entry.position === 1 ? "LEADER" : `+${entry.gapSeconds.toFixed(3)}`}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RacePreparation({ state, startingTyres, onStartingTyreChange }: Pick<WeekendHubProps, "state" | "startingTyres" | "onStartingTyreChange">) {
  const playerCarIds = playerCarIdsFor(state.playerTeamId);
  return (
    <div className={styles.racePreparation}>
      <section className={styles.gridPreview}>
        <header><Trophy aria-hidden="true" size={18} /><span><b>STARTING GRID</b><small>QUALIFYING CLASSIFICATION APPLIED</small></span></header>
        <div>{state.gridOrder.slice(0, 10).map((carId, index) => {
          const driver = DRIVER_BY_ID.get(carId);
          const team = driver ? TEAM_BY_ID.get(driver.teamId) : undefined;
          if (!driver || !team) return null;
          return <span key={carId}><b>P{index + 1}</b><i style={{ background: `#${team.primaryColor.toString(16).padStart(6, "0")}` }} /><strong>{driver.shortName}</strong><small>{team.shortName}</small></span>;
        })}</div>
      </section>
      <section className={styles.startTyres}>
        <header><Flag aria-hidden="true" size={18} /><span><b>RACE START TYRES</b><small>CONFIRM BOTH PLAYER CARS</small></span></header>
        {playerCarIds.map((carId) => {
          const driver = DRIVER_BY_ID.get(carId)!;
          return <div key={carId}><span><b>{driver.shortName}</b><small>GRID P{state.gridOrder.indexOf(carId) + 1}</small></span><div>{COMPOUNDS.map((compound) => <button aria-label={`${driver.shortName} start on ${compound}`} aria-pressed={startingTyres[carId] === compound} data-compound={compound} key={compound} onClick={() => onStartingTyreChange(carId, compound)} type="button">{TYRE_SHORT[compound]}</button>)}</div></div>;
        })}
      </section>
    </div>
  );
}

function SessionReport({ report, onClose }: { report: WeekendSessionReport; onClose: () => void }) {
  return (
    <div className={styles.reportBackdrop} role="presentation">
      <section aria-labelledby="session-report-title" aria-modal="true" className={styles.sessionReport} role="dialog">
        <header>
          <div><span>SESSION COMPLETE · TEAM DEBRIEF</span><h2 id="session-report-title">{report.title}</h2><p>{report.summary}</p></div>
          <button aria-label="Close session report" onClick={onClose} type="button"><X aria-hidden="true" size={21} /></button>
        </header>
        <div className={styles.reportCars}>
          {report.cars.map((carReport) => {
            const driver = DRIVER_BY_ID.get(carReport.carId)!;
            const team = TEAM_BY_ID.get(driver.teamId)!;
            const metrics = [
              ["AERO BALANCE", carReport.aeroBalancePercent],
              ["MECHANICAL", carReport.mechanicalBalancePercent],
              ["THERMAL MARGIN", carReport.thermalMarginPercent],
              ["TYRE CONDITION", carReport.tyreConditionPercent],
            ] as const;
            return (
              <article className={styles.reportCar} key={carReport.carId} style={{ "--team": `#${team.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}>
                <header><span>#{driver.number}</span><div><h3>{driver.name}</h3><p>{driver.shortName} · {team.shortName}</p></div><b data-outcome={carReport.outcome}>{carReport.position ? `P${carReport.position}` : carReport.outcome}</b></header>
                <div className={styles.conditionGrid}>{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}%</strong><i><b style={{ width: `${value}%` }} /></i></span>)}</div>
                <div className={styles.reportMessages}>
                  <article><Headphones aria-hidden="true" size={18} /><div><strong>DRIVER REPORT</strong><p>“{carReport.driverMessage}”</p></div></article>
                  <article><Wrench aria-hidden="true" size={18} /><div><strong>ENGINEER REPORT</strong><p>{carReport.engineerMessage}</p></div></article>
                </div>
              </article>
            );
          })}
        </div>
        <footer><button onClick={onClose} type="button">ACKNOWLEDGE REPORT <ChevronRight aria-hidden="true" size={18} /></button></footer>
      </section>
    </div>
  );
}

export function WeekendHub({ state, startingTyres, onRunSession, onSetupChange, onStartingTyreChange, onStartRace, activeReport, onCloseReport }: WeekendHubProps) {
  const rule = currentWeekendRule(state);
  const playerCarIds = playerCarIdsFor(state.playerTeamId);
  const playerTeam = TEAM_BY_ID.get(state.playerTeamId);
  const isRace = state.currentSession === "RACE";
  const sessionResult = latestWeekendResult(state);
  const sessionTitle = isRace ? "RACE PREPARATION" : rule.group === "PRACTICE" ? "FREE PRACTICE" : "QUALIFYING";
  const sessionDetail = isRace
    ? "52 LAPS · FINAL GRID LOCKED"
    : rule.group === "QUALIFYING"
      ? `${rule.breakBeforeMinutes ? `${rule.breakBeforeMinutes} MIN BREAK · ` : ""}${rule.durationMinutes} MIN · ${rule.entrants} CARS · ${rule.eliminated ? `${rule.eliminated} ELIMINATED` : "POLE SHOOTOUT"}`
      : `${rule.durationMinutes} MIN · SETUP & RUN PROGRAMME`;

  return (
    <div className={styles.backdrop} data-weekend-session={state.currentSession}>
      <main className={styles.hub}>
        <header className={styles.header}>
          <div><span>ROUND 09 · GREAT BRITAIN · {playerTeam?.name.toUpperCase()}</span><h1>Silverstone Race Weekend</h1><p>STANDARD FORMAT · 22 DRIVERS · 5.891 KM</p></div>
          <div className={styles.sessionIdentity}><span>{sessionTitle}</span><strong>{state.currentSession}</strong><small>{sessionDetail}</small></div>
        </header>
        <SessionRail state={state} />

        <section className={styles.workspace}>
          <aside className={styles.setupPanel}>
            <header><Settings2 aria-hidden="true" size={18} /><div><b>CAR SETUP</b><small>SILVERSTONE BASELINE</small></div></header>
            <div className={styles.setupCars}>{playerCarIds.map((carId) => <SetupControl carId={carId} key={carId} knowledge={state.setupKnowledge} onChange={(setup) => onSetupChange(carId, setup)} setup={state.setups[carId]} />)}</div>
            <div className={styles.feedback}>
              <b>FP DRIVER DEBRIEF · {state.setupKnowledge}% CONFIDENCE</b>
              {playerCarIds.map((carId) => {
                const driver = DRIVER_BY_ID.get(carId)!;
                return (
                  <section key={carId}>
                    <h4>{driver.shortName} · RUN FEEDBACK</h4>
                    <ul>{setupFeedbackFor(state, carId).map((item) => <li data-severity={item.severity} key={`${carId}-${item.area}`}><span>{item.area}</span><p>{item.message}</p></li>)}</ul>
                  </section>
                );
              })}
              <i><b style={{ width: `${state.setupKnowledge}%` }} /></i>
            </div>
          </aside>

          <section className={styles.timingPanel}>
            <header><div><Timer aria-hidden="true" size={18} /><span><b>{sessionResult?.session ?? state.currentSession} CLASSIFICATION</b><small>{sessionResult ? `${sessionResult.durationMinutes} MIN · ${sessionResult.entries.length} CLASSIFIED` : "AWAITING GREEN LIGHT"}</small></span></div>{sessionResult?.entries.some((entry) => entry.eliminated) && <em>RED = ELIMINATED</em>}</header>
            {isRace ? <RacePreparation onStartingTyreChange={onStartingTyreChange} startingTyres={startingTyres} state={state} /> : <Classification state={state} />}
          </section>

          <aside className={styles.rulesPanel}>
            <span>OFFICIAL FORMAT</span>
            <h2>{state.currentSession}</h2>
            <div><b>{rule.durationMinutes ?? 52}</b><small>{isRace ? "LAPS" : "MINUTES"}</small></div>
            <dl><div><dt>ENTRY</dt><dd>{rule.entrants} CARS</dd></div><div><dt>ADVANCE</dt><dd>{isRace ? "GRID ORDER" : rule.eliminated ? `${rule.entrants - rule.eliminated} CARS` : "ALL CARS"}</dd></div><div><dt>TRACK</dt><dd>{Math.round(state.setupKnowledge)}% LEARNED</dd></div></dl>
            {rule.group === "QUALIFYING" && <p>Fastest lap decides classification. Q1 and Q2 times are deleted for advancing cars; the next segment starts clean.</p>}
            {rule.group === "PRACTICE" && <p>Run programmes build setup knowledge and consume one nominated tyre set per driver.</p>}
            {isRace && <p>Qualifying order is transferred directly to the compact Hamilton Straight starting grid.</p>}
          </aside>
        </section>

        <footer className={styles.footer}>
          <span>{isRace ? "GRID READY" : `${state.completedSessions.length}/6 SESSIONS COMPLETE`}<small>{isRace ? "Confirm race tyres before lights sequence" : "Deterministic session simulation"}</small></span>
          <div>
            <button className={styles.primary} onClick={isRace ? onStartRace : onRunSession} type="button">{isRace ? "START FORMATION · LIGHTS" : `RUN ${state.currentSession}`}<ChevronRight aria-hidden="true" size={18} /></button>
          </div>
        </footer>
      </main>
      {activeReport && <SessionReport onClose={onCloseReport} report={activeReport} />}
    </div>
  );
}
