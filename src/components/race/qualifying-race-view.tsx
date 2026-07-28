"use client";

import { memo } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDownToLine,
  BatteryCharging,
  Clock3,
  Flag,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Snowflake,
  Target,
  Thermometer,
  TimerReset,
  Zap,
} from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import { QualifyingTrafficOverview } from "@/components/race/qualifying-traffic-overview";
import { TyreBadge } from "@/components/race/tyre-badge";
import { SessionReport } from "@/components/race/weekend-hub";
import { DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import type { TyreCompound } from "@/domain/race";
import type { SectorTimingTone } from "@/simulation/sector-timing";
import { raceStartTyreInventory } from "@/simulation/tyre-allocation";
import {
  liveQualifyingClassification,
  qualifyingCutPosition,
  qualifyingDisplayStatus,
  qualifyingReleaseForecast,
  type QualifyingAttackMode,
  type QualifyingEnergyMode,
  type QualifyingFuelPlan,
  type QualifyingOutLapMode,
  type QualifyingSimulationSpeed,
  type QualifyingCarState,
  type WeekendSessionReport,
  type WeekendState,
} from "@/simulation/weekend";

import styles from "./qualifying-race-view.module.css";

const OUT_LAP_MODES: readonly { mode: QualifyingOutLapMode; label: string; compact: string; hint: string }[] = [
  { mode: "SLOW", label: "Gentle", compact: "GTL", hint: "Protect the tyre, with a cold-tyre risk" },
  { mode: "BALANCED", label: "Balanced", compact: "BAL", hint: "Target the normal tyre preparation window" },
  { mode: "FAST", label: "Aggressive Warm-up", compact: "WARM", hint: "Heat the tyre quickly at higher overheating and traffic risk" },
];
const ATTACK_MODES: readonly { mode: QualifyingAttackMode; label: string; compact: string; hint: string }[] = [
  { mode: "SAFE", label: "Safe", compact: "SAFE", hint: "Leave margin for traffic and track limits" },
  { mode: "NORMAL", label: "Push", compact: "PUSH", hint: "Commit to the reference qualifying lap" },
  { mode: "ATTACK", label: "Attack", compact: "ATK", hint: "Trade consistency for lap time" },
  { mode: "MAXIMUM", label: "Maximum", compact: "MAX", hint: "Maximum pace with the highest lock-up and deletion risk" },
];
const FUEL_PLANS: readonly { plan: QualifyingFuelPlan; label: string; compact: string; hint: string }[] = [
  { plan: "ONE_LAP", label: "1 Flying Lap", compact: "1L", hint: "Lowest fuel mass and no second attempt" },
  { plan: "TWO_LAPS", label: "2 Flying Laps", compact: "2L", hint: "Two attempts with a cool-down lap between" },
  { plan: "TWO_LAPS_MARGIN", label: "2 Laps + Margin", compact: "2+", hint: "Extra fuel for traffic or a delayed attempt" },
];
const ENERGY_MODES: readonly { mode: QualifyingEnergyMode; label: string; hint: string }[] = [
  { mode: "CHARGE", label: "CHG", hint: "Recover energy and prepare the next attempt" },
  { mode: "BALANCED", label: "BAL", hint: "Balance recovery and deployment" },
  { mode: "QUALI", label: "QUALI", hint: "Maximum automatic deployment on the flying lap" },
];
const QUALIFYING_SPEEDS: readonly QualifyingSimulationSpeed[] = [1, 2, 4, 8, 16];
const QUALIFYING_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const TYRE_SHORT: Readonly<Record<TyreCompound, string>> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

interface QualifyingRaceViewProps {
  state: WeekendState;
  selectedCarId: string;
  activeReport: WeekendSessionReport | null;
  onCloseReport: () => void;
  onSelectCar: (carId: string) => void;
  onStart: () => void;
  onRelease: (carId: string) => void;
  onWaitForGap: (carId: string) => void;
  onHoldInGarage: (carId: string) => void;
  onAbortLap: (carId: string) => void;
  onCoolDown: (carId: string) => void;
  onReturnToPits: (carId: string) => void;
  onOutLapModeChange: (carId: string, mode: QualifyingOutLapMode) => void;
  onAttackModeChange: (carId: string, mode: QualifyingAttackMode) => void;
  onFuelPlanChange: (carId: string, plan: QualifyingFuelPlan) => void;
  onEnergyModeChange: (carId: string, mode: QualifyingEnergyMode) => void;
  onTyreSetChange: (carId: string, tyreSetId: string) => void;
  onSpeedChange: (speed: QualifyingSimulationSpeed) => void;
  onPause: () => void;
  onSkipSession: () => void;
  onReset: () => void;
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0");
  const remainder = Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function teamTone(carId: string): string {
  const driver = DRIVER_BY_ID.get(carId);
  const team = driver ? TEAM_BY_ID.get(driver.teamId) : null;
  return `#${(team?.primaryColor ?? 0x20d7e7).toString(16).padStart(6, "0")}`;
}

function QualifyingTopbar({ state, onStart, onSpeedChange, onPause, onReset, onSkipSession }: Pick<QualifyingRaceViewProps, "state" | "onStart" | "onSpeedChange" | "onPause" | "onReset" | "onSkipSession">) {
  const live = state.qualifyingLive!;
  const cut = qualifyingCutPosition(state);
  const carsOnTrack = Object.values(live.cars).filter((car) => car.phase !== "GARAGE").length;
  const flagLabel = live.status === "READY" ? "PIT OPEN" : live.status === "CHECKERED" ? "CHEQUERED" : "GREEN";
  return (
    <header className={`topbar topbar--telemetry ${styles.topbar}`} aria-label={`${live.session} qualifying header`}>
      <div className="brand-block brand-block--signal"><div className="brand-copy"><strong>PROJECT PITWALL</strong><small>SILVERSTONE QUALIFYING</small></div></div>
      <div className={`broadcast-strip broadcast-strip--iconic ${styles.broadcast}`}>
        <section className="broadcast-session session-copy-panel"><div className="hud-stat-copy"><span>ROUND 09</span><strong>{live.session}</strong><small>QUALIFYING</small></div></section>
        <section className="broadcast-status track-flag-panel condition--green"><div className="hud-stat-copy"><strong>{flagLabel}</strong><small>{carsOnTrack} CARS ON TRACK</small></div></section>
        <section className={styles.timerPanel} aria-label={`${formatClock(live.remainingSeconds)} remaining`}><Clock3 aria-hidden="true" size={27} /><span><small>SESSION TIME</small><strong>{formatClock(live.remainingSeconds)}</strong></span><i><b style={{ width: `${(live.remainingSeconds / live.durationSeconds) * 100}%` }} /></i></section>
        <section className="broadcast-control-message flag--green"><div className="control-message-meta"><span>FIA QUALIFYING CONTROL</span></div><strong className="control-message-title">{cut ? `ELIMINATION LINE · P${cut}` : "POLE POSITION SHOOTOUT"}</strong><p className="control-message-detail">{live.status === "READY" ? `${live.session} ready · pit exit open` : live.status === "CHECKERED" ? "Chequered flag · active flying laps may be completed" : `${carsOnTrack} cars circulating · pit exit open`}</p></section>
      </div>
      <nav className={`transport transport--iconic ${styles.transport}`} aria-label="Qualifying playback controls">
        {live.status === "READY"
          ? <button className={styles.startButton} onClick={onStart} type="button"><Play aria-hidden="true" fill="currentColor" size={18} />START {live.session}</button>
          : <button aria-label={live.paused ? "Resume qualifying" : "Pause qualifying"} aria-pressed={live.paused} className={styles.pauseButton} onClick={onPause} title={live.paused ? "Resume qualifying" : "Pause qualifying"} type="button">{live.paused ? <Play aria-hidden="true" fill="currentColor" size={15} /> : <Pause aria-hidden="true" fill="currentColor" size={15} />}</button>}
        <div className="speed-selector" role="group" aria-label="Simulation speed"><span className="speed-selector-label"><Zap size={13} aria-hidden="true" /> SIM RATE</span><div className="speed-buttons speed-rail"><i className="speed-rail-line" aria-hidden="true" />{QUALIFYING_SPEEDS.map((speed) => <button aria-label={`Set simulation speed to ${speed} times`} aria-pressed={live.speed === speed} className={`speed-step ${live.speed === speed ? "is-active" : ""}`} key={speed} onClick={() => onSpeedChange(speed)} type="button"><i className="speed-pip" aria-hidden="true" /><span>{speed}×</span></button>)}</div></div>
        <button className={styles.skipButton} onClick={onSkipSession} title={`Simulate the remainder of ${live.session}`} type="button"><SkipForward aria-hidden="true" size={15} />SKIP {live.session}</button>
        <button className="reset-button reset-button--icon" aria-label="Return to team selection" onClick={onReset} type="button"><RotateCcw size={16} aria-hidden="true" /></button>
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
    <div aria-label="Qualifying leaderboard columns" className={styles.towerHead}><span aria-hidden="true" /><span>Driver</span><span>Tyre</span><span>Gap</span><span>Best</span></div>
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

function tyreConditionLabel(condition: number): "FRESH" | "GOOD" | "WORN" | "CRITICAL" {
  if (condition >= 90) return "FRESH";
  if (condition >= 70) return "GOOD";
  if (condition >= 40) return "WORN";
  return "CRITICAL";
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
        return <span
          aria-label={`${name} tyre, ${temperature.toFixed(0)} degrees Celsius, ${stateLabel.toLowerCase()}`}
          data-temperature={tone}
          data-tyre-position={label}
          key={label}
          title={`${label} — ${name}: ${temperature.toFixed(0)} degrees Celsius · ${stateLabel}`}
        >
          <i aria-hidden="true"><Thermometer size={11} /></i>
          <b><abbr title={name}>{label}</abbr></b>
          <strong>{temperature.toFixed(0)}<small>°C</small></strong>
          <em>{stateLabel}</em>
        </span>;
      })}
    </div>
  </section>;
}

function ControlSection({ children, title, value, control }: { children: ReactNode; title: string; value: string; control: string }) {
  return <section className={styles.controlSection} data-control={control}><header><span>{title}</span><b title={value}>{value}</b></header>{children}</section>;
}

function QualifyingCommandDock({
  state,
  selectedCarId,
  playerCars,
  onSelectCar,
  onRelease,
  onHoldInGarage,
  onAbortLap,
  onCoolDown,
  onReturnToPits,
  onOutLapModeChange,
  onAttackModeChange,
  onFuelPlanChange,
  onEnergyModeChange,
  onTyreSetChange,
}: Pick<QualifyingRaceViewProps, "state" | "selectedCarId" | "onSelectCar" | "onRelease" | "onHoldInGarage" | "onAbortLap" | "onCoolDown" | "onReturnToPits" | "onOutLapModeChange" | "onAttackModeChange" | "onFuelPlanChange" | "onEnergyModeChange" | "onTyreSetChange"> & { playerCars: readonly string[] }) {
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
  const remainingTyreLife = selectedTyreOption?.condition ?? (selectedTyreSet ? Math.round(100 - selectedTyreSet.wearPercent) : null);
  const activeTyreCondition = remainingTyreLife === null ? null : tyreConditionLabel(remainingTyreLife);
  const canRelease = car.phase === "GARAGE" && live.status === "RUNNING" && hasValidTyreSet && Boolean(forecast?.canFinishBeforeChequered && forecast.mergeSafe);
  return <aside className={styles.controlRail} aria-label="Qualifying driver control" data-car-id={carId} data-lap-status={status} style={{ "--team-color": teamTone(carId) } as CSSProperties}>
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
        <span><Gauge aria-hidden="true" size={14} /><small>SPEED</small><strong>{Math.round(car.currentSpeedKph)}</strong><em>km/h</em></span>
        <span><TimerReset aria-hidden="true" size={14} /><small>TRAFFIC</small><strong className={styles[`traffic${car.trafficLevel}`]}>{car.trafficLevel}</strong><em>{forecast ? `${forecast.expectedGapSeconds.toFixed(1)}s gap` : "—"}</em></span>
      </div>
      <TyreTelemetry car={car} />
      {car.trafficDecisionMessage && <p className={styles.trafficDecision} data-decision={car.trafficDecisionState}><b>{car.trafficDecisionState}</b><span>{car.trafficDecisionMessage}</span></p>}
    </section>

    <div className={styles.controlStack}>
      <ControlSection control="release" title="PIT RELEASE" value={canRelease ? `${forecast?.expectedGapSeconds.toFixed(1)}s CLEAR` : !hasValidTyreSet && car.phase === "GARAGE" ? "SELECT TYRE SET" : car.phase === "GARAGE" && forecast && !forecast.mergeSafe ? "HOLD · FLYING CAR" : car.phase === "GARAGE" ? "GARAGE" : "ON TRACK"}><div aria-label={`${driver.shortName} pit release controls`} className={`${styles.orbOptions} ${styles.releaseOptions}`} role="group">
        <button aria-label={`${driver.shortName} Release Now`} disabled={!canRelease} onClick={() => onRelease(carId)} title="Release the car immediately" type="button"><i><Play aria-hidden="true" fill="currentColor" size={16} /></i><span>Release Now</span></button>
        <button aria-label={`${driver.shortName} Hold in Garage`} aria-pressed={car.releaseRequest === "HOLD"} disabled={car.phase !== "GARAGE"} onClick={() => onHoldInGarage(carId)} title="Hold the car in the garage" type="button"><i><Flag aria-hidden="true" size={16} /></i><span>Hold</span></button>
      </div></ControlSection>
      <ControlSection control="out-lap" title="OUT LAP PACE" value={car.outLapMode}><div className={styles.segmentOptions}>{OUT_LAP_MODES.map((option) => <button aria-label={`${driver.shortName} set out lap pace ${option.label}`} aria-pressed={car.outLapMode === option.mode} disabled={car.phase === "PUSH_LAP"} key={option.mode} onClick={() => onOutLapModeChange(carId, option.mode)} title={option.hint} type="button"><span>{option.compact}</span></button>)}</div></ControlSection>
      <ControlSection control="attack" title="FLYING ATTACK" value={car.attackMode}><div className={styles.segmentOptions}>{ATTACK_MODES.map((option) => <button aria-label={`${driver.shortName} set flying lap attack ${option.label}`} aria-pressed={car.attackMode === option.mode} disabled={car.phase === "PUSH_LAP"} key={option.mode} onClick={() => onAttackModeChange(carId, option.mode)} title={option.hint} type="button"><span>{option.compact}</span></button>)}</div></ControlSection>
      <ControlSection control="fuel" title="FUEL PLAN" value={`${car.fuelLoadKg.toFixed(1)} kg`}><div className={styles.segmentOptions}>{FUEL_PLANS.map((option) => <button aria-label={`${driver.shortName} set fuel plan ${option.label}`} aria-pressed={car.fuelPlan === option.plan} disabled={car.phase !== "GARAGE"} key={option.plan} onClick={() => onFuelPlanChange(carId, option.plan)} title={option.hint} type="button"><span>{option.compact}</span></button>)}</div></ControlSection>
      <ControlSection control="energy" title="ENERGY MODE" value={`${Math.round(car.energyPercent)}%`}><div className={styles.segmentOptions}>{ENERGY_MODES.map((option, index) => <button aria-label={`${driver.shortName} set energy mode ${option.mode}`} aria-pressed={car.energyMode === option.mode} key={option.mode} onClick={() => onEnergyModeChange(carId, option.mode)} title={option.hint} type="button">{index === 0 ? <BatteryCharging aria-hidden="true" size={12} /> : index === 1 ? <Gauge aria-hidden="true" size={12} /> : <Zap aria-hidden="true" size={12} />}<span>{option.label}</span></button>)}</div></ControlSection>
      <ControlSection control="lap-action" title="LAP ACTION" value={status}><div aria-label={`${driver.shortName} lap actions`} className={styles.orbOptions} role="group">
        <button aria-label={`${driver.shortName} Abort Lap`} disabled={car.phase !== "PUSH_LAP"} onClick={() => onAbortLap(carId)} title="Abort this flying lap" type="button"><i><Target aria-hidden="true" size={16} /></i><span>Abort</span></button>
        <button aria-label={`${driver.shortName} Cool Down`} disabled={car.phase !== "PUSH_LAP" && car.phase !== "OUT_LAP"} onClick={() => onCoolDown(carId)} title="Convert this lap to a cool-down lap" type="button"><i><Snowflake aria-hidden="true" size={16} /></i><span>Cool Down</span></button>
        <button aria-label={`${driver.shortName} Return to Pits`} disabled={car.phase !== "OUT_LAP" && car.phase !== "COOL_DOWN" && car.phase !== "IN_LAP"} onClick={() => onReturnToPits(carId)} title="Return to the garage" type="button"><i><ArrowDownToLine aria-hidden="true" size={16} /></i><span>Return</span></button>
      </div></ControlSection>
      <ControlSection control="tyres" title="TYRE SELECTION" value={selectedTyreSet && selectedTyreOption && remainingTyreLife !== null ? `${TYRE_SHORT[selectedTyreSet.compound]} · ${selectedTyreOption.freshness} · ${remainingTyreLife}%` : "SET REQUIRED"}>
        <div className={styles.tyreConsole}>
          <div aria-label={`${driver.shortName} tyre compounds`} className={styles.compoundSelector} role="group">{QUALIFYING_COMPOUNDS.map((compound) => {
            const sets = displayedTyreSets(compound);
            const newCount = sets.filter((set) => set.status === "NEW").length;
            const usedCount = sets.filter((set) => set.status === "USED").length;
            return <button aria-label={`${driver.shortName} ${compound}, ${newCount} new and ${usedCount} used sets`} aria-pressed={car.selectedCompound === compound} data-compound={compound} disabled={car.phase !== "GARAGE" || sets.length === 0} key={compound} onClick={() => sets[0] && onTyreSetChange(carId, sets[0].id)} title={`${compound} · ${newCount} new · ${usedCount} used`} type="button"><TyreBadge compound={compound} size="medium" /><span><b>{TYRE_SHORT[compound]}</b><small>{newCount}N · {usedCount}U</small></span></button>;
          })}</div>
          <div className={styles.tyreSetList} aria-label={`${car.selectedCompound} physical tyre sets`} role="group">
            {displayedTyreSets(car.selectedCompound).map((set) => <button aria-label={`Select ${car.selectedCompound} set ${set.setNumber}, ${set.freshness}, ${set.condition}% life`} aria-pressed={car.selectedTyreSetId === set.id} data-compound={set.compound} data-life-tone={tyreLifeTone(set.condition)} data-status={set.freshness} disabled={car.phase !== "GARAGE" || (set.status !== "NEW" && set.status !== "USED")} key={set.id} onClick={() => onTyreSetChange(carId, set.id)} title={`Set ${set.setNumber} · ${set.freshness} · ${set.condition}% life`} type="button"><i aria-hidden="true" data-compound={set.compound} style={{ "--wear": `${set.condition}%` } as CSSProperties} /><span><b>{set.setNumber.toString().padStart(2, "0")}</b><strong>{set.condition}%</strong><small>{set.freshness}</small></span></button>)}
          </div>
          {selectedTyreSet && selectedTyreOption && remainingTyreLife !== null && activeTyreCondition && <section
            aria-label={`Active ${selectedTyreSet.compound} tyre set ${selectedTyreOption.setNumber}, ${selectedTyreOption.freshness}, ${remainingTyreLife}% life, ${activeTyreCondition.toLowerCase()}`}
            className={styles.activeSet}
            data-compound={selectedTyreSet.compound}
            data-life-tone={tyreLifeTone(remainingTyreLife)}
            key={selectedTyreSet.id}
            role="status"
          >
            <TyreBadge compound={selectedTyreSet.compound} size="large" />
            <span className={styles.activeSetIdentity}><small>ACTIVE SET <b>{selectedTyreOption.freshness}</b></small><strong>{selectedTyreSet.compound}<em>SET {selectedTyreOption.setNumber.toString().padStart(2, "0")}</em></strong><i>{activeTyreCondition}</i></span>
            <span className={styles.activeSetLife}><strong>{remainingTyreLife}</strong><small>% LIFE</small></span>
          </section>}
          {!hasValidTyreSet && car.phase === "GARAGE" && <div className={styles.tyreWarning}><TyreBadge compound={car.selectedCompound} size="small" /><span><b>RELEASE LOCKED</b><small>Select a tyre set before release</small></span></div>}
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
  const reportClassification = props.activeReport?.session.startsWith("Q") ? props.state.results.find((result) => result.session === props.activeReport?.session) ?? null : null;
  const nextQualifyingSession = props.activeReport?.session === "FP3" ? "Q1" : props.activeReport?.session === "Q1" ? "Q2" : props.activeReport?.session === "Q2" ? "Q3" : null;
  return <main className={`pitwall-shell ${styles.shell}`} data-qualifying-session={live.session} data-qualifying-status={live.status}>
    <QualifyingTopbar onPause={props.onPause} onReset={props.onReset} onSkipSession={props.onSkipSession} onSpeedChange={props.onSpeedChange} onStart={props.onStart} state={props.state} />
    <section className={`race-grid ${styles.grid}`}>
      <MemoQualifyingTower onSelectCar={props.onSelectCar} playerCars={playerCars} state={props.state} />
      <section className={styles.workspace}><QualifyingTrafficOverview live={live} playerCars={playerCars} /></section>
      <QualifyingCommandDock {...props} playerCars={playerCars} selectedCarId={selectedCarId} />
    </section>
    {props.activeReport && <SessionReport actionLabel={nextQualifyingSession ? `START ${nextQualifyingSession}` : "CONTINUE TO RACE"} classification={reportClassification} onAction={() => { props.onCloseReport(); if (nextQualifyingSession) props.onStart(); }} onClose={props.onCloseReport} report={props.activeReport} />}
  </main>;
}
