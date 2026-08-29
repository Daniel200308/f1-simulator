"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDownToLine,
  Clock3,
  Flag,
  HardDrive,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipForward,
  Snowflake,
  Target,
  Thermometer,
  TimerReset,
  Trophy,
  X,
  Zap,
} from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import { QualifyingTrafficOverview } from "@/components/race/qualifying-traffic-overview";
import { RaceMap } from "@/components/race/race-map";
import { TyreBadge } from "@/components/race/tyre-badge";
import { SessionReport } from "@/components/race/weekend-hub";
import { DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import type { TyreCompound } from "@/domain/race";
import type { SectorTimingTone } from "@/simulation/sector-timing";
import { circuitById, SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { raceStartTyreInventory } from "@/simulation/tyre-allocation";
import {
  liveQualifyingClassification,
  qualifyingCutPosition,
  qualifyingDisplayStatus,
  qualifyingReleaseForecast,
  type QualifyingAttackMode,
  type QualifyingOutLapMode,
  type QualifyingSimulationSpeed,
  type QualifyingCarState,
  type WeekendSessionReport,
  type WeekendState,
} from "@/simulation/weekend";

import styles from "./qualifying-race-view.module.css";

const OUT_LAP_MODES: readonly { mode: QualifyingOutLapMode; label: string; compact: string; hint: string }[] = [
  { mode: "SLOW", label: "Gentle", compact: "GENTLE", hint: "Protect the tyre, with a cold-tyre risk" },
  { mode: "BALANCED", label: "Balanced", compact: "BALANCE", hint: "Target the normal tyre preparation window" },
  { mode: "FAST", label: "Aggressive Warm-up", compact: "WARM-UP", hint: "Heat the tyre quickly at higher overheating and traffic risk" },
];
const ATTACK_MODES: readonly { mode: QualifyingAttackMode; label: string; compact: string; hint: string }[] = [
  { mode: "SAFE", label: "Safe", compact: "SAFE", hint: "Leave margin for traffic and track limits" },
  { mode: "NORMAL", label: "Push", compact: "PUSH", hint: "Commit to the reference qualifying lap" },
  { mode: "ATTACK", label: "Attack", compact: "ATK", hint: "Trade consistency for lap time" },
  { mode: "MAXIMUM", label: "Maximum", compact: "MAX", hint: "Maximum pace with the highest lock-up and deletion risk" },
];
const QUALIFYING_SPEEDS: readonly QualifyingSimulationSpeed[] = [1, 2, 4, 8, 16];
const QUALIFYING_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const TYRE_SHORT: Readonly<Record<TyreCompound, string>> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };
/* "INTERMEDIATE" does not fit a five-across control, so the selector uses the
   broadcast-standard abbreviation for that compound only. */
const TYRE_NAME: Readonly<Record<TyreCompound, string>> = { SOFT: "SOFT", MEDIUM: "MEDIUM", HARD: "HARD", INTERMEDIATE: "INTER", WET: "WET" };

interface QualifyingRaceViewProps {
  state: WeekendState;
  selectedCarId: string;
  activeReport: WeekendSessionReport | null;
  onCloseReport: () => void;
  onSelectCar: (carId: string) => void;
  onStart: () => void;
  onRelease: (carId: string) => void;
  onAbortLap: (carId: string) => void;
  onCoolDown: (carId: string) => void;
  onReturnToPits: (carId: string) => void;
  onOutLapModeChange: (carId: string, mode: QualifyingOutLapMode) => void;
  onAttackModeChange: (carId: string, mode: QualifyingAttackMode) => void;
  onTyreSetChange: (carId: string, tyreSetId: string) => void;
  onSpeedChange: (speed: QualifyingSimulationSpeed) => void;
  onPause: () => void;
  onSkipSession: () => void;
  onReset: () => void;
  onOpenSave: () => void;
  onOpenChampionship: () => void;
  onOpenPreferences: () => void;
  saveReady: boolean;
  pendingGridPenaltyPlaces: number;
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0");
  const remainder = Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function teamTone(carId: string): string {
  const driver = DRIVER_BY_ID.get(carId);
  const team = driver ? TEAM_BY_ID.get(driver.teamId) : null;
  return `#${(team?.primaryColor ?? 0xf4f7f8).toString(16).padStart(6, "0")}`;
}

function QualifyingSystemTools({ onReset, onOpenSave, onOpenChampionship, onOpenPreferences, saveReady, pendingGridPenaltyPlaces }: Pick<QualifyingRaceViewProps, "onReset" | "onOpenSave" | "onOpenChampionship" | "onOpenPreferences" | "saveReady" | "pendingGridPenaltyPlaces">) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const runAction = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className={styles.utilityStack} ref={rootRef}>
      <button aria-label="Return to team selection" className={`reset-button reset-button--icon ${styles.utilityReset}`} onClick={onReset} title="Reset race weekend" type="button"><RotateCcw aria-hidden="true" size={16} /></button>
      <button aria-controls="qualifying-system-tools" aria-expanded={open} aria-label={open ? "Close system tools" : "Open system tools"} className={styles.utilityToggle} onClick={() => setOpen((current) => !current)} title={open ? "Close save, season and settings" : "Open save, season and settings"} type="button">
        {open ? <X aria-hidden="true" size={16} /> : <Menu aria-hidden="true" size={16} />}
        <span>TOOLS</span>
      </button>
      {open && <div aria-label="System tools" className={styles.utilityPanel} id="qualifying-system-tools" role="group">
        <button disabled={!saveReady} onClick={() => runAction(onOpenSave)} title="Save and restore" type="button"><HardDrive aria-hidden="true" size={17} /><span>SAVE<small>LOCAL STATE</small></span></button>
        <button onClick={() => runAction(onOpenChampionship)} title={`Season${pendingGridPenaltyPlaces > 0 ? ` · ${pendingGridPenaltyPlaces}-PLACE GRID DROP` : ""}`} type="button"><Trophy aria-hidden="true" size={17} /><span>SEASON<small>{pendingGridPenaltyPlaces > 0 ? `${pendingGridPenaltyPlaces} GRID DROP` : "CHAMPIONSHIP"}</small></span>{pendingGridPenaltyPlaces > 0 && <b>{pendingGridPenaltyPlaces}</b>}</button>
        <button onClick={() => runAction(onOpenPreferences)} title="Display and audio settings" type="button"><Settings2 aria-hidden="true" size={17} /><span>SETTINGS<small>DISPLAY + AUDIO</small></span></button>
      </div>}
    </div>
  );
}

