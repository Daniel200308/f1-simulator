"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Trophy } from "lucide-react";

import type { TyreCompound } from "@/domain/race";
import { CarStatusPanel } from "@/components/race/car-status";
import { CommandDock, type CommandDockControls } from "@/components/race/command-dock";
import { EnergyDebugPanel } from "@/components/race/energy-debug-panel";
import { RaceMap } from "@/components/race/race-map";
import { QualifyingRaceView } from "@/components/race/qualifying-race-view";
import { ReplayReportPanel } from "@/components/race/replay-report-panel";
import { RaceTopbar, type RaceStartPhase } from "@/components/race/race-topbar";
import { TimingTower } from "@/components/race/timing-tower";
import { StrategyIntelligencePanel } from "@/components/race/strategy-intelligence-panel";
import { TeamSelection } from "@/components/race/team-selection";
import { WeekendHub } from "@/components/race/weekend-hub";
import { DEFAULT_PLAYER_TEAM_ID, playerCarIdsFor } from "@/fixtures/grid";
import { useRaceWorker } from "@/hooks/use-race-worker";
import { DEFAULT_SEED } from "@/simulation/engine";
import { RaceReplayRecorder, type RaceReplayRecording, type ReplayEventValue } from "@/simulation/race-replay";
import { buildRaceReport } from "@/simulation/race-report";
import { buildRaceStartingTyrePlan } from "@/simulation/starting-tyre-strategy";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { chooseRaceStartTyreSet, type RaceStartTyreSelection } from "@/simulation/tyre-allocation";
import { createSpatialWeather } from "@/simulation/weather";
import {
  abortQualifyingLap,
  coolDownQualifyingCar,
  createWeekendState,
  latestWeekendReport,
  raceSetupPerformanceFactor,
  recallQualifyingCar,
  reserveRacePreparationTyreSet,
  releaseQualifyingCar,
  runWeekendSession,
  setLiveQualifyingSpeed,
  setQualifyingAttackMode,
  setQualifyingFuelPlan,
  setQualifyingOutLapMode,
  setQualifyingTyreSet,
  setWeekendCarSetup,
  skipLiveQualifyingSession,
  startLiveQualifying,
  tickLiveQualifying,
  toggleLiveQualifyingPause,
  type WeekendSessionReport,
} from "@/simulation/weekend";
import { useRaceStore } from "@/store/race-store";

function freshWeekendSeed(): number {
  const entropy = typeof crypto !== "undefined" && "getRandomValues" in crypto
    ? crypto.getRandomValues(new Uint32Array(1))[0]
    : Date.now() >>> 0;
  return (DEFAULT_SEED ^ (Date.now() >>> 0) ^ entropy) >>> 0;
}

