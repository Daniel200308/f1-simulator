"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  CircleAlert,
  CloudRain,
  Flag,
  Gauge,
  MapPin,
  Route,
  ShieldCheck,
  Timer,
  Trophy,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { TyreBadge } from "@/components/race/tyre-badge";
import type { RaceCarState, RaceSnapshot, TyreCompound } from "@/domain/race";
import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import {
  calculateStrategyIntelligence,
  type OpportunityState,
  type StrategyRiskLevel,
  type StrategyScenario,
  type StrategyScenarioKind,
} from "@/simulation/strategy-intelligence";
import { buildRaceStrategyPlans, type RaceStrategyPlan } from "@/simulation/race-strategy-plans";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

import styles from "./strategy-intelligence-panel.module.css";

export interface StrategyIntelligencePanelProps {
  snapshot: RaceSnapshot;
  car: RaceCarState;
  onBox: (compound: TyreCompound) => void;
  onStayOut: () => void;
  onClose: () => void;
}

const RISK_CLASS: Record<StrategyRiskLevel, string> = {
  LOW: styles.riskLow,
  MEDIUM: styles.riskMedium,
  HIGH: styles.riskHigh,
  CRITICAL: styles.riskCritical,
};

const OPPORTUNITY_CLASS: Record<OpportunityState, string> = {
  CAPTURED: styles.opportunityCaptured,
  MISSED: styles.opportunityMissed,
  NONE: styles.opportunityNone,
};

const SCENARIO_ICON: Record<StrategyScenarioKind, typeof Wrench> = {
  BOX_NOW: Wrench,
  STAY_OUT: ShieldCheck,
  UNDERCUT: Route,
  OVERCUT: Timer,
};

function formatProjectedTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds >= 9_999) return "—";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function actionLabel(scenario: StrategyScenario): string {
  if (!scenario.feasible) return "UNAVAILABLE";
  if (scenario.id === "BOX_NOW") return `BOX · ${scenario.compound}`;
  if (scenario.id === "UNDERCUT") return `ATTEMPT UNDERCUT · ${scenario.compound}`;
  if (scenario.id === "OVERCUT") return "EXTEND FOR OVERCUT";
  return "STAY OUT";
}