function QualifyingTopbar({ state, onStart, onSpeedChange, onPause, onReset, onSkipSession, onOpenSave, onOpenChampionship, onOpenPreferences, saveReady, pendingGridPenaltyPlaces }: Pick<QualifyingRaceViewProps, "state" | "onStart" | "onSpeedChange" | "onPause" | "onReset" | "onSkipSession" | "onOpenSave" | "onOpenChampionship" | "onOpenPreferences" | "saveReady" | "pendingGridPenaltyPlaces">) {
  const live = state.qualifyingLive!;
  const circuit = circuitById(state.circuitId);
  const cut = qualifyingCutPosition(state);
  const carsOnTrack = Object.values(live.cars).filter((car) => car.phase !== "GARAGE").length;
  const chequered = live.status === "CHECKERED";
  const flagLabel = live.status === "READY" ? "PIT OPEN" : chequered ? "CHEQUERED" : "GREEN";
  const controlHeadline = chequered ? "CHEQUERED FLAG" : cut ? `ELIMINATION LINE · P${cut}` : "POLE POSITION SHOOTOUT";
  const controlDetail = chequered
    ? "FLYING LAPS ALREADY STARTED MAY BE COMPLETED"
    : live.status === "READY"
      ? `${live.session} ready · pit exit open`
      : `${carsOnTrack} cars circulating · pit exit open`;
  return (
    <header className={`topbar topbar--telemetry ${styles.topbar}`} aria-label={`${live.session} qualifying header`}>
      <div className="brand-block brand-block--signal"><div className="brand-copy"><strong>PROJECT PITWALL</strong><small>{circuit.shortName} QUALIFYING</small></div></div>
      <div className={`broadcast-strip broadcast-strip--iconic ${styles.broadcast}`}>
        <section aria-label={`${live.session} qualifying session`} className={`broadcast-session session-copy-panel ${styles.sessionOnly}`}><div className="hud-stat-copy"><strong>{live.session}</strong></div></section>
        <section
          aria-label={chequered ? "Chequered flag" : flagLabel}
          aria-live="polite"
          className={`broadcast-status track-flag-panel condition--${chequered ? "chequered" : "green"} status--${chequered ? "chequered" : "green"} ${chequered ? "is-chequered" : ""}`}
        >
          <div className="hud-stat-copy"><strong>{flagLabel}</strong><small>{chequered ? "FLYING LAPS COMPLETE" : `${carsOnTrack} CARS ON TRACK`}</small></div>
        </section>
        <section className={styles.timerPanel} aria-label={`${formatClock(live.remainingSeconds)} remaining`}><Clock3 aria-hidden="true" size={27} /><span><small>SESSION TIME</small><strong>{formatClock(live.remainingSeconds)}</strong></span><i><b style={{ width: `${(live.remainingSeconds / live.durationSeconds) * 100}%` }} /></i></section>
        <section aria-live="polite" className={`broadcast-control-message flag--${chequered ? "chequered" : "green"} ${styles.controlMessage}`}><div className="control-message-meta"><span>FIA QUALIFYING CONTROL</span></div><strong className="control-message-title" title={controlHeadline}>{controlHeadline}</strong><p className="control-message-detail" title={controlDetail}>{controlDetail}</p></section>
      </div>
      <nav className={`transport transport--iconic ${styles.transport}`} aria-label="Qualifying playback controls">
        {live.status === "READY"
          ? <button className={styles.startButton} onClick={onStart} type="button"><Play aria-hidden="true" fill="currentColor" size={18} />START {live.session}</button>
          : <button aria-label={live.paused ? "Resume qualifying" : "Pause qualifying"} aria-pressed={live.paused} className={styles.pauseButton} onClick={onPause} title={live.paused ? "Resume qualifying" : "Pause qualifying"} type="button">{live.paused ? <Play aria-hidden="true" fill="currentColor" size={15} /> : <Pause aria-hidden="true" fill="currentColor" size={15} />}</button>}
        <div className="speed-selector" role="group" aria-label="Simulation speed"><span className="speed-selector-label"><Zap size={13} aria-hidden="true" /> SIM RATE</span><div className="speed-buttons speed-rail"><i className="speed-rail-line" aria-hidden="true" />{QUALIFYING_SPEEDS.map((speed) => <button aria-label={`Set simulation speed to ${speed} times`} aria-pressed={live.speed === speed} className={`speed-step ${live.speed === speed ? "is-active" : ""}`} key={speed} onClick={() => onSpeedChange(speed)} type="button"><i className="speed-pip" aria-hidden="true" /><span>{speed}×</span></button>)}</div></div>
        <button className={styles.skipButton} onClick={onSkipSession} title={`Simulate the remainder of ${live.session}`} type="button"><SkipForward aria-hidden="true" size={15} />SKIP {live.session}</button>
        <QualifyingSystemTools onOpenChampionship={onOpenChampionship} onOpenPreferences={onOpenPreferences} onOpenSave={onOpenSave} onReset={onReset} pendingGridPenaltyPlaces={pendingGridPenaltyPlaces} saveReady={saveReady} />
      </nav>
    </header>
  );
}

