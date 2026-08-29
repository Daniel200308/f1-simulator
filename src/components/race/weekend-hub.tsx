"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import { Activity, Check, ChevronRight, CircleUserRound, Fan, Flag, Gauge, Headphones, Settings2, Timer, Trophy, Waves, X } from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import { TyreBadge } from "@/components/race/tyre-badge";
import type { TyreCompound, TyreSetState } from "@/domain/race";
import { DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import {
  CAR_SETUP_MAXIMUM,
  CAR_SETUP_MINIMUM,
  currentWeekendRule,
  latestWeekendResult,
  setupRecommendationFor,
  STANDARD_WEEKEND_RULES,
  type CarSetup,
  type WeekendSessionResult,
  type WeekendSessionReport,
  type WeekendState,
} from "@/simulation/weekend";
import { circuitById } from "@/simulation/track";
import { buildRaceStrategyPlans } from "@/simulation/race-strategy-plans";
import { buildRaceStartingTyrePlan } from "@/simulation/starting-tyre-strategy";
import { chooseRaceStartTyreSet, raceStartTyreInventory, raceStartTyreSetsFor, type RaceStartTyreSelection } from "@/simulation/tyre-allocation";
import { createSpatialWeather } from "@/simulation/weather";

import styles from "./weekend-hub.module.css";

const COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const TYRE_SHORT: Record<TyreCompound, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

interface WeekendHubProps {
  state: WeekendState;
  startingTyres: Readonly<Record<string, RaceStartTyreSelection>>;
  onRunSession: () => void;
  onSetupChange: (carId: string, setup: CarSetup) => void;
  onStartingTyreChange: (carId: string, selection: RaceStartTyreSelection) => void;
  onStartRace: () => void;
  activeReport: WeekendSessionReport | null;
  onCloseReport: () => void;
}

function SessionRail({ state }: { state: WeekendState }) {
  return (
    <ol className={styles.sessionRail} aria-label="Race weekend progress">
      {STANDARD_WEEKEND_RULES.map((rule, index) => {
        const complete = state.completedSessions.includes(rule.id as never);
        const active = rule.id === state.currentSession;
        const status = complete ? "completed" : active ? "current" : "upcoming";
        return (
          <li
            aria-current={active ? "step" : undefined}
            aria-label={`${rule.id} ${rule.group.toLowerCase()}, ${status}`}
            aria-posinset={index + 1}
            aria-setsize={STANDARD_WEEKEND_RULES.length}
            className={`${complete ? styles.complete : ""} ${active ? styles.active : ""}`}
            data-state={status}
            key={rule.id}
          >
            <div className={styles.sessionContent}>
              <span aria-hidden="true" className={styles.sessionNode}>{complete ? <Check size={15} strokeWidth={3} /> : <i />}</span>
              <span className={styles.sessionCopy}><b>{rule.id}</b></span>
            </div>
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
  const tone = team ? `#${(slot === 0 ? team.primaryColor : team.accentColor).toString(16).padStart(6, "0")}` : "#7b858f";
  const controls: readonly { key: keyof CarSetup; label: string; minimum: number; maximum: number; low: string; high: string; icon: typeof Gauge }[] = [
    { key: "frontWing", label: "FRONT WING", minimum: CAR_SETUP_MINIMUM, maximum: CAR_SETUP_MAXIMUM, low: "SPEED", high: "GRIP", icon: Gauge },
    { key: "rearWing", label: "REAR WING", minimum: CAR_SETUP_MINIMUM, maximum: CAR_SETUP_MAXIMUM, low: "LOW DRAG", high: "STABILITY", icon: Gauge },
    { key: "suspension", label: "SUSPENSION", minimum: CAR_SETUP_MINIMUM, maximum: CAR_SETUP_MAXIMUM, low: "SOFT", high: "FIRM", icon: Waves },
    { key: "rideHeight", label: "RIDE HEIGHT", minimum: CAR_SETUP_MINIMUM, maximum: CAR_SETUP_MAXIMUM, low: "LOW", high: "SAFE", icon: Activity },
    { key: "differential", label: "DIFFERENTIAL", minimum: CAR_SETUP_MINIMUM, maximum: CAR_SETUP_MAXIMUM, low: "OPEN", high: "LOCKED", icon: Settings2 },
    { key: "cooling", label: "COOLING", minimum: CAR_SETUP_MINIMUM, maximum: CAR_SETUP_MAXIMUM, low: "TIGHT", high: "OPEN", icon: Fan },
  ];
  return (
    <section className={styles.setupCar} data-slot={slot} style={{ "--driver-tone": tone } as CSSProperties}>
      <header><span>#{driver.number}</span><div><strong>{driver.shortName}</strong><small>{driver.name}</small></div><b>{state.setupKnowledge}% DATA</b></header>
      <div className={styles.setupVisual}>
        <div className={styles.carFigure}>
          <Image alt={`${driver.name} setup car, top view`} height={640} priority src="/assets/telemetry/pitwall-car-top.png" width={420} />
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
                <span><Icon aria-hidden="true" size={18} /><i><b>{control.label}</b></i><strong>{setup[control.key] > 0 ? `+${setup[control.key]}` : setup[control.key]}</strong></span>
                <div className={styles.rangeControl} style={{ "--recommendation-start": `${recommendationStart}%`, "--recommendation-width": `${recommendationWidth}%` } as CSSProperties}>
                  <input
                    aria-label={`${driver.shortName} ${control.label}`}
                    max={control.maximum}
                    min={control.minimum}
                    onChange={(event) => onChange({ ...setup, [control.key]: Number(event.target.value) })}
                    step={1}
                    type="range"
                    value={setup[control.key]}
                  />
                  {recommendation ? <span className={styles.recommendationBand} title={`${recommendation.sourceSession} telemetry range ${recommendation.minimum} to ${recommendation.maximum}`} /> : null}
                  {/*
                   * Each end of the telemetry band labels itself, positioned at
                   * that edge of the band. Putting both numbers in one centred
                   * grid cell made them read as a single clump that could sit
                   * outside the band it describes.
                   */}
                  {recommendation ? (
                    <span className={styles.bandBounds} aria-hidden="true">
                      <b data-edge="start">{recommendation.minimum}</b>
                      <b data-edge="end">{recommendation.maximum}</b>
                    </span>
                  ) : null}
                </div>
                <small className={styles.rangeLegend}>
                  <i>{control.low}</i>
                  {recommendation
                    ? <em title={`${recommendation.sourceSession} telemetry range`}>{recommendation.sourceSession}</em>
                    : <em>BASELINE</em>}
                  <i>{control.high}</i>
                </small>
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

function DebriefDock({ state }: { state: WeekendState }) {
  const playerCarIds = playerCarIdsFor(state.playerTeamId);
  const latestReport = state.sessionReports.at(-1);
  return (
    <section className={styles.debriefDock} aria-label="Garage debrief">
      <header><Activity aria-hidden="true" size={18} /><div><b className="formula-title">DRIVER DEBRIEF</b><small>HOW THE CAR FELT OUT THERE</small></div><strong>{state.setupKnowledge}% CONFIDENCE</strong></header>
      <div className={styles.debriefGrid}>
        {playerCarIds.map((carId, slot) => {
          const driver = DRIVER_BY_ID.get(carId)!;
          const team = TEAM_BY_ID.get(driver.teamId)!;
          const report = latestReport?.cars.find((candidate) => candidate.carId === carId);
          const tone = `#${(slot === 0 ? team.primaryColor : team.accentColor).toString(16).padStart(6, "0")}`;
          /*
           * Only the driver speaks here. With two cards instead of four there is
           * room for the whole reaction, so the mood is not clipped away.
           */
          const driverMessage = report?.driverMessage
            ?? "Baseline ready. I will establish the first reference, then tell you exactly how the car feels.";
          return (
            <article className={styles.debriefCard} data-speaker="driver" key={`${carId}-driver`} style={{ "--speaker-tone": tone } as CSSProperties}>
              <header><CircleUserRound aria-hidden="true" size={26} /><div><span>DRIVER</span><strong>{driver.shortName}</strong><small>{driver.name}</small></div><Activity aria-hidden="true" className={styles.voiceWave} size={46} /></header>
              {/* Shown in full: trimming to two sentences dropped the driver's
                  sign-off, which is where most of the mood sits. */}
              <p>{driverMessage}</p>
            </article>
          );
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

/**
 * One driver's race-start band: identity, the set chosen, that compound's
 * allocation, and the three plans the chosen set produces.
 *
 * Sets are filtered by a compound tab. Showing all 16 at once wrapped three
 * rows deep and collided with the plan rows on a 720px-tall screen.
 */
function DriverStrategyRow({
  carId,
  doctrine,
  gridPosition,
  onStartingTyreChange,
  plans,
  totalLaps,
  selection,
  tyreInventory,
}: {
  carId: string;
  doctrine: string;
  gridPosition: number;
  onStartingTyreChange: (carId: string, selection: RaceStartTyreSelection) => void;
  plans: ReturnType<typeof buildRaceStrategyPlans>;
  totalLaps: number;
  selection: RaceStartTyreSelection;
  tyreInventory: WeekendState["tyreInventory"];
}) {
  const [requestedCompound, setRequestedCompound] = useState<TyreCompound | null>(null);
  const driver = DRIVER_BY_ID.get(carId)!;
  // The tab follows the chosen set until the user browses a different compound.
  const activeCompound = requestedCompound ?? selection.compound;
  const visibleSets = raceStartTyreSetsFor(carId, activeCompound, tyreInventory);

  return <article className={styles.driverStrategyRow} style={{ "--grid-team": `#${TEAM_BY_ID.get(driver.teamId)?.primaryColor.toString(16).padStart(6, "0") ?? "f4f7f8"}` } as CSSProperties}>
    <header className={styles.driverStrategyHead}>
      <span className={styles.driverStrategyIdentity}><b>P{gridPosition}</b><i /><div><strong>{driver.shortName}</strong><small>#{driver.number} · {doctrine.replaceAll("_", " ")}</small></div></span>
      <span className={styles.driverStrategyStart}><TyreBadge compound={selection.compound} size="medium" title={`${selection.compound} set ${selection.setNumber} selected`} /><span><b>SET {selection.setNumber.toString().padStart(2, "0")}</b><small>{selection.freshness} · {selection.condition}% · {selection.lapsUsed}L</small></span></span>
    </header>

    <div className={styles.startSetPicker}>
      <div className={styles.compoundTabs} aria-label={`${driver.shortName} compound`} role="group">
        {COMPOUNDS.map((compound) => {
          const sets = raceStartTyreSetsFor(carId, compound, tyreInventory);
          return <button
            aria-label={`${driver.shortName} show ${compound} sets, ${sets.length} available`}
            aria-pressed={activeCompound === compound}
            data-compound={compound}
            disabled={sets.length === 0}
            key={compound}
            onClick={() => setRequestedCompound(compound)}
            title={`${compound} · ${sets.length} set${sets.length === 1 ? "" : "s"}`}
            type="button"
          ><TyreBadge compound={compound} size="small" /><span>{sets.length}</span></button>;
        })}
      </div>

      {/* The selected compound's sets, each with its life after Q3. */}
      <div className={styles.startSetGrid} aria-label={`${driver.shortName} starting tyre set`} role="group">
        {visibleSets.map((set) => (
          <button
            aria-label={`${driver.shortName} start on ${activeCompound} set ${set.setNumber}, ${set.freshness}, ${set.condition} percent life, ${set.lapsUsed} laps used`}
            aria-pressed={selection.id === set.id}
            data-compound={activeCompound}
            data-freshness={set.freshness}
            data-set-id={set.id}
            data-start-set-choice="true"
            key={set.id}
            onClick={() => onStartingTyreChange(carId, { ...set })}
            title={`${activeCompound} set ${set.setNumber} · ${set.freshness} · ${set.condition}% life · ${set.lapsUsed} laps`}
            type="button"
          >
            <span><b>#{set.setNumber.toString().padStart(2, "0")}</b><strong>{set.condition}%</strong></span>
            <small>{set.lapsUsed === 0 ? "NEW" : `${set.lapsUsed}L USED`}</small>
          </button>
        ))}
      </div>
    </div>

    <div className={styles.preRacePlanRows} aria-label={`${driver.shortName} race strategy plans`} role="group">{plans.map((strategyPlan) => <article data-recommended={strategyPlan.recommended} key={strategyPlan.id}>
      <span className={styles.preRacePlanIdentity}><b>PLAN {strategyPlan.id}</b><small>{strategyPlan.name}</small></span>
      <span className={styles.preRacePlanTrack}>{strategyPlan.stints.map((stint) => {
        const width = ((stint.endLap - stint.startLap + 1) / totalLaps) * 100;
        return <span className={styles.preRacePlanStint} data-compound={stint.compound} key={`${stint.startLap}-${stint.compound}`} style={{ "--stint-width": `${width}%` } as CSSProperties}><b>{TYRE_SHORT[stint.compound]}</b><small>L{stint.startLap}–{stint.endLap}</small>{stint.pitAtEnd ? <i>BOX L{stint.endLap}</i> : null}</span>;
      })}</span>
      <span className={styles.preRacePlanOutcome}><b>{strategyPlan.stopCount} STOP{strategyPlan.stopCount === 1 ? "" : "S"}</b><small>{strategyPlan.recommended ? "RECOMMENDED" : `+${strategyPlan.projectedDeltaSeconds.toFixed(1)}s`} · {strategyPlan.risk} RISK</small></span>
    </article>)}</div>
  </article>;
}

function RacePreparation({ state, startingTyres, onStartingTyreChange }: Pick<WeekendHubProps, "state" | "startingTyres" | "onStartingTyreChange">) {
  const playerCarIds = playerCarIdsFor(state.playerTeamId);
  const circuit = circuitById(state.circuitId);
  const weather = createSpatialWeather(state.seed, 0, { trackLengthMeters: circuit.lengthMeters });
  const playerOverrides = Object.fromEntries(playerCarIds.map((carId) => [carId, startingTyres[carId]?.compound]));
  const plan = buildRaceStartingTyrePlan({
    seed: state.seed,
    gridOrder: state.gridOrder,
    tyreUsage: state.tyreUsage,
    weather,
    playerOverrides,
  });
  /*
   * Both drivers get their own strategy row. Previously a STRATEGY button
   * swapped one shared board between them, which hid the comparison that the
   * decision actually needs.
   */
  const driverStrategies = playerCarIds.map((carId) => {
    const selection = startingTyres[carId] ?? chooseRaceStartTyreSet(carId, plan[carId].compound, state.tyreInventory);
    const tyreSets: readonly TyreSetState[] = raceStartTyreInventory(carId, state.tyreInventory).map((set) => ({
      id: set.id,
      compound: set.compound,
      condition: set.condition,
      lapsUsed: set.lapsUsed,
      status: set.id === selection.id ? "FITTED" : set.freshness === "USED" ? "USED" : "AVAILABLE",
    }));
    return {
      carId,
      selection,
      // Plans are rebuilt from the chosen set, so its post-Q3 life and age feed
      // the stint lengths directly.
      plans: buildRaceStrategyPlans({
        currentLap: 1,
        totalLaps: circuit.totalLaps,
        tyreCompound: selection.compound,
        tyreLife: selection.condition,
        tyreAgeLaps: selection.lapsUsed,
        tyreSets,
        weather,
        raceControl: "GREEN",
      }),
    };
  });
  const gridRows = Array.from({ length: Math.ceil(state.gridOrder.length / 2) }, (_, index) => state.gridOrder.slice(index * 2, index * 2 + 2));
  const compoundCounts = COMPOUNDS.map((compound) => ({ compound, count: state.gridOrder.filter((carId) => plan[carId]?.compound === compound).length }));

  return (
    <div className={styles.racePreparation}>
      <section className={styles.gridPreview}>
        <header><Trophy aria-hidden="true" size={18} /><span><b className="formula-title">STARTING GRID</b><small>QUALIFYING CLASSIFICATION · AI START COMPOUNDS</small></span></header>
        <div className={styles.gridLanes}>{gridRows.map((row, rowIndex) => <div className={styles.gridPair} key={rowIndex}>{row.map((carId, laneIndex) => {
          const driver = DRIVER_BY_ID.get(carId);
          const team = driver ? TEAM_BY_ID.get(driver.teamId) : undefined;
          const decision = plan[carId];
          if (!driver || !team || !decision) return null;
          return <article data-player={playerCarIds.includes(carId)} data-side={laneIndex === 0 ? "left" : "right"} key={carId} style={{ "--grid-team": `#${team.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}>
            <b>P{rowIndex * 2 + laneIndex + 1}</b><i /><strong title={driver.name}>{driver.shortName}</strong><small>{team.shortName}</small><span><TyreBadge compound={decision.compound} size="small" title={`${decision.compound} starting tyre`} /></span>
          </article>;
        })}</div>)}</div>
        <footer className={styles.gridCompoundMix}><span>FIELD START PLAN</span>{compoundCounts.filter(({ count }) => count > 0).map(({ compound, count }) => <b data-compound={compound} key={compound}>{TYRE_SHORT[compound]} <em>{count}</em></b>)}</footer>
      </section>

      <section className={styles.raceStrategyWorkspace}>
        <header><Flag aria-hidden="true" size={18} /><span><b className="formula-title">RACE START TYRES &amp; STRATEGY</b><small>SELECT AN EXACT SET · POST-Q3 LIFE DRIVES PLAN A / B / C</small></span></header>

        {/*
         * Grid conditions at the moment the race starts. Rain can already be
         * falling when the lights go out, so the compound choice below has to be
         * made against the actual forecast rather than an assumed dry race.
         */}
        <div className={styles.startWeather} aria-label="Race start conditions" data-condition={weather.condition}>
          <span className={styles.startWeatherHeadline}>
            <b>{weather.condition.replaceAll("_", " ")}</b>
            <small>{weather.forecastRainInMinutes === null
              ? "NO RAIN ON RADAR"
              : weather.forecastRainInMinutes === 0 ? "RAIN FALLING NOW" : `RAIN IN ~${weather.forecastRainInMinutes} MIN`}</small>
          </span>
          <span className={styles.startWeatherReadings}>
            <span><small>TRACK</small><strong>{weather.trackTemperature.toFixed(0)}°C</strong></span>
            <span><small>AIR</small><strong>{weather.airTemperature.toFixed(0)}°C</strong></span>
            <span><small>WET</small><strong>{Math.round(weather.trackWetness * 100)}%</strong></span>
            <span><small>RAIN</small><strong>{Math.round(weather.rainIntensity * 100)}%</strong></span>
          </span>
          <span className={styles.startWeatherSectors} aria-label="Sector surface at the start">
            {(weather.sectors ?? []).map((sector) => (
              <span
                key={sector.sector}
                style={{ "--wetness": `${Math.max(4, sector.wetness * 100)}%` } as CSSProperties}
                title={`Sector ${sector.sector}: ${Math.round(sector.wetness * 100)}% wet`}
              ><b>S{sector.sector}</b><i aria-hidden="true" /><strong>{Math.round(sector.wetness * 100)}%</strong></span>
            ))}
          </span>
        </div>

        {driverStrategies.map(({ carId, selection, plans }) => (
          <DriverStrategyRow
            carId={carId}
            doctrine={plan[carId].doctrine}
            gridPosition={state.gridOrder.indexOf(carId) + 1}
            key={carId}
            onStartingTyreChange={onStartingTyreChange}
            plans={plans}
            totalLaps={circuit.totalLaps}
            selection={selection}
            tyreInventory={state.tyreInventory}
          />
        ))}
        <footer className={styles.strategyFootnote}><b>FIA DRY RACE RULE</b><span>Two different dry compounds are built into every full-race plan. Scrubbed qualifying sets stay selectable with the life they have left after Q3.</span></footer>
      </section>
    </div>
  );
}

function QualifyingReportClassification({ result }: { result: WeekendSessionResult }) {
  const cutPosition = result.entries.filter((entry) => !entry.eliminated).length;
  const midpoint = Math.ceil(result.entries.length / 2);
  const columns = [result.entries.slice(0, midpoint), result.entries.slice(midpoint)];
  const eliminated = result.entries.filter((entry) => entry.eliminated);
  return (
    <section className={styles.reportClassification} aria-label={`${result.session} final classification`}>
      <header><div><span>{result.session} CLASSIFICATION</span><strong>THE CUT</strong></div><p><b>P{cutPosition}</b><small>ADVANCE</small></p><p data-eliminated="true"><b>{eliminated.length}</b><small>ELIMINATED</small></p></header>
      <div className={styles.reportClassificationColumns}>{columns.map((column, columnIndex) => <div key={columnIndex}>{column.map((entry) => {
        const driver = DRIVER_BY_ID.get(entry.carId)!;
        const team = TEAM_BY_ID.get(driver.teamId)!;
        const resultStatus = result.session === "Q3" ? "GRID" : entry.eliminated ? "OUT" : "ADV";
        const rowClassName = [entry.eliminated ? styles.reportClassificationOut : "", entry.position === cutPosition + 1 ? styles.reportClassificationCut : ""].filter(Boolean).join(" ");
        return <div aria-label={`${driver.shortName}, position ${entry.position}, ${entry.timedLap === false ? "no valid time" : formatLapTime(entry.bestLapSeconds)}, ${resultStatus === "ADV" ? "advanced" : resultStatus === "OUT" ? "eliminated" : "classified for the grid"}`} className={rowClassName} data-cut-boundary={entry.position === cutPosition + 1} data-result-status={resultStatus} data-timed-lap={entry.timedLap !== false} key={entry.carId} style={{ "--team": `#${team.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}>
          <b>{entry.position.toString().padStart(2, "0")}</b><span><i /><strong>{driver.shortName}</strong><small>{team.shortName}</small></span><em data-compound={entry.compound} title={`${entry.compound} · ${entry.laps} recorded laps`}>{TYRE_SHORT[entry.compound]}</em><time>{entry.timedLap === false ? "NO TIME" : formatLapTime(entry.bestLapSeconds)}</time><small>{entry.position === 1 ? "POLE" : entry.timedLap === false ? "—" : `+${entry.gapSeconds.toFixed(3)}`}</small><mark>{resultStatus}</mark>
        </div>;
      })}</div>)}</div>
      {eliminated.length > 0 && <footer><span>ELIMINATED</span>{eliminated.map((entry) => <b key={entry.carId}>{DRIVER_BY_ID.get(entry.carId)?.shortName}</b>)}</footer>}
    </section>
  );
}

export function SessionReport({ report, onClose, classification = null, actionLabel = "ACKNOWLEDGE REPORT", onAction }: { report: WeekendSessionReport; onClose: () => void; classification?: WeekendSessionResult | null; actionLabel?: string; onAction?: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, report]);

  return (
    <div className={styles.reportBackdrop} role="presentation">
      <section aria-labelledby="session-report-title" aria-modal="true" className={styles.sessionReport} ref={dialogRef} role="dialog">
        <header>
          <div className={styles.sessionReportHeading}>
            <span><i><Check aria-hidden="true" size={13} /></i>SESSION COMPLETE<em>TEAM DEBRIEF</em></span>
            <h2 className="formula-title" id="session-report-title">{report.title}</h2>
            <p>{report.summary}</p>
          </div>
          <button className={styles.sessionReportClose} aria-label="Close session report" onClick={onClose} type="button"><X aria-hidden="true" size={21} /></button>
        </header>
        <div className={`${styles.reportBody} ${classification ? styles.reportBodyQualifying : ""}`}>
          {classification && <QualifyingReportClassification result={classification} />}
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
                {!classification && <div className={styles.conditionGrid}>{metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}%</strong><i><b style={{ width: `${value}%` }} /></i></span>)}</div>}
                <div className={styles.reportMessages}>
                  {/* Practice and qualifying both report the driver's own words only. */}
                  <article><Headphones aria-hidden="true" size={18} /><div><strong>DRIVER REPORT</strong><p>“{classification ? carReport.driverMessage : concise(carReport.driverMessage, 260)}”</p></div></article>
                </div>
              </article>
            );
          })}
          </div>
        </div>
        <footer><button onClick={onAction ?? onClose} type="button">{actionLabel} <ChevronRight aria-hidden="true" size={18} /></button></footer>
      </section>
    </div>
  );
}

export function WeekendHub({ state, startingTyres, onRunSession, onSetupChange, onStartingTyreChange, onStartRace, activeReport, onCloseReport }: WeekendHubProps) {
  const circuit = circuitById(state.circuitId);
  const rule = currentWeekendRule(state);
  const playerCarIds = playerCarIdsFor(state.playerTeamId);
  const playerTeam = TEAM_BY_ID.get(state.playerTeamId);
  const isRace = state.currentSession === "RACE";
  const sessionResult = latestWeekendResult(state);
  const sessionTitle = isRace ? "RACE PREPARATION" : rule.group === "PRACTICE" ? "FREE PRACTICE" : "QUALIFYING";
  const teamTone = playerTeam ? `#${playerTeam.primaryColor.toString(16).padStart(6, "0")}` : "#7b858f";

  return (
    <div className={styles.backdrop} data-weekend-session={state.currentSession}>
      <main className={`${styles.hub} ${isRace ? styles.hubRace : ""}`} style={{ "--team-tone": teamTone } as CSSProperties}>
        <header className={styles.header}>
          <div className={styles.sessionMasthead}>
            <span>{circuit.country.toUpperCase()} · {circuit.shortName} · {(circuit.lengthMeters / 1_000).toFixed(3)} KM</span>
            <div><strong>{state.currentSession}</strong><i><b>{sessionTitle}</b><small>{playerTeam?.name.toUpperCase()} · SESSION COMMAND</small></i></div>
          </div>
          <SessionRail state={state} />
        </header>

        <section className={`${styles.workspace} ${isRace ? styles.raceWorkspace : ""} ${!isRace && !sessionResult ? styles.workspaceSolo : ""}`}>
          {isRace ? (
            <section className={styles.timingPanel}>
              <header><div><Flag aria-hidden="true" size={19} /><span><b className="formula-title">RACE PREPARATION</b><small>FINAL GRID · START TYRE CONFIRMATION</small></span></div></header>
              <RacePreparation onStartingTyreChange={onStartingTyreChange} startingTyres={startingTyres} state={state} />
            </section>
          ) : (
            <>
              <section className={styles.garageCanvas}>
                <header><Settings2 aria-hidden="true" size={19} /><div><b className="formula-title">GARAGE TELEMETRY</b><small>{circuit.shortName} SETUP LAB · TWO-CAR COMPARISON</small></div><span>−50 · NEUTRAL 0 · +50 · STEP 1</span></header>
                <div className={styles.setupCars}>{playerCarIds.map((carId, index) => <SetupControl carId={carId} key={carId} onChange={(setup) => onSetupChange(carId, setup)} setup={state.setups[carId]} slot={index} state={state} />)}</div>
              </section>

              {sessionResult && <section className={styles.timingPanel}>
                <header><div>{sessionResult ? <Timer aria-hidden="true" size={19} /> : <Activity aria-hidden="true" size={19} />}<span><b className="formula-title">{sessionResult ? `${sessionResult.session} CLASSIFICATION` : "SESSION PLAN"}</b><small>{sessionResult ? `${sessionResult.entries.length} CLASSIFIED · BEST LAP ORDER` : `${state.currentSession} RUN PROGRAMME · READY`}</small></span></div>{sessionResult?.entries.some((entry) => entry.eliminated) && <em>ELIMINATION ZONE</em>}</header>
                <Classification state={state} />
              </section>}
            </>
          )}
        </section>

        <section className={`${styles.debriefArea} ${isRace ? styles.raceDebriefArea : ""}`}>
          {!isRace && <DebriefDock state={state} />}
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
