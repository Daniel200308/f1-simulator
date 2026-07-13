"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PaceMode, SimulationSpeed, TyreCompound, TyreMode } from "@/domain/race";
import { CarStatusPanel } from "@/components/race/car-status";
import { RaceMap } from "@/components/race/race-map";
import { TimingTower } from "@/components/race/timing-tower";
import { StrategyTimeline } from "@/components/race/strategy-timeline";
import { DRIVER_BY_ID, PLAYER_CAR_IDS, TEAM_BY_ID } from "@/fixtures/grid";
import { useRaceWorker } from "@/hooks/use-race-worker";
import { DEFAULT_SEED, FIXED_STEP_SECONDS } from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";

const SPEEDS: readonly SimulationSpeed[] = [1, 2, 4, 8, 16];
const PACE_MODES: readonly PaceMode[] = ["ATTACK", "PUSH", "STANDARD", "CONSERVE", "COOL"];
const TYRE_MODES: readonly TyreMode[] = ["GRIP", "BALANCED", "SAVE", "TEMPERATURE"];
const PIT_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
type StartPhase = "MENU" | "LIGHTS" | "GO" | "RACING";
const TYRE_SHORT: Record<TyreCompound, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hours, minutes, secs].map((value) => value.toString().padStart(2, "0")).join(":");
}

