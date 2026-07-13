"use client";

import { useEffect, useRef, useState } from "react";

import type { TyreCompound } from "@/domain/race";
import { CarStatusPanel } from "@/components/race/car-status";
import { CommandDock } from "@/components/race/command-dock";
import { RaceMap } from "@/components/race/race-map";
import { RaceTopbar, type RaceStartPhase } from "@/components/race/race-topbar";
import { TimingTower } from "@/components/race/timing-tower";
import { StrategyTimeline } from "@/components/race/strategy-timeline";
import { PLAYER_CAR_IDS } from "@/fixtures/grid";
import { useRaceWorker } from "@/hooks/use-race-worker";
import { DEFAULT_SEED, FIXED_STEP_SECONDS } from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";

const PIT_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const TYRE_SHORT: Record<TyreCompound, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

export function RaceShell() {
  const controls = useRaceWorker();
  const [startPhase, setStartPhase] = useState<RaceStartPhase>("MENU");
  const [lightsOn, setLightsOn] = useState(0);
  const [startingTyres, setStartingTyres] = useState<Record<string, TyreCompound>>({ [PLAYER_CAR_IDS[0]]: "MEDIUM", [PLAYER_CAR_IDS[1]]: "MEDIUM" });
  const startTimers = useRef<number[]>([]);
  const snapshot = useRaceStore((state) => state.snapshot);
  const speed = useRaceStore((state) => state.speed);
  const paused = useRaceStore((state) => state.paused);
  const autoPauseEnabled = useRaceStore((state) => state.autoPauseEnabled);
  const autoPauseReason = useRaceStore((state) => state.autoPauseReason);
  const error = useRaceStore((state) => state.error);
  const snapshotCount = useRaceStore((state) => state.snapshotCount);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
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
      <RaceTopbar
        snapshot={snapshot}
        speed={speed}
        paused={paused}
        autoPauseEnabled={autoPauseEnabled}
        autoPauseReason={autoPauseReason}
        startPhase={startPhase}
        onPlay={controls.play}
        onPause={controls.pause}
        onSetAutoPause={controls.setAutoPause}
        onSetSpeed={controls.setSpeed}
        onReset={resetToMenu}
      />

      <section className="race-grid">
        <TimingTower />
        <section className="map-column">
          <div className="circuit-title"><div><span className="eyebrow">ROUND 09 · GREAT BRITAIN · 5.891 KM · 18 TURNS</span><h1>{SILVERSTONE_CIRCUIT.name}</h1></div><div className={`live-pill live-pill--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}><i /> {startPhase === "RACING" ? (paused ? "PAUSED" : snapshot?.raceControl === "GREEN" ? `${speed}× LIVE` : raceControlLabel) : "ON GRID"}</div></div>
          <RaceMap startPhase={startPhase} lightsOn={lightsOn} />
          <div className="strategy-strip">
            <CommandDock car={selectedCar} controls={controls} pitLaneOpen={snapshot?.pitLaneOpen !== false} />
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
