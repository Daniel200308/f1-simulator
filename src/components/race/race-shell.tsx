"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Gauge, History, Trophy } from "lucide-react";

import type { TyreCompound } from "@/domain/race";
import { CarStatusPanel } from "@/components/race/car-status";
import { CommandDock, type CommandDockControls } from "@/components/race/command-dock";
import { RaceMap } from "@/components/race/race-map";
import { RaceOperationsPanel } from "@/components/race/race-operations-panel";
import { ReplayReportPanel, type ReplayReportView } from "@/components/race/replay-report-panel";
import { RaceTopbar, type RaceStartPhase } from "@/components/race/race-topbar";
import { TimingTower } from "@/components/race/timing-tower";
import { StrategyTimeline } from "@/components/race/strategy-timeline";
import { StrategyIntelligencePanel } from "@/components/race/strategy-intelligence-panel";
import { TeamSelection } from "@/components/race/team-selection";
import { WeekendHub } from "@/components/race/weekend-hub";
import { DEFAULT_PLAYER_TEAM_ID, playerCarIdsFor } from "@/fixtures/grid";
import { useRaceWorker } from "@/hooks/use-race-worker";
import { DEFAULT_SEED, FIXED_STEP_SECONDS } from "@/simulation/engine";
import { RaceReplayRecorder, type RaceReplayRecording, type ReplayEventValue } from "@/simulation/race-replay";
import { buildRaceReport } from "@/simulation/race-report";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { createWeekendState, latestWeekendReport, raceSetupPerformanceFactor, runWeekendSession, setWeekendCarSetup, type WeekendSessionReport } from "@/simulation/weekend";
import { useRaceStore } from "@/store/race-store";