export function RaceShell() {
  const controls = useRaceWorker();
  const [selectedTeamId, setSelectedTeamId] = useState(DEFAULT_PLAYER_TEAM_ID);
  const [teamConfirmed, setTeamConfirmed] = useState(false);
  const [startPhase, setStartPhase] = useState<RaceStartPhase>("MENU");
  const [lightsOn, setLightsOn] = useState(0);
  const [weekend, setWeekend] = useState(() => createWeekendState(DEFAULT_SEED, DEFAULT_PLAYER_TEAM_ID));
  const [startingTyres, setStartingTyres] = useState<Record<string, RaceStartTyreSelection>>(() => Object.fromEntries(playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID).map((carId) => [carId, chooseRaceStartTyreSet(carId, "MEDIUM")])));
  const [activeWeekendReport, setActiveWeekendReport] = useState<WeekendSessionReport | null>(null);
  const [replayRecording, setReplayRecording] = useState<RaceReplayRecording | null>(null);
  const [strategyCarId, setStrategyCarId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const startTimers = useRef<number[]>([]);
  const replayRecorder = useRef(new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID) }));
  const pendingReplayReset = useRef<{ expectedSeed: number; expectedStartingTyres: Readonly<Record<string, TyreCompound>> | null } | null>(null);
  const finalReportOpened = useRef(false);
  const presentedWeekendReports = useRef(0);
  const qualifyingTickCarry = useRef(0);
  const raceTyreDefaultsSeed = useRef<number | null>(null);
  const snapshot = useRaceStore((state) => state.snapshot);
  const speed = useRaceStore((state) => state.speed);
  const paused = useRaceStore((state) => state.paused);
  const error = useRaceStore((state) => state.error);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const setSelectedCarId = useRaceStore((state) => state.setSelectedCarId);
  const playerCarIds = playerCarIdsFor(selectedTeamId);
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
  const selectedCarActive = Boolean(selectedCar
    && selectedCar.teamId === snapshot?.playerTeamId
    && !selectedCar.finished
    && selectedCar.incidentStatus !== "RETIRED");
  const raceControlLabel = snapshot?.raceControl === "YELLOW"
    ? "YELLOW"
    : snapshot?.raceControl === "SAFETY_CAR"
      ? snapshot.safetyCarPhase === "RESTART" ? "SAFETY CAR ENDING" : "SAFETY CAR"
      : snapshot?.raceControl === "VSC" ? "VIRTUAL SAFETY CAR" : snapshot?.raceControl.replace("_", " ") ?? "GREEN";
  const qualifyingLiveSession = weekend.qualifyingLive?.session;
  const qualifyingLiveStatus = weekend.qualifyingLive?.status;
  const qualifyingLivePaused = weekend.qualifyingLive?.paused ?? false;
  const qualifyingLiveSpeed = weekend.qualifyingLive?.speed ?? 1;

  useEffect(() => () => {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const pendingReset = pendingReplayReset.current;
    if (pendingReset) {
      const resetSnapshotArrived = snapshot.seed === pendingReset.expectedSeed && snapshot.tick === 0 && snapshot.elapsedTime === 0;
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

  useEffect(() => {
    if (snapshot?.status !== "FINISHED" || !replayRecording?.frames.length || finalReportOpened.current) return;
    finalReportOpened.current = true;
    setReportOpen(true);
  }, [replayRecording, snapshot?.status]);

  useEffect(() => {
    if (weekend.sessionReports.length <= presentedWeekendReports.current) return;
    presentedWeekendReports.current = weekend.sessionReports.length;
    setActiveWeekendReport(latestWeekendReport(weekend));
  }, [weekend]);

  useEffect(() => {
    if (weekend.currentSession !== "RACE" || raceTyreDefaultsSeed.current === weekend.seed) return;
    const plan = buildRaceStartingTyrePlan({
      seed: weekend.seed,
      gridOrder: weekend.gridOrder,
      tyreUsage: weekend.tyreUsage,
      weather: createSpatialWeather(weekend.seed),
    });
    const defaults = Object.fromEntries(playerCarIdsFor(selectedTeamId).map((carId) => [carId, chooseRaceStartTyreSet(carId, plan[carId].compound, weekend.tyreInventory)]));
    raceTyreDefaultsSeed.current = weekend.seed;
    setStartingTyres(defaults);
  }, [selectedTeamId, weekend.currentSession, weekend.gridOrder, weekend.seed, weekend.tyreInventory, weekend.tyreUsage]);

  useEffect(() => {
    if ((qualifyingLiveStatus !== "RUNNING" && qualifyingLiveStatus !== "CHECKERED") || qualifyingLivePaused) return;
    qualifyingTickCarry.current = 0;
    let lastWallTime = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedWallSeconds = Math.min(0.15, Math.max(0, (now - lastWallTime) / 1_000));
      lastWallTime = now;
      qualifyingTickCarry.current += elapsedWallSeconds * qualifyingLiveSpeed;
      const wholeSeconds = Math.floor(qualifyingTickCarry.current);
      if (wholeSeconds < 1) return;
      qualifyingTickCarry.current -= wholeSeconds;
      setWeekend((current) => {
        const live = current.qualifyingLive;
        if (!live || (live.status !== "RUNNING" && live.status !== "CHECKERED")) return current;
        return tickLiveQualifying(current, wholeSeconds);
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [qualifyingLivePaused, qualifyingLiveSession, qualifyingLiveSpeed, qualifyingLiveStatus]);

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
    setTeamOrder: (order) => { annotateCommand(selectedCar?.carId ?? playerCarIds[0], `Team order ${order}`, { order }); controls.setTeamOrder(order); },
    box: (carId, compound) => { const car = commandableCar(carId); if (!car || car.pitStatus !== "TRACK") return; annotateCommand(carId, `Box this lap for ${compound}`, { compound }); controls.box(carId, compound); },
    servePenalty: (carId) => { const car = commandableCar(carId); if (!car || car.pitStatus !== "TRACK") return; annotateCommand(carId, "Serve mandatory penalty this lap", { command: "SERVE_PENALTY" }); controls.servePenalty(carId); },
    stayOut: (carId) => { const car = commandableCar(carId); if (!car || car.pitStatus !== "TRACK" || !car.scheduledPitCompound) return; annotateCommand(carId, "Stay out", { command: "STAY_OUT" }); controls.stayOut(carId); },
  };

  function clearStartTimers() {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
    startTimers.current = [];
  }

  function startRace() {
    clearStartTimers();
    pendingReplayReset.current = { expectedSeed: weekend.seed, expectedStartingTyres: Object.fromEntries(Object.entries(startingTyres).map(([carId, selection]) => [carId, selection.compound])) };
    replayRecorder.current.reset();
    setReplayRecording(null);
    finalReportOpened.current = false;
    const setupPerformanceByCar = Object.fromEntries(Object.entries(weekend.setups).map(([carId, setup]) => [carId, raceSetupPerformanceFactor(setup, weekend.seed, carId)]));
    controls.reset(weekend.seed, weekend.gridOrder, weekend.tyreUsage, setupPerformanceByCar, selectedTeamId, weekend.tyreInventory);
    playerCarIds.forEach((carId) => controls.setStartingTyre(carId, startingTyres[carId].compound, startingTyres[carId].id));
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
    replayRecorder.current.reset();
    setReplayRecording(null);
    finalReportOpened.current = false;
    setLightsOn(0);
    setStartPhase("MENU");
    setStrategyCarId(null);
    setReportOpen(false);
    setActiveWeekendReport(null);
    presentedWeekendReports.current = 0;
    raceTyreDefaultsSeed.current = null;
    setTeamConfirmed(false);
    setStartingTyres(Object.fromEntries(playerCarIds.map((carId) => [carId, chooseRaceStartTyreSet(carId, "MEDIUM")])));
    const nextSeed = freshWeekendSeed();
    pendingReplayReset.current = { expectedSeed: nextSeed, expectedStartingTyres: null };
    controls.reset(nextSeed, undefined, undefined, undefined, selectedTeamId);
    setWeekend(createWeekendState(nextSeed, selectedTeamId));
  }

  function runCurrentWeekendSession() {
    const next = runWeekendSession(weekend);
    setWeekend(next);
  }

  function confirmTeamSelection() {
    const carIds = playerCarIdsFor(selectedTeamId);
    const tyres = Object.fromEntries(carIds.map((carId) => [carId, chooseRaceStartTyreSet(carId, "MEDIUM")]));
    const weekendSeed = freshWeekendSeed();
    setWeekend(createWeekendState(weekendSeed, selectedTeamId));
    raceTyreDefaultsSeed.current = null;
    setStartingTyres(tyres);
    setActiveWeekendReport(null);
    presentedWeekendReports.current = 0;
    setSelectedCarId(carIds[0]);
    replayRecorder.current = new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: carIds });
    pendingReplayReset.current = { expectedSeed: weekendSeed, expectedStartingTyres: null };
    controls.reset(weekendSeed, undefined, undefined, undefined, selectedTeamId);
    setTeamConfirmed(true);
  }

  if (error) {
    return <main className="fatal-state"><span>SIMULATION LINK ERROR</span><h1>{error}</h1><button onClick={() => window.location.reload()}>Reload pitwall</button></main>;
  }

  if (startPhase === "MENU" && teamConfirmed && weekend.currentSession.startsWith("Q")) {
    return (
      <QualifyingRaceView
        activeReport={activeWeekendReport}
        onAbortLap={(carId) => setWeekend((current) => abortQualifyingLap(current, carId))}
        onAttackModeChange={(carId, mode) => setWeekend((current) => setQualifyingAttackMode(current, carId, mode))}
        onCloseReport={() => setActiveWeekendReport(null)}
        onCoolDown={(carId) => setWeekend((current) => coolDownQualifyingCar(current, carId))}
        onFuelPlanChange={(carId, plan) => setWeekend((current) => setQualifyingFuelPlan(current, carId, plan))}
        onOutLapModeChange={(carId, mode) => setWeekend((current) => setQualifyingOutLapMode(current, carId, mode))}
        onPause={() => setWeekend((current) => toggleLiveQualifyingPause(current))}
        onRelease={(carId) => setWeekend((current) => releaseQualifyingCar(current, carId))}
        onReset={resetToMenu}
        onReturnToPits={(carId) => setWeekend((current) => recallQualifyingCar(current, carId))}
        onSelectCar={setSelectedCarId}
        onSkipSession={() => setWeekend((current) => skipLiveQualifyingSession(current))}
        onSpeedChange={(qualifyingSpeed) => setWeekend((current) => setLiveQualifyingSpeed(current, qualifyingSpeed))}
        onStart={() => setWeekend((current) => startLiveQualifying(current))}
        onTyreSetChange={(carId, tyreSetId) => setWeekend((current) => setQualifyingTyreSet(current, carId, tyreSetId))}
        selectedCarId={selectedCarId}
        state={weekend}
      />
    );
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
          onStartingTyreChange={(carId, selection) => {
            setStartingTyres((current) => ({ ...current, [carId]: selection }));
            setWeekend((current) => reserveRacePreparationTyreSet(current, carId, selection.id));
          }}
          startingTyres={startingTyres}
          state={weekend}
        />
      )}
      <RaceTopbar
        snapshot={snapshot}
        speed={speed}
        paused={paused}
        startPhase={startPhase}
        onPlay={controls.play}
        onPause={controls.pause}
        onSetSpeed={controls.setSpeed}
        onReset={resetToMenu}
      />

      <section className="race-grid">
        <TimingTower />
        <section className="map-column">
          <div className="circuit-title">
            <div><span className="eyebrow">ROUND 09 · GREAT BRITAIN · 5.891 KM · 18 TURNS</span><h1>{SILVERSTONE_CIRCUIT.name}</h1></div>
            <div className="operations-launcher">
              <button aria-label="Open strategy intelligence" disabled={!snapshot || !selectedCarActive} onClick={() => setStrategyCarId(selectedCar?.carId ?? null)} type="button"><BrainCircuit aria-hidden="true" size={14} /><span>STRATEGY</span></button>
              <button aria-label="Open race report" disabled={!snapshot || !replayRecording?.frames.length} onClick={() => { controls.pause(); setReportOpen(true); }} type="button"><Trophy aria-hidden="true" size={14} /><span>REPORT</span></button>
              <div className={`live-pill live-pill--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}><i /> {startPhase === "RACING" ? (paused ? "PAUSED" : snapshot?.raceControl === "GREEN" ? `${speed}× LIVE` : raceControlLabel) : "ON GRID"}</div>
            </div>
          </div>
          <RaceMap startPhase={startPhase} lightsOn={lightsOn} />
          <div className="command-strip">
            <CommandDock car={selectedCar} controls={commandControls} pitLaneOpen={snapshot?.pitLaneOpen !== false} />
          </div>
        </section>
        <CarStatusPanel />
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
      {reportOpen && snapshot && replayRecording && (
        <ReplayReportPanel
          onClose={() => setReportOpen(false)}
          open
          report={buildRaceReport(snapshot, { recording: replayRecording })}
        />
      )}

      <EnergyDebugPanel onAction={controls.debugEnergy} snapshot={snapshot} />

    </main>
  );
}