export function RaceShell() {
  const controls = useRaceWorker();
  const [startPhase, setStartPhase] = useState<StartPhase>("MENU");
  const [lightsOn, setLightsOn] = useState(0);
  const [startingTyres, setStartingTyres] = useState<Record<string, TyreCompound>>({ [PLAYER_CAR_IDS[0]]: "MEDIUM", [PLAYER_CAR_IDS[1]]: "MEDIUM" });
  const startTimers = useRef<number[]>([]);
  const snapshot = useRaceStore((state) => state.snapshot);
  const speed = useRaceStore((state) => state.speed);
  const paused = useRaceStore((state) => state.paused);
  const error = useRaceStore((state) => state.error);
  const snapshotCount = useRaceStore((state) => state.snapshotCount);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const leader = useMemo(() => snapshot?.cars.find((car) => car.racePosition === 1), [snapshot]);
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
  const selectedTeam = selectedCar ? TEAM_BY_ID.get(selectedCar.teamId) : undefined;
  const selectedDriver = selectedCar ? DRIVER_BY_ID.get(selectedCar.driverId) : undefined;
  const raceControlLabel = snapshot?.raceControl === "YELLOW"
    ? `YELLOW S${snapshot.yellowSector ?? "—"}`
    : snapshot?.raceControl === "SAFETY_CAR"
      ? `SC · ${snapshot.safetyCarPhase}`
      : snapshot?.raceControl.replace("_", " ") ?? "GREEN";

  useEffect(() => () => {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function clearStartTimers() {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
    startTimers.current = [];
  }

  function startRace() {
    clearStartTimers();
    controls.reset(DEFAULT_SEED);
    PLAYER_CAR_IDS.forEach((carId) => controls.setStartingTyre(carId, startingTyres[carId]));
    setStartPhase("LIGHTS");
    setLightsOn(1);
    for (let count = 2; count <= 5; count += 1) {
      startTimers.current.push(window.setTimeout(() => setLightsOn(count), (count - 1) * 650));
    }
    startTimers.current.push(window.setTimeout(() => {
      setLightsOn(0);
      setStartPhase("GO");
      controls.play();
    }, 3_750));
    startTimers.current.push(window.setTimeout(() => setStartPhase("RACING"), 4_450));
  }

  function resetToMenu() {
    clearStartTimers();
    setLightsOn(0);
    setStartPhase("MENU");
    controls.reset(DEFAULT_SEED);
  }

  if (error) {
    return <main className="fatal-state"><span>SIMULATION LINK ERROR</span><h1>{error}</h1><button onClick={() => window.location.reload()}>Reload pitwall</button></main>;
  }

  return (
    <main className="pitwall-shell">
      {startPhase === "MENU" && (
        <div className={`start-overlay start-overlay--${startPhase.toLowerCase()}`} data-start-phase={startPhase}>
          <div className="start-card">
            <span className="eyebrow">ROUND 09 · GREAT BRITAIN</span>
            <h1>Silverstone Grand Prix</h1>
            <p>52 LAPS · 5.891 KM · 18 TURNS</p>
            <div className="start-grid-summary"><span>22 DRIVERS</span><span>RAIN IN ~{snapshot?.weather.forecastRainInMinutes ?? 0} MIN</span><span>RACE</span></div>
            <div className="pre-race-tyres">
              {PLAYER_CAR_IDS.map((carId, index) => <div key={carId}><span>CAR {index + 1} START TYRE</span><div>{PIT_COMPOUNDS.map((compound) => <button aria-label={`Car ${index + 1} ${compound}`} className={`tyre-choice tyre-${compound.toLowerCase()} ${startingTyres[carId] === compound ? "is-active" : ""}`} key={compound} onClick={() => setStartingTyres((current) => ({ ...current, [carId]: compound }))} type="button">{TYRE_SHORT[compound]}</button>)}</div></div>)}
            </div>
            <button className="start-race-button" onClick={startRace} type="button">START RACE</button>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand-block"><i className="brand-mark">P</i><div><strong>PROJECT PITWALL</strong><small>RACE OPERATIONS / ALPHA 0.1</small></div></div>
        <div className="session-strip">
          <div><span>SESSION</span><strong>RACE</strong></div>
          <div><span>LAP</span><strong>{leader?.currentLap ?? 1}<em>/ {SILVERSTONE_CIRCUIT.totalLaps}</em></strong></div>
          <div><span>ELAPSED</span><strong>{formatTime(snapshot?.elapsedTime ?? 0)}</strong></div>
          <div className={`condition condition--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}><span>TRACK STATUS</span><strong><i /> {startPhase === "RACING" ? raceControlLabel : "GRID"}</strong></div>
          <div><span>TRACK</span><strong>{Math.round(snapshot?.weather.trackTemperature ?? 31)}°C</strong></div>
          <div><span>WEATHER</span><strong>{(snapshot?.weather.condition ?? "DRY").replace("_", " ")}</strong></div>
        </div>
        <div className="transport">
          <button className="pause-button" disabled={startPhase !== "RACING"} onClick={paused ? controls.play : controls.pause} type="button">{paused ? "▶" : "Ⅱ"}</button>
          <div className="speed-buttons">
            {SPEEDS.map((value) => <button className={speed === value ? "is-active" : ""} key={value} onClick={() => controls.setSpeed(value)} type="button">{value}×</button>)}
          </div>
          <button className="reset-button" onClick={resetToMenu} type="button">RESET</button>
        </div>
      </header>

      <section className="race-grid">
        <TimingTower />
        <section className="map-column">
          <div className="circuit-title"><div><span className="eyebrow">ROUND 09 · GREAT BRITAIN · 5.891 KM · 18 TURNS</span><h1>{SILVERSTONE_CIRCUIT.name}</h1></div><div className={`live-pill live-pill--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}><i /> {startPhase === "RACING" ? (paused ? "PAUSED" : snapshot?.raceControl === "GREEN" ? `${speed}× LIVE` : raceControlLabel) : "ON GRID"}</div></div>
          <RaceMap startPhase={startPhase} lightsOn={lightsOn} />
          <div className="strategy-strip">
            <div className="command-target"><span className="eyebrow">DRIVER COMMAND</span><strong>{selectedDriver?.shortName ?? "—"} · {selectedTeam?.shortName ?? "—"}</strong><small>{selectedTeam?.isPlayer ? "LIVE CONTROL" : "RIVAL · READ ONLY"}</small></div>
            <div className="command-group"><span>PACE</span><div>{PACE_MODES.map((mode) => <button className={selectedCar?.paceMode === mode ? "is-active" : ""} disabled={!selectedTeam?.isPlayer} key={mode} onClick={() => selectedCar && controls.setPace(selectedCar.carId, mode)} type="button">{mode}</button>)}</div></div>
            <div className="command-group"><span>TYRE / PIT STRATEGY · {snapshot?.pitLaneOpen === false ? "PIT CLOSED" : "PIT OPEN"}</span><div>{TYRE_MODES.map((mode) => <button className={selectedCar?.tyreMode === mode ? "is-active" : ""} disabled={!selectedTeam?.isPlayer} key={mode} onClick={() => selectedCar && controls.setTyreMode(selectedCar.carId, mode)} type="button">{mode}</button>)}{PIT_COMPOUNDS.map((compound) => <button className={selectedCar?.scheduledPitCompound === compound ? "is-active" : ""} disabled={!selectedTeam?.isPlayer || selectedCar?.pitStatus !== "TRACK" || snapshot?.pitLaneOpen === false} key={compound} onClick={() => selectedCar && controls.box(selectedCar.carId, compound)} type="button">BOX {TYRE_SHORT[compound]}</button>)}<button disabled={!selectedTeam?.isPlayer || !selectedCar?.scheduledPitCompound} onClick={() => selectedCar && controls.stayOut(selectedCar.carId)} type="button">STAY OUT</button></div></div>
            <StrategyTimeline />
          </div>
        </section>
        <CarStatusPanel />
      </section>

      <footer className="debug-bar">
        <span><i /> SIM WORKER ONLINE</span>
        <span>TICK <strong>{snapshot?.tick ?? 0}</strong></span>
        <span>FIXED STEP <strong>{FIXED_STEP_SECONDS * 1_000}ms</strong></span>
        <span>SEED <strong>{snapshot?.seed ?? DEFAULT_SEED}</strong></span>
        <span>STATE HASH <strong>{snapshot?.checksum ?? "--------"}</strong></span>
        <span>SNAPSHOTS <strong>{snapshotCount}</strong></span>
      </footer>
    </main>
  );
}