function broadcastLapStatus(car: QualifyingCarState): string {
  const status = qualifyingDisplayStatus(car);
  if (status === "OUT LAP") return "OUTLAP";
  if (status === "IN LAP") return "INLAP";
  if (status === "TRAFFIC") return "FLYING LAP";
  return status;
}

function toneLabel(tone: SectorTimingTone): string {
  if (tone === "PURPLE") return "session best";
  if (tone === "GREEN") return "personal best";
  if (tone === "YELLOW") return "slower";
  if (tone === "INVALID") return "invalid";
  return "not set";
}

function TowerSectorTimes({ car }: { car: QualifyingCarState }) {
  return <span className={styles.towerSectorTimes} aria-label="Sector 1, Sector 2 and Sector 3 timing">
    {[0, 1, 2].map((sectorIndex) => {
      const currentTime = car.timing.currentSectorTimes[sectorIndex];
      const personalBest = car.timing.personalBestSectorTimes[sectorIndex];
      const time = currentTime ?? personalBest;
      const sectorTone = currentTime === null && personalBest !== null ? "BEST" : car.timing.currentSectorTones[sectorIndex];
      return <span
        className={styles.towerSectorCell}
        data-sector-cell="true"
        data-sector-index={sectorIndex + 1}
        data-tone={sectorTone}
        key={sectorIndex}
        title={`Sector ${sectorIndex + 1}: ${time === null ? "no time" : `${time.toFixed(3)} seconds${currentTime === null ? ", personal best" : `, ${toneLabel(car.timing.currentSectorTones[sectorIndex])}`}`}`}
      >
        <small>S{sectorIndex + 1}</small>
        <strong>{time === null ? "—.---" : time.toFixed(3)}</strong>
      </span>;
    })}
  </span>;
}