function ScenarioCard({
  scenario,
  onExecute,
}: {
  scenario: StrategyScenario;
  onExecute: (scenario: StrategyScenario) => void;
}) {
  const Icon = SCENARIO_ICON[scenario.id];
  const deltaLabel = scenario.projectedFinishTimeDeltaSeconds === 0
    ? "FASTEST"
    : scenario.feasible ? `+${scenario.projectedFinishTimeDeltaSeconds.toFixed(1)}s` : "N/A";

  return (
    <article
      aria-label={`${scenario.label} scenario${scenario.recommended ? ", recommended" : ""}`}
      className={`${styles.scenarioCard} ${scenario.recommended ? styles.recommendedCard : ""} ${!scenario.feasible ? styles.unavailableCard : ""}`}
    >
      <header className={styles.scenarioHeader}>
        <span className={styles.scenarioIcon} aria-hidden="true"><Icon size={18} /></span>
        <div>
          <span className={styles.scenarioIndex}>OPTION {scenario.rank.toString().padStart(2, "0")}</span>
          <h3>{scenario.label}</h3>
        </div>
        <TyreBadge compound={scenario.compound} size="medium" />
      </header>

      {scenario.recommended ? (
        <span className={styles.recommendedFlag}><Trophy size={12} aria-hidden="true" /> RECOMMENDED</span>
      ) : null}

      <div className={styles.timeBlock}>
        <div>
          <span>VS BEST</span>
          <strong className={scenario.projectedFinishTimeDeltaSeconds === 0 ? styles.fastest : ""}>{deltaLabel}</strong>
        </div>
        <div>
          <span>FINISH ETA</span>
          <strong>{formatProjectedTime(scenario.projectedTotalRaceTimeSeconds)}</strong>
        </div>
      </div>

      <div className={styles.positionFlow} aria-label={`Rejoin ${scenario.predictedRejoinPosition ? `position ${scenario.predictedRejoinPosition}` : "not applicable"}, predicted finish position ${scenario.predictedFinishPosition}`}>
        <span><MapPin size={13} aria-hidden="true" /><small>REJOIN</small><strong>{scenario.predictedRejoinPosition ? `P${scenario.predictedRejoinPosition}` : "—"}</strong></span>
        <i aria-hidden="true" />
        <span><Flag size={13} aria-hidden="true" /><small>FINISH</small><strong>P{scenario.predictedFinishPosition}</strong></span>
        <i aria-hidden="true" />
        <span className={styles.trafficState}><Users size={13} aria-hidden="true" /><small>TRAFFIC</small><strong>{scenario.traffic.level}</strong></span>
      </div>

      <div className={styles.riskStack}>
        <RiskMeter label="TYRE RISK" level={scenario.tyreRisk.level} score={scenario.tyreRisk.score} />
        <RiskMeter label="THERMAL" level={scenario.thermalRisk.level} score={scenario.thermalRisk.score} />
      </div>

      <div className={styles.opportunities}>
        <OpportunityPill icon={Flag} label="SC / VSC" state={scenario.safetyCarOpportunity.state} value={scenario.safetyCarOpportunity.valueSeconds} />
        <OpportunityPill icon={CloudRain} label="WEATHER" state={scenario.weatherOpportunity.state} value={scenario.weatherOpportunity.valueSeconds} />
      </div>

      <ul className={styles.reasonList}>
        {scenario.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>

      <div className={styles.cardFooter}>
        <span className={styles.confidence}><Gauge size={13} aria-hidden="true" /> CONFIDENCE <b>{Math.round(scenario.confidence * 100)}%</b></span>
        <button
          aria-label={`${actionLabel(scenario)} for ${scenario.label} scenario`}
          className={styles.executeButton}
          disabled={!scenario.feasible}
          onClick={() => onExecute(scenario)}
          type="button"
        >
          {actionLabel(scenario)}
        </button>
      </div>
    </article>
  );
}

function RiskMeter({ label, level, score }: { label: string; level: StrategyRiskLevel; score: number }) {
  return (
    <div className={`${styles.riskMeter} ${RISK_CLASS[level]}`} title={`${label}: ${level}`}>
      <span>{label}</span>
      <i
        aria-label={`${label.toLowerCase()} ${level.toLowerCase()}, ${Math.round(score * 100)} percent`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(score * 100)}
        role="meter"
      ><b style={{ width: `${score * 100}%` }} /></i>
      <strong>{level}</strong>
    </div>
  );
}

function OpportunityPill({
  icon: Icon,
  label,
  state,
  value,
}: {
  icon: typeof Flag;
  label: string;
  state: OpportunityState;
  value: number;
}) {
  return (
    <span className={`${styles.opportunityPill} ${OPPORTUNITY_CLASS[state]}`}>
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
      <strong>{state === "NONE" ? "—" : state}</strong>
      {value > 0 ? <small>{value.toFixed(1)}s</small> : null}
    </span>
  );
}

function PlanTimeline({ plans, currentLap, totalLaps }: { plans: readonly RaceStrategyPlan[]; currentLap: number; totalLaps: number }) {
  const [selectedPlanId, setSelectedPlanId] = useState<RaceStrategyPlan["id"]>("A");
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const remainingLaps = Math.max(1, totalLaps - currentLap + 1);
  return (
    <section className={styles.planBoard} aria-label="Full race tyre strategy plans">
      <header>
        <div><Route aria-hidden="true" size={16} /><span><b>FULL RACE TYRE PLAN</b><small>LIVE FROM LAP {currentLap} TO LAP {totalLaps}</small></span></div>
        <p>AI-ranked one-stop, two-stop and contingency routes</p>
      </header>
      <div className={styles.planRows}>
        {plans.map((plan) => (
          <button
            aria-label={`Plan ${plan.id}, ${plan.name}, ${plan.stopCount} stops`}
            aria-pressed={selectedPlan?.id === plan.id}
            className={`${styles.planRow} ${selectedPlan?.id === plan.id ? styles.planRowActive : ""}`}
            key={plan.id}
            onClick={() => setSelectedPlanId(plan.id)}
            type="button"
          >
            <span className={styles.planIdentity}><strong>PLAN {plan.id}</strong><small>{plan.name}</small></span>
            <span className={styles.planTrack}>
              {plan.stints.map((stint) => {
                const width = ((stint.endLap - stint.startLap + 1) / remainingLaps) * 100;
                return (
                  <span
                    className={styles.planStint}
                    data-compound={stint.compound}
                    key={`${plan.id}-${stint.startLap}-${stint.compound}`}
                    style={{ "--stint-width": `${width}%` } as CSSProperties}
                    title={`${stint.compound} · laps ${stint.startLap}–${stint.endLap} · projected life ${stint.projectedLifeAtEnd}%`}
                  >
                    <b>{stint.compound[0]}</b>
                    <small>L{stint.startLap}–{stint.endLap}</small>
                    {stint.pitAtEnd ? <i>BOX L{stint.endLap}</i> : null}
                  </span>
                );
              })}
            </span>
            <span className={styles.planOutcome}><strong>{plan.stopCount} STOP{plan.stopCount === 1 ? "" : "S"}</strong><small>{plan.projectedDeltaSeconds === 0 ? "OPTIMAL" : `+${plan.projectedDeltaSeconds.toFixed(1)}s`} · {plan.risk}</small></span>
          </button>
        ))}
      </div>
      {selectedPlan ? <footer><strong>PLAN {selectedPlan.id}</strong><span>{selectedPlan.rationale}</span></footer> : null}
    </section>
  );
}

export function StrategyIntelligencePanel({
  snapshot,
  car,
  onBox,
  onStayOut,
  onClose,
}: StrategyIntelligencePanelProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  const assessment = useMemo(() => calculateStrategyIntelligence({
    raceControl: snapshot.raceControl,
    pitLaneOpen: snapshot.pitLaneOpen,
    weather: snapshot.weather,
    cars: snapshot.cars,
    elapsedTime: snapshot.elapsedTime,
    totalLaps: SILVERSTONE_CIRCUIT.totalLaps,
  }, car.carId), [car.carId, snapshot.cars, snapshot.elapsedTime, snapshot.pitLaneOpen, snapshot.raceControl, snapshot.weather]);
  const recommended = assessment.scenarios.find((scenario) => scenario.recommended)!;
  const racePlans = useMemo(() => buildRaceStrategyPlans({
    currentLap: car.currentLap,
    totalLaps: SILVERSTONE_CIRCUIT.totalLaps,
    tyreCompound: car.tyreCompound,
    tyreLife: car.tyreLife,
    tyreAgeLaps: car.tyreAgeLaps,
    tyreSets: car.tyreSets,
    weather: snapshot.weather,
    raceControl: snapshot.raceControl,
  }), [car.currentLap, car.tyreAgeLaps, car.tyreCompound, car.tyreLife, car.tyreSets, snapshot.raceControl, snapshot.weather]);
  const teamColor = team ? `#${team.primaryColor.toString(16).padStart(6, "0")}` : "#20d7e7";

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const executeScenario = (scenario: StrategyScenario) => {
    if (!scenario.feasible) return;
    if (scenario.id === "BOX_NOW" || scenario.id === "UNDERCUT") onBox(scenario.compound);
    else onStayOut();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
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

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        aria-describedby="strategy-intelligence-summary"
        aria-labelledby="strategy-intelligence-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        style={{ "--team-color": teamColor } as CSSProperties}
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <span className={styles.brandIcon} aria-hidden="true"><BrainCircuit size={24} /></span>
          <div className={styles.titleBlock}>
            <span>STRATEGY · LIVE RACE PLAN</span>
            <h2 id="strategy-intelligence-title">{driver?.shortName ?? car.carId.toUpperCase()} Race Strategy</h2>
            <p id="strategy-intelligence-summary">Three full-race tyre plans plus live tactical calls from traffic, weather and Race Control data.</p>
          </div>
          <div className={styles.sessionMeta}>
            <span>LAP <b>{car.currentLap}/{SILVERSTONE_CIRCUIT.totalLaps}</b></span>
            <span>RUNNING <b>P{car.racePosition}</b></span>
            <span>CONTROL <b>{snapshot.raceControl.replace("_", " ")}</b></span>
          </div>
          <button aria-label="Close strategy intelligence" className={styles.closeButton} onClick={onClose} ref={closeRef} title="Close" type="button"><X size={20} /></button>
        </header>

        <div className={styles.recommendationBanner} aria-live="polite">
          <span className={styles.trophyOrb} aria-hidden="true"><Trophy size={20} /></span>
          <div>
            <span>PIT WALL RECOMMENDATION</span>
            <strong>{recommended.label.toUpperCase()}</strong>
            <small>{recommended.reasons[0]}</small>
          </div>
          <TyreBadge compound={recommended.compound} size="large" title={`Recommended ${recommended.compound} tyre`} />
          <div className={styles.recommendationMetric}><span>PROJECTED</span><strong>{formatProjectedTime(recommended.projectedRemainingTimeSeconds)}</strong><small>remaining</small></div>
          <div className={styles.recommendationMetric}><span>FINISH</span><strong>P{recommended.predictedFinishPosition}</strong><small>model</small></div>
          <div className={styles.confidenceDial} style={{ "--confidence": `${recommended.confidence * 360}deg` } as CSSProperties}>
            <span><b>{Math.round(recommended.confidence * 100)}</b><small>%</small></span>
          </div>
          <button className={styles.primaryAction} onClick={() => executeScenario(recommended)} type="button">EXECUTE CALL</button>
        </div>

        <PlanTimeline currentLap={car.currentLap} plans={racePlans} totalLaps={SILVERSTONE_CIRCUIT.totalLaps} />

        <div className={styles.scenarioGrid}>
          {assessment.scenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} onExecute={executeScenario} scenario={scenario} />
          ))}
        </div>

        <footer className={styles.dialogFooter}>
          <span><CircleAlert size={13} aria-hidden="true" /> Projections update with live race state; confidence is model certainty, not a guaranteed result.</span>
          <span><BrainCircuit size={13} aria-hidden="true" /> SILVERSTONE TELEMETRY · SPATIAL WEATHER · LIVE TRAFFIC</span>
          <button onClick={onClose} type="button">RETURN TO PIT WALL</button>
        </footer>
      </section>
    </div>
  );
}
