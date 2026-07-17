"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { Activity, ChevronRight, CircleUserRound, Fan, Flag, Gauge, Headphones, Settings2, Timer, Trophy, Waves, Wrench, X } from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import type { TyreCompound } from "@/domain/race";
import { DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import {
  currentWeekendRule,
  latestWeekendResult,
  setupFeedbackFor,
  setupRecommendationFor,
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
      {STANDARD_WEEKEND_RULES.map((rule) => {
        const index = STANDARD_WEEKEND_RULES.findIndex((candidate) => candidate.id === rule.id);
        const complete = state.completedSessions.includes(rule.id as never);
        const active = rule.id === state.currentSession;
        return (
          <li className={`${complete ? styles.complete : ""} ${active ? styles.active : ""}`} key={rule.id}>
            <span>{complete ? "✓" : index + 1}</span>
            <div><b>{rule.id}</b><small>{rule.group}</small></div>
            {rule.id !== STANDARD_WEEKEND_RULES.at(-1)?.id && <i />}
          </li>
        );
      })}
    </ol>
  );
}

function SetupControl({ carId, setup, state, onChange, slot }: { carId: string; setup: CarSetup; state: WeekendState; onChange: (setup: CarSetup) => void; slot: number }) {
  const driver = DRIVER_BY_ID.get(carId);
  if (!driver) return null;
  const team = TEAM_BY_ID.get(driver.teamId);
  const tone = team ? `#${(slot === 0 ? team.primaryColor : team.accentColor).toString(16).padStart(6, "0")}` : "#20d7e7";
  const controls: readonly { key: keyof CarSetup; label: string; detail: string; minimum: number; maximum: number; low: string; high: string; icon: typeof Gauge }[] = [
    { key: "frontWing", label: "FRONT WING", detail: "AERO BALANCE", minimum: 1, maximum: 10, low: "SPEED", high: "GRIP", icon: Gauge },
    { key: "rearWing", label: "REAR WING", detail: "REAR LOAD", minimum: 1, maximum: 10, low: "LOW DRAG", high: "STABILITY", icon: Gauge },
    { key: "suspension", label: "SUSPENSION", detail: "DAMPER RESPONSE", minimum: 1, maximum: 10, low: "SOFT", high: "FIRM", icon: Waves },
    { key: "rideHeight", label: "RIDE HEIGHT", detail: "FLOOR PLATFORM", minimum: 1, maximum: 10, low: "LOW", high: "SAFE", icon: Activity },
    { key: "differential", label: "DIFFERENTIAL", detail: "TRACTION LOCK", minimum: 1, maximum: 10, low: "OPEN", high: "LOCKED", icon: Settings2 },
    { key: "cooling", label: "COOLING", detail: "BODYWORK APERTURE", minimum: 1, maximum: 5, low: "TIGHT", high: "OPEN", icon: Fan },
  ];
  return (
    <section className={styles.setupCar} data-slot={slot} style={{ "--driver-tone": tone } as CSSProperties}>
      <header><span>#{driver.number}</span><div><strong>{driver.shortName}</strong><small>{driver.name}</small></div><b>{state.setupKnowledge}% DATA</b></header>
      <div className={styles.setupVisual}>
        <div className={styles.carFigure}>
          <Image alt={`${driver.name} setup car, top view`} height={640} priority src="/assets/telemetry/formula-car-top.png" width={420} />
          <span>{driver.shortName}</span>
        </div>
        <div className={styles.controlStack}>
          {controls.map((control) => {
            const Icon = control.icon;
            const progress = ((setup[control.key] - control.minimum) / (control.maximum - control.minimum)) * 100;
            const recommendation = setupRecommendationFor(state, carId, control.key);
            const recommendationStart = recommendation ? ((recommendation.minimum - control.minimum) / (control.maximum - control.minimum)) * 100 : 0;
            const recommendationWidth = recommendation ? ((recommendation.maximum - recommendation.minimum) / (control.maximum - control.minimum)) * 100 : 0;
            return (
              <label key={control.key} style={{ "--control-progress": `${progress}%` } as CSSProperties}>
                <span><Icon aria-hidden="true" size={18} /><i><b>{control.label}</b><small>{control.detail}</small></i><strong>{setup[control.key]}</strong></span>
                <div className={styles.rangeControl} style={{ "--recommendation-start": `${recommendationStart}%`, "--recommendation-width": `${recommendationWidth}%` } as CSSProperties}>
                  <input
                    aria-label={`${driver.shortName} ${control.label}`}
                    max={control.maximum}
                    min={control.minimum}
                    onChange={(event) => onChange({ ...setup, [control.key]: Number(event.target.value) })}
                    step={state.setupKnowledge >= 60 ? 0.5 : 1}
                    type="range"
                    value={setup[control.key]}
                  />
                  {recommendation ? <span className={styles.recommendationBand} title={`${recommendation.sourceSession} telemetry range ${recommendation.minimum} to ${recommendation.maximum}`} /> : null}
                </div>
                <small className={styles.rangeLegend}><i>{control.low}</i>{recommendation ? <b>{recommendation.sourceSession} RANGE {recommendation.minimum}–{recommendation.maximum}</b> : <b>BASELINE</b>}<i>{control.high}</i></small>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function concise(message: string, maximumCharacters = 180): string {
  const sentences = message.split(/(?<=[.!?])\s+(?=[A-Z“])/u);
  const first = sentences[0]?.trim() ?? message.trim();
  const second = sentences[1]?.trim();
  const combined = second ? `${first} ${second}` : first;
  if (combined.length <= maximumCharacters) return combined;
  if (first.length <= maximumCharacters) return first;
  const clipped = first.slice(0, maximumCharacters - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, Math.max(48, boundary)).replace(/[,:;\s]+$/u, "")}.`;
}

function dockSummary(message: string): string {
  const firstSentence = message.split(/(?<=[.!?])\s+/u)[0]?.trim() ?? message.trim();
  const clauses = firstSentence.split(/\s+[—–]\s+|:\s+/u).map((clause) => clause.trim()).filter(Boolean);
  const actionableClause = clauses.at(-1) ?? firstSentence;
  const sentence = `${actionableClause.charAt(0).toUpperCase()}${actionableClause.slice(1)}`;
  return concise(sentence, 116);
}

function DebriefDock({ state }: { state: WeekendState }) {
  const playerCarIds = playerCarIdsFor(state.playerTeamId);
  const latestReport = state.sessionReports.at(-1);
  return (
    <section className={styles.debriefDock} aria-label="Garage debrief">
      <header><Activity aria-hidden="true" size={18} /><div><b>GARAGE DEBRIEF</b><small>DRIVER FEEDBACK · ENGINEERING RESPONSE</small></div><strong>{state.setupKnowledge}% CONFIDENCE</strong></header>
      <div className={styles.debriefGrid}>
        {playerCarIds.flatMap((carId, slot) => {
          const driver = DRIVER_BY_ID.get(carId)!;
          const team = TEAM_BY_ID.get(driver.teamId)!;
          const report = latestReport?.cars.find((candidate) => candidate.carId === carId);
          const feedback = setupFeedbackFor(state, carId);
          const tone = `#${(slot === 0 ? team.primaryColor : team.accentColor).toString(16).padStart(6, "0")}`;
          const driverMessage = report?.driverMessage
            ? dockSummary(report.driverMessage)
            : "Baseline ready. I will establish the first reference, then report the balance from entry to exit.";
          const engineerMessage = report?.engineerMessage
            ? dockSummary(report.engineerMessage)
            : feedback.length > 1
              ? dockSummary(feedback[1].message)
              : "Run plan loaded. We will compare both cars before changing more than one setup parameter.";
          return [
            <article className={styles.debriefCard} data-speaker="driver" key={`${carId}-driver`} style={{ "--speaker-tone": tone } as CSSProperties}>
              <header><CircleUserRound aria-hidden="true" size={24} /><div><span>DRIVER</span><strong>{driver.shortName}</strong><small>{driver.name}</small></div><Activity aria-hidden="true" className={styles.voiceWave} size={46} /></header>
              <p>{driverMessage}</p>
            </article>,
            <article className={styles.debriefCard} data-speaker="engineer" key={`${carId}-engineer`} style={{ "--speaker-tone": tone } as CSSProperties}>
              <header><Headphones aria-hidden="true" size={24} /><div><span>ENGINEER</span><strong>{driver.shortName} ENGINEER</strong><small>{team.shortName} PITWALL</small></div><Activity aria-hidden="true" className={styles.voiceWave} size={46} /></header>
              <p>{engineerMessage}</p>
            </article>,
          ];
        })}
      </div>
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
              ["ENERGY RECOVERY", carReport.energyRecoveryPercent],
              ["DEPLOY CORRELATION", carReport.energyDeploymentPercent],
            ] as const;
            return (
              <article className={styles.reportCar} key={carReport.carId} style={{ "--team": `#${team.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}>
                <header><span>#{driver.number}</span><div><h3>{driver.name}</h3><p>{driver.shortName} · {team.shortName}</p></div><b data-outcome={carReport.outcome}>{carReport.position ? `P${carReport.position}` : carReport.outcome}</b></header>
                <div className={styles.conditionGrid}>{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}%</strong><i><b style={{ width: `${value}%` }} /></i></span>)}</div>
                <div className={styles.reportMessages}>
                  <article><Headphones aria-hidden="true" size={18} /><div><strong>DRIVER REPORT</strong><p>“{concise(carReport.driverMessage, 215)}”</p></div></article>
                  <article><Wrench aria-hidden="true" size={18} /><div><strong>ENGINEER REPORT</strong><p>{concise(carReport.engineerMessage, 215)}</p></div></article>
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
  const teamTone = playerTeam ? `#${playerTeam.primaryColor.toString(16).padStart(6, "0")}` : "#20d7e7";

  return (
    <div className={styles.backdrop} data-weekend-session={state.currentSession}>
      <main className={styles.hub} style={{ "--team-tone": teamTone } as CSSProperties}>
        <header className={styles.header}>
          <div className={styles.sessionMasthead}>
            <span>ROUND 09 · GREAT BRITAIN · SILVERSTONE</span>
            <div><strong>{state.currentSession}</strong><i><b>{sessionTitle}</b><small>{playerTeam?.name.toUpperCase()} · SESSION COMMAND</small></i></div>
          </div>
          <SessionRail state={state} />
        </header>

        <section className={`${styles.workspace} ${isRace ? styles.raceWorkspace : ""} ${!isRace && !sessionResult ? styles.workspaceSolo : ""}`}>
          {isRace ? (
            <section className={styles.timingPanel}>
              <header><div><Flag aria-hidden="true" size={19} /><span><b>RACE PREPARATION</b><small>FINAL GRID · START TYRE CONFIRMATION</small></span></div></header>
              <RacePreparation onStartingTyreChange={onStartingTyreChange} startingTyres={startingTyres} state={state} />
            </section>
          ) : (
            <>
              <section className={styles.garageCanvas}>
                <header><Settings2 aria-hidden="true" size={19} /><div><b>GARAGE TELEMETRY</b><small>SILVERSTONE SETUP LAB · TWO-CAR COMPARISON</small></div><span>LIVE INPUT</span></header>
                <div className={styles.setupCars}>{playerCarIds.map((carId, index) => <SetupControl carId={carId} key={carId} onChange={(setup) => onSetupChange(carId, setup)} setup={state.setups[carId]} slot={index} state={state} />)}</div>
              </section>

              {sessionResult && <section className={styles.timingPanel}>
                <header><div>{sessionResult ? <Timer aria-hidden="true" size={19} /> : <Activity aria-hidden="true" size={19} />}<span><b>{sessionResult ? `${sessionResult.session} CLASSIFICATION` : "SESSION PLAN"}</b><small>{sessionResult ? `${sessionResult.entries.length} CLASSIFIED · BEST LAP ORDER` : `${state.currentSession} RUN PROGRAMME · READY`}</small></span></div>{sessionResult?.entries.some((entry) => entry.eliminated) && <em>ELIMINATION ZONE</em>}</header>
                <Classification state={state} />
              </section>}
            </>
          )}
        </section>

        <section className={styles.debriefArea}>
          <DebriefDock state={state} />
          <footer className={styles.footer}>
            <span>{isRace ? "GRID READY" : `${state.completedSessions.length}/6 COMPLETE`}<small>{isRace ? "Confirm race tyres" : "SESSION SIMULATION"}</small></span>
            <button className={styles.primary} onClick={isRace ? onStartRace : onRunSession} type="button">{isRace ? "START RACE" : `RUN ${state.currentSession}`}<ChevronRight aria-hidden="true" size={26} /></button>
          </footer>
        </section>
      </main>
      {activeReport && <SessionReport onClose={onCloseReport} report={activeReport} />}
    </div>
  );
}