function QualifyingTower({ state, playerCars, onSelectCar }: { state: WeekendState; playerCars: readonly string[]; onSelectCar: (carId: string) => void }) {
  const live = state.qualifyingLive!;
  const entries = liveQualifyingClassification(state);
  const cut = qualifyingCutPosition(state);
  return <aside className={styles.tower} aria-label="Qualifying leaderboard">
    <div aria-label="Qualifying leaderboard columns" className={styles.towerHead}><span aria-hidden="true" /><span>Driver</span><span><abbr title="Tyre compound">Tyre</abbr></span><span>Gap</span><span>Best</span></div>
    <div className={styles.towerRows}>
      {entries.map((entry) => {
        const driver = DRIVER_BY_ID.get(entry.carId)!;
        const car = live.cars[entry.carId];
        const player = playerCars.includes(entry.carId);
        const status = broadcastLapStatus(car);
        const noTime = entry.bestLapSeconds === null;
        const eliminationLocked = live.status === "CHECKERED" && entry.eliminated;
        return <div
          aria-label={`${driver.name} qualifying position ${entry.position}`}
          className={styles.towerRow}
          data-car-id={entry.carId}
          data-driver-code={driver.shortName}
          data-cut-line={entry.position === cut}
          data-eliminated={eliminationLocked}
          data-player={player}
          key={entry.carId}
          onClick={() => player && onSelectCar(entry.carId)}
          onKeyDown={(event) => { if (player && (event.key === "Enter" || event.key === " ")) onSelectCar(entry.carId); }}
          role={player ? "button" : undefined}
          style={{ "--team-tone": teamTone(entry.carId) } as CSSProperties}
          tabIndex={player ? 0 : undefined}
        >
          <b className={styles.position}>{entry.position}</b>
          <span className={styles.driverCell}><i /><strong title={driver.name}>{driver.shortName}</strong></span>
          <span className={styles.towerTyre}><TyreBadge compound={car.selectedCompound} size="small" title={`${car.selectedCompound} tyre`} /></span>
          <span className={styles.intervalCell}><strong>{noTime ? "—" : entry.position === 1 ? "—" : `+${entry.gapSeconds?.toFixed(3)}`}</strong><small>{status}</small></span>
          <span className={styles.lapTimeCell}><strong data-tone={car.timing.currentSectorTones.find((tone) => tone === "PURPLE" || tone === "GREEN") ?? "NEUTRAL"}>{entry.bestLapSeconds === null ? "—:—.---" : formatLapTime(entry.bestLapSeconds)}</strong><small>{car.lastLapSeconds === null ? "NO LAP" : formatLapTime(car.lastLapSeconds)}</small></span>
          <TowerSectorTimes car={car} />
          {entry.position === cut && <span className={styles.cutLineLabel}>TOP {cut} ADVANCE</span>}
        </div>;
      })}
    </div>
  </aside>;
}

function towerRenderKey(state: WeekendState): string {
  const live = state.qualifyingLive;
  if (!live) return "OFF";
  return `${live.session}:${live.status}:${liveQualifyingClassification(state).map((entry) => {
    const car = live.cars[entry.carId];
    return [entry.carId, entry.position, entry.gapSeconds, entry.bestLapSeconds, entry.eliminated, car.phase, car.trafficLevel, car.selectedCompound, car.lastLapSeconds, ...car.timing.currentSectorTimes, ...car.timing.personalBestSectorTimes, ...car.timing.currentSectorTones].join(":");
  }).join("|")}`;
}

const MemoQualifyingTower = memo(QualifyingTower, (previous, next) => (
  previous.onSelectCar === next.onSelectCar
  && previous.playerCars.join("|") === next.playerCars.join("|")
  && towerRenderKey(previous.state) === towerRenderKey(next.state)
));

function tyreTemperatureTone(temperature: number): "COLD" | "WINDOW" | "HOT" {
  if (temperature < 86) return "COLD";
  if (temperature > 105) return "HOT";
  return "WINDOW";
}

function tyreTemperatureLabel(temperature: number): "COLD" | "OPTIMAL" | "HOT" {
  const tone = tyreTemperatureTone(temperature);
  return tone === "WINDOW" ? "OPTIMAL" : tone;
}

function tyreLifeTone(condition: number): "NOMINAL" | "CAUTION" | "CRITICAL" {
  if (condition < 30) return "CRITICAL";
  if (condition < 55) return "CAUTION";
  return "NOMINAL";
}

function TyreTelemetry({ car }: { car: QualifyingCarState }) {
  const tyres = [
    ["FL", "Front Left", car.tyreTemperatures.frontLeft],
    ["FR", "Front Right", car.tyreTemperatures.frontRight],
    ["RL", "Rear Left", car.tyreTemperatures.rearLeft],
    ["RR", "Rear Right", car.tyreTemperatures.rearRight],
  ] as const;
  return <section className={styles.tyreTelemetry} aria-label="Live tyre temperatures">
    <header><Thermometer aria-hidden="true" size={12} /><span>TYRE TEMPERATURES</span></header>
    <div>
      {tyres.map(([label, name, temperature]) => {
        const tone = tyreTemperatureTone(temperature);
        const stateLabel = tyreTemperatureLabel(temperature);
        const temperatureProgress = `${Math.round(Math.max(0, Math.min(1, (temperature - 60) / 60)) * 100)}%`;
        return <span
          aria-label={`${name} tyre, ${temperature.toFixed(0)} degrees Celsius, ${stateLabel.toLowerCase()}`}
          aria-valuemax={120}
          aria-valuemin={60}
          aria-valuenow={Math.round(temperature)}
          data-temperature={tone}
          data-tyre-position={label}
          key={label}
          role="meter"
          style={{ "--temperature-progress": temperatureProgress } as CSSProperties}
          title={`${label} — ${name}: ${temperature.toFixed(0)} degrees Celsius · ${stateLabel}`}
        >
          <b><abbr title={name}>{label}</abbr></b>
          <strong>{temperature.toFixed(0)}<small>°C</small></strong>
        </span>;
      })}
    </div>
  </section>;
}