export function RaceShell() {
  const controls = useRaceWorker();
  const [selectedTeamId, setSelectedTeamId] = useState(DEFAULT_PLAYER_TEAM_ID);
  const [teamConfirmed, setTeamConfirmed] = useState(false);
  const [startPhase, setStartPhase] = useState<RaceStartPhase>("MENU");
  const [lightsOn, setLightsOn] = useState(0);
  const [weekend, setWeekend] = useState(() => createWeekendState(DEFAULT_SEED, DEFAULT_PLAYER_TEAM_ID));
  const [startingTyres, setStartingTyres] = useState<Record<string, TyreCompound>>(() => Object.fromEntries(playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID).map((carId) => [carId, "MEDIUM"])));
  const [activeWeekendReport, setActiveWeekendReport] = useState<WeekendSessionReport | null>(null);
  const [replayRecording, setReplayRecording] = useState<RaceReplayRecording | null>(null);
  const [strategyCarId, setStrategyCarId] = useState<string | null>(null);
  const [raceOperationsCarId, setRaceOperationsCarId] = useState<string | null>(null);
  const [reviewView, setReviewView] = useState<ReplayReportView | null>(null);
  const startTimers = useRef<number[]>([]);
  const replayRecorder = useRef(new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID) }));
  const pendingReplayReset = useRef<{ expectedStartingTyres: Readonly<Record<string, TyreCompound>> | null } | null>(null);
  const snapshot = useRaceStore((state) => state.snapshot);
  const speed = useRaceStore((state) => state.speed);
  const paused = useRaceStore((state) => state.paused);
  const autoPauseEnabled = useRaceStore((state) => state.autoPauseEnabled);
  const autoPauseReason = useRaceStore((state) => state.autoPauseReason);
  const error = useRaceStore((state) => state.error);
  const snapshotCount = useRaceStore((state) => state.snapshotCount);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const setSelectedCarId = useRaceStore((state) => state.setSelectedCarId);
  const playerCarIds = playerCarIdsFor(selectedTeamId);
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
  const selectedCarActive = Boolean(selectedCar
    && selectedCar.teamId === snapshot?.playerTeamId
    && !selectedCar.finished
    && selectedCar.incidentStatus !== "RETIRED");
  const raceControlLabel = snapshot?.raceControl === "YELLOW"
    ? `YELLOW S${snapshot.yellowSector ?? "—"}`
    : snapshot?.raceControl === "SAFETY_CAR"
      ? `SC · ${snapshot.safetyCarPhase}`
      : snapshot?.raceControl.replace("_", " ") ?? "GREEN";

  useEffect(() => () => {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const pendingReset = pendingReplayReset.current;
    if (pendingReset) {
      const resetSnapshotArrived = snapshot.tick === 0 && snapshot.elapsedTime === 0;
      const expectedTyresReady = !pendingReset.expectedStartingTyres || playerCarIdsFor(selectedTeamId).every((carId) => (
        snapshot.cars.find((car) => car.carId === carId)?.tyreCompound === pendingReset.expectedStartingTyres?.[carId]
      ));
      if (!resetSnapshotArrived || !expectedTyresReady) return;
      replayRecorder.current.reset();
      pendingReplayReset.current = null;
    }
    const recording = replayRecorder.current.record(snapshot);
    setReplayRecording((current) => current?.endedAt === recording.endedAt && current.events.length === recording.events.length && current.frames.length === recording.frames.length ? current : recording);
  }, [snapshot, selectedTeamId]);

  function annotateCommand(carId: string, message: string, data?: Readonly<Record<string, ReplayEventValue>>) {
    const recording = replayRecorder.current.annotate({ kind: "STRATEGY", message, carId, severity: "INFO", data }, snapshot?.elapsedTime ?? 0);
    setReplayRecording(recording);
  }

  function commandableCar(carId: string) {
    const car = snapshot?.cars.find((candidate) => candidate.carId === carId);
    return car
      && car.teamId === snapshot?.playerTeamId
      && snapshot?.status !== "FINISHED"
      && !car.finished
      && car.incidentStatus !== "RETIRED"
      ? car
      : null;
  }

  const commandControls: CommandDockControls = {
    setPace: (carId, mode) => { if (!commandableCar(carId)) return; annotateCommand(carId, `Pace mode ${mode}`, { mode }); controls.setPace(carId, mode); },
    setEnergyMode: (carId, mode) => { if (!commandableCar(carId)) return; annotateCommand(carId, `Energy mode ${mode}`, { mode }); controls.setEnergyMode(carId, mode); },
    setTyreMode: (carId, mode) => { if (!commandableCar(carId)) return; annotateCommand(carId, `Tyre management ${mode}`, { mode }); controls.setTyreMode(carId, mode); },
    setCoolingMode: (carId, mode) => { if (!commandableCar(carId)) return; annotateCommand(carId, `Cooling mode ${mode}`, { mode }); controls.setCoolingMode(carId, mode); },
    setBrakeBias: (carId, brakeBiasPercent) => { if (!commandableCar(carId)) return; annotateCommand(carId, `Brake bias ${brakeBiasPercent.toFixed(1)}%`, { brakeBiasPercent }); controls.setBrakeBias(carId, brakeBiasPercent); },
    box: (carId, compound) => { const car = commandableCar(carId); if (!car || car.pitStatus !== "TRACK") return; annotateCommand(carId, `Box this lap for ${compound}`, { compound }); controls.box(carId, compound); },
    stayOut: (carId) => { const car = commandableCar(carId); if (!car || car.pitStatus !== "TRACK" || !car.scheduledPitCompound) return; annotateCommand(carId, "Stay out", { command: "STAY_OUT" }); controls.stayOut(carId); },
  };

  function clearStartTimers() {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
    startTimers.current = [];
  }

  function startRace() {
    clearStartTimers();
    pendingReplayReset.current = { expectedStartingTyres: { ...startingTyres } };
    replayRecorder.current.reset();
    setReplayRecording(null);
    const setupPerformanceByCar = Object.fromEntries(Object.entries(weekend.setups).map(([carId, setup]) => [carId, raceSetupPerformanceFactor(setup, weekend.seed, carId)]));
    controls.reset(DEFAULT_SEED, weekend.gridOrder, weekend.tyreUsage, setupPerformanceByCar, selectedTeamId);
    playerCarIds.forEach((carId) => controls.setStartingTyre(carId, startingTyres[carId]));
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
    pendingReplayReset.current = { expectedStartingTyres: null };
    replayRecorder.current.reset();
    setReplayRecording(null);
    setLightsOn(0);
    setStartPhase("MENU");
    setStrategyCarId(null);
    setRaceOperationsCarId(null);
    setReviewView(null);
    setActiveWeekendReport(null);
    setTeamConfirmed(false);
    setStartingTyres(Object.fromEntries(playerCarIds.map((carId) => [carId, "MEDIUM"])));
    controls.reset(DEFAULT_SEED, undefined, undefined, undefined, selectedTeamId);
    setWeekend(createWeekendState(DEFAULT_SEED, selectedTeamId));
  }

  function runCurrentWeekendSession() {
    const next = runWeekendSession(weekend);
    setWeekend(next);
    setActiveWeekendReport(latestWeekendReport(next));
  }

  function confirmTeamSelection() {
    const carIds = playerCarIdsFor(selectedTeamId);
    const tyres = Object.fromEntries(carIds.map((carId) => [carId, "MEDIUM" as TyreCompound]));
    setWeekend(createWeekendState(DEFAULT_SEED, selectedTeamId));
    setStartingTyres(tyres);
    setActiveWeekendReport(null);
    setSelectedCarId(carIds[0]);
    replayRecorder.current = new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: carIds });
    pendingReplayReset.current = { expectedStartingTyres: null };
    controls.reset(DEFAULT_SEED, undefined, undefined, undefined, selectedTeamId);
    setTeamConfirmed(true);
  }

  if (error) {
    return <main className="fatal-state"><span>SIMULATION LINK ERROR</span><h1>{error}</h1><button onClick={() => window.location.reload()}>Reload pitwall</button></main>;
  }

  return (
    <main className="pitwall-shell">
      {startPhase === "MENU" && !teamConfirmed && (
        <TeamSelection onConfirm={confirmTeamSelection} onSelect={setSelectedTeamId} selectedTeamId={selectedTeamId} />
      )}
      {startPhase === "MENU" && teamConfirmed && (
        <WeekendHub
          activeReport={activeWeekendReport}
          onCloseReport={() => setActiveWeekendReport(null)}
          onRunSession={runCurrentWeekendSession}
          onSetupChange={(carId, setup) => setWeekend((current) => setWeekendCarSetup(current, carId, setup))}
          onStartRace={startRace}
          onStartingTyreChange={(carId, compound) => setStartingTyres((current) => ({ ...current, [carId]: compound }))}
          startingTyres={startingTyres}
          state={weekend}
        />
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
          <div className="circuit-title">
            <div><span className="eyebrow">ROUND 09 · GREAT BRITAIN · 5.891 KM · 18 TURNS</span><h1>{SILVERSTONE_CIRCUIT.name}</h1></div>
            <div className="operations-launcher">
              <button aria-label="Open race operations" disabled={!snapshot || !selectedCarActive} onClick={() => setRaceOperationsCarId(selectedCar?.carId ?? null)} type="button"><Gauge aria-hidden="true" size={14} /><span>RACE OPS</span></button>
              <button aria-label="Open strategy intelligence" disabled={!snapshot || !selectedCarActive} onClick={() => setStrategyCarId(selectedCar?.carId ?? null)} type="button"><BrainCircuit aria-hidden="true" size={14} /><span>STRATEGY 3.0</span></button>
              <button aria-label="Open race replay" disabled={!replayRecording?.frames.length} onClick={() => { controls.pause(); setReviewView("REPLAY"); }} type="button"><History aria-hidden="true" size={14} /><span>REPLAY</span></button>
              <button aria-label="Open race report" disabled={!snapshot || !replayRecording?.frames.length} onClick={() => { controls.pause(); setReviewView("REPORT"); }} type="button"><Trophy aria-hidden="true" size={14} /><span>REPORT</span></button>
              <div className={`live-pill live-pill--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}><i /> {startPhase === "RACING" ? (paused ? "PAUSED" : snapshot?.raceControl === "GREEN" ? `${speed}× LIVE` : raceControlLabel) : "ON GRID"}</div>
            </div>
          </div>
          <RaceMap startPhase={startPhase} lightsOn={lightsOn} />
          <div className="strategy-strip">
            <CommandDock car={selectedCar} controls={commandControls} pitLaneOpen={snapshot?.pitLaneOpen !== false} />
            <StrategyTimeline />
          </div>
        </section>
        <CarStatusPanel controls={commandControls} />
      </section>

      {strategyCarId === selectedCar?.carId && selectedCarActive && snapshot && selectedCar && (
        <StrategyIntelligencePanel
          car={selectedCar}
          onBox={(compound) => { commandControls.box(selectedCar.carId, compound); setStrategyCarId(null); }}
          onClose={() => setStrategyCarId(null)}
          onStayOut={() => { commandControls.stayOut(selectedCar.carId); setStrategyCarId(null); }}
          snapshot={snapshot}
        />
      )}
      {raceOperationsCarId === selectedCar?.carId && selectedCarActive && snapshot && selectedCar && (
        <RaceOperationsPanel car={selectedCar} controls={commandControls} onClose={() => setRaceOperationsCarId(null)} snapshot={snapshot} />
      )}
      {reviewView && snapshot && replayRecording && (
        <ReplayReportPanel
          initialView={reviewView}
          onClose={() => setReviewView(null)}
          onReplaySeek={() => { if (!paused) controls.pause(); }}
          open
          recording={replayRecording}
          report={buildRaceReport(snapshot, { recording: replayRecording })}
        />
      )}

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