function ControlSection({ children, title, value, control, priority = false }: { children: ReactNode; title: string; value: string; control: string; priority?: boolean }) {
  return <section className={styles.controlSection} data-control={control} data-priority={priority}><header><span className="formula-title">{title}</span><b title={value}>{value}</b></header>{children}</section>;
}

function QualifyingCommandDock({
  state,
  selectedCarId,
  playerCars,
  onSelectCar,
  onRelease,
  onAbortLap,
  onCoolDown,
  onReturnToPits,
  onOutLapModeChange,
  onAttackModeChange,
  onTyreSetChange,
}: Pick<QualifyingRaceViewProps, "state" | "selectedCarId" | "onSelectCar" | "onRelease" | "onAbortLap" | "onCoolDown" | "onReturnToPits" | "onOutLapModeChange" | "onAttackModeChange" | "onTyreSetChange"> & { playerCars: readonly string[] }) {
  const live = state.qualifyingLive!;
  const carId = live.cars[selectedCarId] ? selectedCarId : playerCars.find((candidate) => live.cars[candidate]);
  if (!carId) return <aside className={`${styles.controlRail} ${styles.eliminatedRail}`} aria-label="Team qualifying status" data-team-eliminated="true">
    <nav className={styles.driverTabs} aria-label="Player driver qualification status">
      {playerCars.map((candidateId) => {
        const candidate = DRIVER_BY_ID.get(candidateId)!;
        const eliminatedIn = state.qualifying.find((record) => record.carId === candidateId)?.eliminatedIn;
        return <button aria-label={`${candidate.name} eliminated in ${eliminatedIn ?? "qualifying"}`} disabled key={candidateId} type="button"><i style={{ background: teamTone(candidateId) }} /><span><strong>{candidate.shortName}</strong><small>{eliminatedIn ? `ELIMINATED · ${eliminatedIn}` : "NOT QUALIFIED"}</small></span></button>;
      })}
    </nav>
    <section className={styles.eliminatedMessage}><Flag aria-hidden="true" size={30} /><small>TEAM QUALIFYING STATUS</small><strong>NO ACTIVE CARS</strong><p>Both drivers are classified as eliminated and cannot be released in {live.session}.</p></section>
  </aside>;
  const car = live.cars[carId];
  const driver = DRIVER_BY_ID.get(carId)!;
  const entry = liveQualifyingClassification(state).find((candidate) => candidate.carId === carId);
  const forecast = qualifyingReleaseForecast(state, carId);
  const status = broadcastLapStatus(car);
  const selectedTyreSet = car.selectedTyreSetId ? state.tyreInventory[carId]?.find((set) => set.id === car.selectedTyreSetId) : null;
  const selectedTyreOption = selectedTyreSet ? raceStartTyreInventory(carId, state.tyreInventory).find((set) => set.id === selectedTyreSet.id) : null;
  const hasValidTyreSet = Boolean(selectedTyreSet && (selectedTyreSet.status === "NEW" || selectedTyreSet.status === "USED"));
  const displayedTyreSets = (compound: TyreCompound) => raceStartTyreInventory(carId, state.tyreInventory)
    .filter((set) => set.compound === compound && (set.status === "NEW" || set.status === "USED" || set.id === car.selectedTyreSetId));
  const compactTyreOptions = QUALIFYING_COMPOUNDS.map((compound) => {
    const sets = displayedTyreSets(compound);
    const selectedIndex = sets.findIndex((set) => set.id === car.selectedTyreSetId);
    const selectedSet = selectedIndex >= 0 ? sets[selectedIndex] : null;
    const suggestedSet = selectedSet ?? [...sets].sort((left, right) => (
      right.condition - left.condition
      || (left.freshness === right.freshness ? 0 : left.freshness === "NEW" ? -1 : 1)
      || left.setNumber - right.setNumber
    ))[0] ?? null;
    const nextSet = selectedIndex >= 0 && sets.length > 1 ? sets[(selectedIndex + 1) % sets.length] : suggestedSet;
    return { compound, sets, selectedSet, suggestedSet, nextSet };
  });
  const visibleTyreSets = displayedTyreSets(car.selectedCompound);
  const remainingTyreLife = selectedTyreOption?.condition ?? (selectedTyreSet ? Math.round(100 - selectedTyreSet.wearPercent) : null);
  // A player may make a late-session gamble. Crossing the timing line after
  // the chequered flag still invalidates the attempt in the simulation, but
  // the pit-wall control remains available until the clock reaches zero.
  const canRelease = car.phase === "GARAGE" && live.status === "RUNNING" && hasValidTyreSet;
  const releaseRisk = !forecast?.canFinishBeforeChequered ? "TIME" : !forecast.mergeSafe ? "TRAFFIC" : "CLEAR";
  const speedProgress = `${Math.round(Math.max(0, Math.min(1, car.currentSpeedKph / 340)) * 300)}deg`;
  const releaseStatus = canRelease
    ? releaseRisk === "TIME" ? "FINAL SHOT" : releaseRisk === "TRAFFIC" ? "BUSY" : `${forecast?.expectedGapSeconds.toFixed(1)}s`
    : !hasValidTyreSet && car.phase === "GARAGE"
      ? "TYRE"
      : car.phase === "GARAGE" && forecast && !forecast.mergeSafe
        ? "BLOCKED"
        : car.phase === "GARAGE" ? "GARAGE" : "TRACK";
  const releaseHint = canRelease
    ? releaseRisk === "TIME" ? "LINE AT RISK" : releaseRisk === "TRAFFIC" ? "TRAFFIC AHEAD" : "WINDOW CLEAR"
    : !hasValidTyreSet && car.phase === "GARAGE"
      ? "SELECT TYRE"
      : car.phase === "GARAGE" && forecast && !forecast.mergeSafe
        ? "FLYING CAR"
        : car.phase === "GARAGE" ? "AWAIT SESSION" : "CAR RELEASED";
  return <aside className={styles.controlRail} aria-label="Qualifying driver control" data-car-id={carId} data-lap-status={status} data-selected-tyre-set={car.selectedTyreSetId ?? ""} style={{ "--team-color": teamTone(carId) } as CSSProperties}>
    <nav className={styles.driverTabs} aria-label="Player driver selection">
      {playerCars.map((candidateId) => {
        const candidate = DRIVER_BY_ID.get(candidateId)!;
        const candidateCar = live.cars[candidateId];
        const eliminatedIn = state.qualifying.find((record) => record.carId === candidateId)?.eliminatedIn;
        return <button aria-label={candidateCar ? `Control ${candidate.name}, car ${candidate.number}` : `${candidate.name} eliminated in ${eliminatedIn ?? "qualifying"}`} aria-pressed={candidateId === carId} disabled={!candidateCar} key={candidateId} onClick={() => candidateCar && onSelectCar(candidateId)} type="button"><i style={{ background: teamTone(candidateId) }} /><span><strong>{candidate.shortName}</strong><small>{candidateCar ? broadcastLapStatus(candidateCar) : eliminatedIn ? `ELIMINATED · ${eliminatedIn}` : "NOT QUALIFIED"}</small></span></button>;
      })}
    </nav>

    <section className={styles.driverTelemetry}>
      <span className={styles.driverIdentity}><b>{entry ? `P${entry.position}` : "NC"}</b><span><strong>{driver.shortName}</strong><small>#{driver.number} · {driver.name}</small></span></span>
      <span className={styles.phaseBeacon} data-phase={car.phase}><i />{status}</span>
      <div className={styles.liveDials}>
        <section
          aria-label={`Live speed ${Math.round(car.currentSpeedKph)} kilometres per hour`}
          aria-valuemax={340}
          aria-valuemin={0}
          aria-valuenow={Math.round(car.currentSpeedKph)}
          className={styles.speedInstrument}
          data-speed-gauge="true"
          role="meter"
          style={{ "--speed-progress": speedProgress } as CSSProperties}
        >
          <span className={styles.speedRing}>
            <strong>{Math.round(car.currentSpeedKph)}</strong>
            <small>KM/H</small>
          </span>
          <span className={styles.trafficReadout}><TimerReset aria-hidden="true" size={11} /><small>TRAFFIC</small><strong className={styles[`traffic${car.trafficLevel}`]}>{car.trafficLevel}</strong><em>{forecast ? `${forecast.expectedGapSeconds.toFixed(1)}s` : "—"}</em></span>
        </section>
        <TyreTelemetry car={car} />
      </div>
      {car.trafficDecisionMessage && <p className={styles.trafficDecision} data-decision={car.trafficDecisionState}><b>{car.trafficDecisionState}</b><span>{car.trafficDecisionMessage}</span></p>}
    </section>

    <div className={styles.controlStack}>
      <div className={styles.controlCore}>
        <ControlSection control="release" priority={car.phase === "GARAGE"} title="PIT RELEASE" value={releaseStatus}><div aria-label={`${driver.shortName} pit release controls`} className={`${styles.orbOptions} ${styles.releaseOptions}`} role="group">
          <button aria-label={`${driver.shortName} Release Now`} data-ready={canRelease} data-risk={releaseRisk} disabled={!canRelease} onClick={() => onRelease(carId)} title="Release the car into the current track window" type="button"><i><Play aria-hidden="true" fill="currentColor" size={17} /></i><span><strong>RELEASE</strong><small>{releaseHint}</small></span></button>
        </div></ControlSection>
        <ControlSection control="out-lap" priority={car.phase === "OUT_LAP"} title="OUT LAP PACE" value={car.outLapMode}><div className={styles.segmentOptions}>{OUT_LAP_MODES.map((option) => <button aria-label={`${driver.shortName} set out lap pace ${option.label}`} aria-pressed={car.outLapMode === option.mode} disabled={car.phase === "PUSH_LAP"} key={option.mode} onClick={() => onOutLapModeChange(carId, option.mode)} title={option.hint} type="button"><span>{option.compact}</span></button>)}</div></ControlSection>
        <ControlSection control="attack" priority={car.phase === "PUSH_LAP"} title="FLYING ATTACK" value={car.attackMode}><div className={styles.segmentOptions}>{ATTACK_MODES.map((option) => <button aria-label={`${driver.shortName} set flying lap attack ${option.label}`} aria-pressed={car.attackMode === option.mode} disabled={car.phase === "PUSH_LAP"} key={option.mode} onClick={() => onAttackModeChange(carId, option.mode)} title={option.hint} type="button"><span>{option.compact}</span></button>)}</div></ControlSection>
        <ControlSection control="lap-action" priority={car.phase !== "GARAGE"} title="LAP ACTION" value={status}><div aria-label={`${driver.shortName} lap actions`} className={styles.orbOptions} role="group">
          <button aria-label={`${driver.shortName} Abort Lap`} disabled={car.phase !== "PUSH_LAP"} onClick={() => onAbortLap(carId)} title="Abort this flying lap" type="button"><i><Target aria-hidden="true" size={16} /></i><span>Abort</span></button>
          <button aria-label={`${driver.shortName} In Lap`} disabled={car.phase !== "PUSH_LAP" && car.phase !== "OUT_LAP"} onClick={() => onCoolDown(carId)} title="Give up this attempt and recover on an in lap" type="button"><i><Snowflake aria-hidden="true" size={16} /></i><span>In Lap</span></button>
          <button aria-label={`${driver.shortName} Return to Pits`} disabled={car.phase !== "OUT_LAP" && car.phase !== "IN_LAP"} onClick={() => onReturnToPits(carId)} title="Return to the garage" type="button"><i><ArrowDownToLine aria-hidden="true" size={16} /></i><span>Return</span></button>
        </div></ControlSection>
      </div>
      <ControlSection control="tyres" priority={car.phase === "GARAGE"} title="TYRE SELECTION" value={selectedTyreSet && selectedTyreOption && remainingTyreLife !== null ? `${TYRE_SHORT[selectedTyreSet.compound]} · ${selectedTyreOption.freshness} · ${remainingTyreLife}%` : "SET REQUIRED"}>
        <div className={styles.tyreSelectorConsole}>
          <div aria-label={`${driver.shortName} combined tyre selection`} className={styles.combinedTyreSelector} role="group">
            {compactTyreOptions.map(({ compound, sets, selectedSet, suggestedSet, nextSet }) => {
              const displayedSet = selectedSet ?? suggestedSet;
              const selected = Boolean(selectedSet);
              const available = Boolean(displayedSet && nextSet);
              const actionHint = selected && sets.length > 1 ? `Select next ${compound} set` : `Select ${compound}`;
              return <button
                aria-label={displayedSet ? `${driver.shortName} ${compound}, set ${displayedSet.setNumber}, ${displayedSet.freshness}, ${displayedSet.condition}% life, ${sets.length} available. ${actionHint}` : `${driver.shortName} ${compound}, no available sets`}
                aria-pressed={selected}
                data-compound={compound}
                data-life-tone={displayedSet ? tyreLifeTone(displayedSet.condition) : "CRITICAL"}
                data-set-id={displayedSet?.id ?? ""}
                data-set-number={displayedSet?.setNumber ?? ""}
                data-set-count={sets.length}
                data-status={displayedSet?.freshness ?? "UNAVAILABLE"}
                data-tyre-choice="true"
                disabled={car.phase !== "GARAGE" || !available}
                key={compound}
                onClick={() => nextSet && onTyreSetChange(carId, nextSet.id)}
                title={displayedSet ? `${compound} · Set ${displayedSet.setNumber} ${displayedSet.freshness} · ${displayedSet.condition}% life${sets.length > 1 ? " · click again to cycle sets" : ""}` : `${compound} · no usable sets`}
                type="button"
              >
                <TyreBadge compound={compound} size="small" />
                {/* Compound identity only. Remaining life belongs to the
                    physical-set row below, where a set is actually chosen. */}
                <span><strong>{TYRE_NAME[compound]}</strong></span>
                {sets.length > 1 && <em aria-hidden="true">×{sets.length}</em>}
              </button>;
            })}
          </div>
          <div aria-label={`${driver.shortName} ${car.selectedCompound} physical tyre sets`} className={styles.physicalTyreSets} role="group">
            {visibleTyreSets.map((set) => <button
              aria-label={`Select ${car.selectedCompound} set ${set.setNumber}, ${set.freshness}, ${set.condition}% life`}
              aria-pressed={car.selectedTyreSetId === set.id}
              data-compound={set.compound}
              data-life-tone={tyreLifeTone(set.condition)}
              data-set-id={set.id}
              data-set-number={set.setNumber}
              data-status={set.freshness}
              data-tyre-set-choice="true"
              disabled={car.phase !== "GARAGE" || (set.status !== "NEW" && set.status !== "USED")}
              key={set.id}
              onClick={() => onTyreSetChange(carId, set.id)}
              title={`${car.selectedCompound} set ${set.setNumber} · ${set.freshness} · ${set.condition}% life`}
              type="button"
            ><span><b>#{set.setNumber.toString().padStart(2, "0")}</b><strong>{set.condition}%</strong></span><small>{set.freshness}</small></button>)}
          </div>
        </div>
      </ControlSection>
    </div>
  </aside>;
}

export function QualifyingRaceView(props: QualifyingRaceViewProps) {
  const live = props.state.qualifyingLive;
  if (!live) return null;
  const playerCars = playerCarIdsFor(props.state.playerTeamId);
  const selectedCarId = live.cars[props.selectedCarId] ? props.selectedCarId : playerCars.find((carId) => live.cars[carId]) ?? props.selectedCarId;
  const circuit = circuitById(props.state.circuitId);
  const useLegacyTrafficOverview = circuit.id === SILVERSTONE_CIRCUIT.id;
  const reportClassification = props.activeReport?.session.startsWith("Q") ? props.state.results.find((result) => result.session === props.activeReport?.session) ?? null : null;
  const nextQualifyingSession = props.activeReport?.session === "FP3" ? "Q1" : props.activeReport?.session === "Q1" ? "Q2" : props.activeReport?.session === "Q2" ? "Q3" : null;
  return <main className={`pitwall-shell ${styles.shell}`} data-qualifying-paused={live.paused} data-qualifying-session={live.session} data-qualifying-status={live.status}>
    <QualifyingTopbar onOpenChampionship={props.onOpenChampionship} onOpenPreferences={props.onOpenPreferences} onOpenSave={props.onOpenSave} onPause={props.onPause} onReset={props.onReset} onSkipSession={props.onSkipSession} onSpeedChange={props.onSpeedChange} onStart={props.onStart} pendingGridPenaltyPlaces={props.pendingGridPenaltyPlaces} saveReady={props.saveReady} state={props.state} />
    <section className={`race-grid ${styles.grid}`}>
      <MemoQualifyingTower onSelectCar={props.onSelectCar} playerCars={playerCars} state={props.state} />
      <section className={styles.workspace} data-qualifying-renderer={useLegacyTrafficOverview ? "CANVAS_TRAFFIC" : "PIXI_SHARED_MAP"}>
        {useLegacyTrafficOverview
          ? <QualifyingTrafficOverview live={live} playerCars={playerCars} />
          : <RaceMap lightsOn={0} qualifyingState={props.state} startPhase="MENU" />}
      </section>
      <QualifyingCommandDock {...props} playerCars={playerCars} selectedCarId={selectedCarId} />
    </section>
    {props.activeReport && <SessionReport actionLabel={nextQualifyingSession ? `START ${nextQualifyingSession}` : "CONTINUE TO RACE"} classification={reportClassification} onAction={() => { props.onCloseReport(); if (nextQualifyingSession) props.onStart(); }} onClose={props.onCloseReport} report={props.activeReport} />}
  </main>;
}
