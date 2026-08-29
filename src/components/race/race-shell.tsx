"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, Flag, HardDrive, Settings2, Trophy } from "lucide-react";

import type { RaceSnapshot, TyreCompound } from "@/domain/race";
import { CarStatusPanel } from "@/components/race/car-status";
import { ChampionshipHub } from "@/components/race/championship-hub";
import { CommandDock, type CommandDockControls } from "@/components/race/command-dock";
import { AiDebugOverlay } from "@/components/race/ai-debug-overlay";
import { EnergyDebugPanel } from "@/components/race/energy-debug-panel";
import { tyreSetLabel } from "@/components/race/format";
import { RaceMap } from "@/components/race/race-map";
import { FirstWeekendTour } from "@/components/race/first-weekend-tour";
import { QualifyingRaceView } from "@/components/race/qualifying-race-view";
import { ReplayReportPanel } from "@/components/race/replay-report-panel";
import { SaveManager } from "@/components/race/save-manager";
import { PitwallPreferences, type PitwallPreferencesState } from "@/components/race/pitwall-preferences";
import { RaceTopbar, type RaceStartPhase } from "@/components/race/race-topbar";
import { TimingTower } from "@/components/race/timing-tower";
import { StrategyIntelligencePanel } from "@/components/race/strategy-intelligence-panel";
import { TeamSelection } from "@/components/race/team-selection";
import { WeekendHub } from "@/components/race/weekend-hub";
import { DEFAULT_PLAYER_TEAM_ID, playerCarIdsFor } from "@/fixtures/grid";
import { useRaceWorker } from "@/hooks/use-race-worker";
import { usePitwallAudio } from "@/hooks/use-pitwall-audio";
import { DEFAULT_SEED } from "@/simulation/engine";
import { RaceReplayRecorder, type RaceReplayRecording, type ReplayEventValue } from "@/simulation/race-replay";
import { buildRaceReport } from "@/simulation/race-report";
import { createGameSave, parseGameSave, stringifyGameSave } from "@/simulation/game-save";
import { createChampionship, currentChampionshipRound, recordRoundResult, type ChampionshipState } from "@/simulation/championship";
import { applyGridPenaltyToCars, applySeededWeekendWear, assessReliability, consumePendingGridPenalty, createReliabilityState, performBetweenRoundMaintenance, type MaintenanceAction, type ReliabilityState } from "@/simulation/reliability";
import { buildRaceStartingTyrePlan } from "@/simulation/starting-tyre-strategy";
import { circuitById } from "@/simulation/track";
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

function CircuitCountryFlag({ country }: { country: string }) {
  if (country !== "United Kingdom") return <Flag aria-hidden="true" size={15} strokeWidth={2.2} />;
  return (
    <svg aria-hidden="true" className="circuit-title__flag" viewBox="0 0 24 16">
      <rect fill="#173b80" height="16" rx="2" width="24" />
      <path d="M0 0 24 16M24 0 0 16" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 24 16M24 0 0 16" fill="none" stroke="#cf2027" strokeWidth="1.7" />
      <path d="M12 0v16M0 8h24" fill="none" stroke="#fff" strokeWidth="5" />
      <path d="M12 0v16M0 8h24" fill="none" stroke="#cf2027" strokeWidth="2.6" />
    </svg>
  );
}

const AUTOSAVE_KEY = "project-pitwall:game-save:v1";
const TOUR_KEY = "project-pitwall:first-weekend-tour:v1";
const PREFERENCES_KEY = "project-pitwall:preferences:v1";
const DEFAULT_PREFERENCES: PitwallPreferencesState = { audioEnabled: true, volume: 0.7, reducedMotion: false, highContrast: false };
const QUALIFYING_TICK_INTERVAL_MS = 100;
const QUALIFYING_MAX_WALL_DELTA_SECONDS = 0.25;

function loadPreferences(): PitwallPreferencesState {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "null") as Partial<PitwallPreferencesState> | null;
    if (!parsed) return DEFAULT_PREFERENCES;
    return {
      audioEnabled: typeof parsed.audioEnabled === "boolean" ? parsed.audioEnabled : DEFAULT_PREFERENCES.audioEnabled,
      volume: typeof parsed.volume === "number" && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_PREFERENCES.volume,
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : DEFAULT_PREFERENCES.reducedMotion,
      highContrast: typeof parsed.highContrast === "boolean" ? parsed.highContrast : DEFAULT_PREFERENCES.highContrast,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function applyGridDropLabel(penaltyPlaces: number): string {
  return penaltyPlaces > 0 ? ` · ${penaltyPlaces}-PLACE GRID DROP` : "";
}

function championshipResultFromSnapshot(snapshot: RaceSnapshot, championship: ChampionshipState) {
  const report = buildRaceReport(snapshot);
  const round = currentChampionshipRound(championship);
  if (!round) return null;
  const winnerDistance = Math.max(1, ...snapshot.cars.map((car) => car.totalDistance));
  return {
    roundNumber: round.roundNumber,
    circuitId: round.circuitId,
    fastestLapDriverId: report.fastestLap?.carId ?? null,
    classification: report.classification.map((entry) => ({
      position: entry.position,
      driverId: entry.driverId,
      teamId: entry.teamId,
      status: entry.status === "RETIRED" || entry.status === "DISQUALIFIED"
        ? { type: "RETIRED" as const, classified: entry.status !== "DISQUALIFIED" && snapshot.cars.find((car) => car.carId === entry.carId)!.totalDistance >= winnerDistance * 0.9, reason: entry.retiredReason ?? entry.status }
        : { type: "FINISHED" as const },
    })),
  };
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
  const [championship, setChampionship] = useState(() => createChampionship());
  const [reliability, setReliability] = useState<ReliabilityState>(() => createReliabilityState());
  const [championshipOpen, setChampionshipOpen] = useState(false);
  const [saveManagerOpen, setSaveManagerOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hasAutosave, setHasAutosave] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourForced, setTourForced] = useState(false);
  const [preferences, setPreferences] = useState<PitwallPreferencesState>(loadPreferences);
  const startTimers = useRef<number[]>([]);
  const replayRecorder = useRef(new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID) }));
  const pendingReplayReset = useRef<{ expectedSeed: number; expectedStartingTyres: Readonly<Record<string, TyreCompound>> | null } | null>(null);
  const finalReportOpened = useRef(false);
  const recordedRaceKey = useRef<string | null>(null);
  const lastAutosaveTick = useRef(-1);
  const presentedWeekendReports = useRef(0);
  const qualifyingTickCarry = useRef(0);
  const raceTyreDefaultsSeed = useRef<number | null>(null);
  const snapshot = useRaceStore((state) => state.snapshot);
  const speed = useRaceStore((state) => state.speed);
  const paused = useRaceStore((state) => state.paused);
  const error = useRaceStore((state) => state.error);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const setSelectedCarId = useRaceStore((state) => state.setSelectedCarId);
  const saveStateReady = Boolean(snapshot
    && snapshot.seed === weekend.seed
    && snapshot.circuitId === weekend.circuitId
    && snapshot.playerTeamId === weekend.playerTeamId);
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
  const circuit = circuitById(weekend.circuitId);
  usePitwallAudio(snapshot, { enabled: preferences.audioEnabled, volume: preferences.volume });

  useEffect(() => () => {
    startTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const serialized = window.localStorage.getItem(AUTOSAVE_KEY);
      setHasAutosave(Boolean(serialized));
      if (serialized) {
        try { setLastSavedAt(parseGameSave(serialized).savedAt); } catch { window.localStorage.removeItem(AUTOSAVE_KEY); }
      }
      setTourOpen(window.localStorage.getItem(TOUR_KEY) !== "complete");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    document.documentElement.dataset.pitwallReducedMotion = String(preferences.reducedMotion);
    document.documentElement.dataset.pitwallHighContrast = String(preferences.highContrast);
    return () => {
      delete document.documentElement.dataset.pitwallReducedMotion;
      delete document.documentElement.dataset.pitwallHighContrast;
    };
  }, [preferences]);

  const saveGame = useCallback(() => {
    if (!snapshot
      || snapshot.seed !== weekend.seed
      || snapshot.circuitId !== weekend.circuitId
      || snapshot.playerTeamId !== weekend.playerTeamId) return;
    const savedAt = new Date().toISOString();
    const save = createGameSave({ savedAt, raceSnapshot: snapshot, weekendState: weekend, championshipState: championship, reliabilityState: reliability });
    window.localStorage.setItem(AUTOSAVE_KEY, stringifyGameSave(save));
    setHasAutosave(true);
    setLastSavedAt(savedAt);
  }, [championship, reliability, snapshot, weekend]);

  const restoreSave = useCallback((serialized: string) => {
    const save = parseGameSave(serialized);
    const restoredPlayerCars = playerCarIdsFor(save.weekendState.playerTeamId);
    replayRecorder.current = new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: restoredPlayerCars });
    const restoredRecording = replayRecorder.current.record(save.raceSnapshot);
    setReplayRecording(restoredRecording);
    pendingReplayReset.current = null;
    lastAutosaveTick.current = save.raceSnapshot.tick;
    recordedRaceKey.current = save.raceSnapshot.status === "FINISHED" ? `${save.raceSnapshot.seed}:${save.raceSnapshot.circuitId}` : null;
    setWeekend(save.weekendState);
    setSelectedTeamId(save.weekendState.playerTeamId);
    setTeamConfirmed(true);
    setChampionship(save.championshipState ?? createChampionship());
    setReliability(save.reliabilityState ?? createReliabilityState());
    setSelectedCarId(restoredPlayerCars[0]);
    setStartPhase(save.raceSnapshot.elapsedTime > 0 ? "RACING" : "MENU");
    setLightsOn(0);
    setReportOpen(false);
    setChampionshipOpen(false);
    setSaveManagerOpen(false);
    finalReportOpened.current = save.raceSnapshot.status === "FINISHED";
    controls.loadSnapshot(save.raceSnapshot, 1, true);
    setLastSavedAt(save.savedAt);
    setHasAutosave(true);
  }, [controls, setSelectedCarId]);

  useEffect(() => {
    if (!snapshot || !teamConfirmed) return;
    const due = snapshot.status === "FINISHED" || snapshot.tick === 0 || snapshot.tick - lastAutosaveTick.current >= 100;
    if (!due) return;
    lastAutosaveTick.current = snapshot.tick;
    saveGame();
  }, [saveGame, snapshot, teamConfirmed]);

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
    const recorderSeed = replayRecorder.current.toRecording().seed;
    if (recorderSeed !== null && recorderSeed !== snapshot.seed) return;
    const recording = replayRecorder.current.record(snapshot);
    setReplayRecording((current) => current?.endedAt === recording.endedAt && current.events.length === recording.events.length && current.frames.length === recording.frames.length ? current : recording);
  }, [snapshot, selectedTeamId]);

  useEffect(() => {
    if (snapshot?.status !== "FINISHED" || !replayRecording?.frames.length || finalReportOpened.current) return;
    finalReportOpened.current = true;
    setReportOpen(true);
  }, [replayRecording, snapshot?.status]);

  useEffect(() => {
    if (!snapshot || snapshot.status !== "FINISHED") return;
    const resultKey = `${snapshot.seed}:${snapshot.circuitId}`;
    if (recordedRaceKey.current === resultKey) return;
    const roundResult = championshipResultFromSnapshot(snapshot, championship);
    if (!roundResult) return;
    recordedRaceKey.current = resultKey;
    const thermalStress = Math.min(1, snapshot.cars.reduce((sum, car) => sum + (car.thermalRiskPercent ?? 0), 0) / Math.max(1, snapshot.cars.length * 100));
    const timer = window.setTimeout(() => {
      setChampionship((current) => recordRoundResult(current, roundResult));
      setReliability((current) => applySeededWeekendWear(current, {
        seed: snapshot.seed,
        round: roundResult.roundNumber,
        distanceKm: circuitById(snapshot.circuitId).lengthMeters * circuitById(snapshot.circuitId).totalLaps / 1_000,
        thermalStress,
      }).state);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [championship, snapshot]);

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
      weather: createSpatialWeather(weekend.seed, 0, { trackLengthMeters: circuit.lengthMeters }),
    });
    const defaults = Object.fromEntries(playerCarIdsFor(selectedTeamId).map((carId) => [carId, chooseRaceStartTyreSet(carId, plan[carId].compound, weekend.tyreInventory)]));
    raceTyreDefaultsSeed.current = weekend.seed;
    setStartingTyres(defaults);
  }, [circuit.lengthMeters, selectedTeamId, weekend.currentSession, weekend.gridOrder, weekend.seed, weekend.tyreInventory, weekend.tyreUsage]);

  useEffect(() => {
    if ((qualifyingLiveStatus !== "RUNNING" && qualifyingLiveStatus !== "CHECKERED") || qualifyingLivePaused) return;
    qualifyingTickCarry.current = 0;
    let lastWallTime = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedWallSeconds = Math.min(QUALIFYING_MAX_WALL_DELTA_SECONDS, Math.max(0, (now - lastWallTime) / 1_000));
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
    }, QUALIFYING_TICK_INTERVAL_MS);
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
    box: (carId, compound, tyreSetId) => {
      const car = commandableCar(carId);
      if (!car || car.pitStatus !== "TRACK") return;
      const set = tyreSetId ? car.tyreSets.find((candidate) => candidate.id === tyreSetId) : undefined;
      const detail = set ? `${compound} set ${tyreSetLabel(set.id)} · ${Math.round(set.condition)}% life` : compound;
      annotateCommand(carId, `Box this lap for ${detail}`, { compound, tyreSetId: tyreSetId ?? "AUTO" });
      controls.box(carId, compound, tyreSetId);
    },
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
    const reliabilityAssessment = assessReliability(reliability, { horizonKm: circuit.lengthMeters * circuit.totalLaps / 1_000 });
    const penalty = consumePendingGridPenalty(reliability);
    const raceGridOrder = applyGridPenaltyToCars(weekend.gridOrder, playerCarIds, penalty.penaltyPlaces);
    const reliabilityByCar = Object.fromEntries(playerCarIds.map((carId) => [carId, {
      conditionPercent: Math.min(...Object.values(reliability.components).map((component) => component.health)),
      failureRiskPercent: reliabilityAssessment.failureRiskPercent,
      performanceDeratePercent: reliabilityAssessment.performanceDeratePercent,
      limitingComponent: reliabilityAssessment.limitingComponent,
    }]));
    if (penalty.penaltyPlaces > 0) setWeekend((current) => ({ ...current, gridOrder: raceGridOrder }));
    setReliability(penalty.state);
    controls.reset(weekend.seed, raceGridOrder, weekend.tyreUsage, setupPerformanceByCar, selectedTeamId, weekend.tyreInventory, weekend.circuitId, reliabilityByCar);
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
    const firstChampionship = createChampionship();
    const firstCircuitId = currentChampionshipRound(firstChampionship)!.circuitId;
    setChampionship(firstChampionship);
    setReliability(createReliabilityState());
    recordedRaceKey.current = null;
    controls.reset(nextSeed, undefined, undefined, undefined, selectedTeamId, undefined, firstCircuitId);
    setWeekend(createWeekendState(nextSeed, selectedTeamId, firstCircuitId));
  }

  function runCurrentWeekendSession() {
    const next = runWeekendSession(weekend);
    setWeekend(next);
  }

  function confirmTeamSelection() {
    const carIds = playerCarIdsFor(selectedTeamId);
    const tyres = Object.fromEntries(carIds.map((carId) => [carId, chooseRaceStartTyreSet(carId, "MEDIUM")]));
    const weekendSeed = freshWeekendSeed();
    const firstCircuitId = currentChampionshipRound(championship)?.circuitId ?? circuit.id;
    setWeekend(createWeekendState(weekendSeed, selectedTeamId, firstCircuitId));
    raceTyreDefaultsSeed.current = null;
    setStartingTyres(tyres);
    setActiveWeekendReport(null);
    presentedWeekendReports.current = 0;
    setSelectedCarId(carIds[0]);
    replayRecorder.current = new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 1_800, watchedCarIds: carIds });
    pendingReplayReset.current = { expectedSeed: weekendSeed, expectedStartingTyres: null };
    controls.reset(weekendSeed, undefined, undefined, undefined, selectedTeamId, undefined, firstCircuitId);
    setTeamConfirmed(true);
  }

  function openChampionship() {
    setReportOpen(false);
    setChampionshipOpen(true);
  }

  function startNextChampionshipRound() {
    const round = currentChampionshipRound(championship);
    if (!round) return;
    const nextSeed = (freshWeekendSeed() ^ round.roundNumber * 97_003) >>> 0;
    const nextWeekend = createWeekendState(nextSeed, selectedTeamId, round.circuitId);
    recordedRaceKey.current = null;
    finalReportOpened.current = false;
    raceTyreDefaultsSeed.current = null;
    setWeekend(nextWeekend);
    setStartingTyres(Object.fromEntries(playerCarIds.map((carId) => [carId, chooseRaceStartTyreSet(carId, "MEDIUM", nextWeekend.tyreInventory)])));
    setStartPhase("MENU");
    setReportOpen(false);
    setChampionshipOpen(false);
    setReplayRecording(null);
    setActiveWeekendReport(null);
    presentedWeekendReports.current = 0;
    controls.reset(nextSeed, undefined, undefined, undefined, selectedTeamId, nextWeekend.tyreInventory, round.circuitId);
  }

  function performMaintenance(actions: readonly MaintenanceAction[]) {
    const nextRound = currentChampionshipRound(championship)?.roundNumber;
    if (!nextRound || nextRound <= reliability.currentRound) return;
    setReliability((current) => performBetweenRoundMaintenance(current, nextRound, actions).state);
  }

  function exportSave() {
    if (!snapshot || !saveStateReady) return;
    const save = createGameSave({ savedAt: new Date().toISOString(), raceSnapshot: snapshot, weekendState: weekend, championshipState: championship, reliabilityState: reliability });
    const blob = new Blob([stringifyGameSave(save)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `project-pitwall-${circuit.shortName.toLowerCase()}-${save.savedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const systemUtilities = (
    <nav aria-label="Pitwall system tools" className="pitwall-system-tools">
      <button aria-label="Open save manager" disabled={!saveStateReady} onClick={() => { controls.pause(); setSaveManagerOpen(true); }} title="Save and restore" type="button"><HardDrive aria-hidden="true" size={16} /><span>SAVE</span></button>
      <button aria-label="Open championship" disabled={!teamConfirmed} onClick={() => setChampionshipOpen(true)} title={`Championship${applyGridDropLabel(reliability.pendingGridPenaltyPlaces)}`} type="button"><Trophy aria-hidden="true" size={16} /><span>SEASON</span>{reliability.pendingGridPenaltyPlaces > 0 && <b>{reliability.pendingGridPenaltyPlaces}</b>}</button>
      <button aria-label="Open display and audio settings" onClick={() => setPreferencesOpen(true)} title="Display and audio settings" type="button"><Settings2 aria-hidden="true" size={16} /><span>SETTINGS</span></button>
    </nav>
  );

  const systemOverlays = (
    <>
      {championshipOpen && <ChampionshipHub championship={championship} onClose={() => setChampionshipOpen(false)} onMaintenance={performMaintenance} onStartRound={startNextChampionshipRound} reliability={reliability} />}
      {saveManagerOpen && <SaveManager hasAutosave={hasAutosave} lastSavedAt={lastSavedAt} onClose={() => setSaveManagerOpen(false)} onExport={exportSave} onImport={async (file) => restoreSave(await file.text())} onLoadAutosave={() => { const serialized = window.localStorage.getItem(AUTOSAVE_KEY); if (serialized) restoreSave(serialized); }} onSave={saveGame} />}
      {preferencesOpen && <PitwallPreferences onChange={setPreferences} onClose={() => setPreferencesOpen(false)} onReplayTour={() => { window.localStorage.removeItem(TOUR_KEY); setPreferencesOpen(false); setTourForced(true); setTourOpen(true); }} value={preferences} />}
    </>
  );

  if (error) {
    return <main className="fatal-state"><span>SIMULATION LINK ERROR</span><h1>{error}</h1><button onClick={() => window.location.reload()}>Reload pitwall</button></main>;
  }

  if (startPhase === "MENU" && teamConfirmed && weekend.currentSession.startsWith("Q")) {
    return (
      <><QualifyingRaceView
        activeReport={activeWeekendReport}
        onAbortLap={(carId) => setWeekend((current) => abortQualifyingLap(current, carId))}
        onAttackModeChange={(carId, mode) => setWeekend((current) => setQualifyingAttackMode(current, carId, mode))}
        onCloseReport={() => setActiveWeekendReport(null)}
        onOpenChampionship={() => setChampionshipOpen(true)}
        onOpenPreferences={() => setPreferencesOpen(true)}
        onOpenSave={() => { controls.pause(); setSaveManagerOpen(true); }}
        onCoolDown={(carId) => setWeekend((current) => coolDownQualifyingCar(current, carId))}
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
        pendingGridPenaltyPlaces={reliability.pendingGridPenaltyPlaces}
        saveReady={saveStateReady}
        selectedCarId={selectedCarId}
        state={weekend}
      />{systemOverlays}{tourOpen && <FirstWeekendTour onComplete={() => { window.localStorage.setItem(TOUR_KEY, "complete"); setTourForced(false); setTourOpen(false); }} />}</>
    );
  }

  return (
    <main className="pitwall-shell" data-high-contrast={preferences.highContrast} data-reduced-motion={preferences.reducedMotion}>
      {startPhase === "MENU" && !teamConfirmed && (
        <TeamSelection circuitName={circuit.shortName} onConfirm={confirmTeamSelection} onSelect={setSelectedTeamId} selectedTeamId={selectedTeamId} />
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
      <div aria-hidden={startPhase === "MENU" ? true : undefined} className="race-surface" inert={startPhase === "MENU" ? true : undefined}>
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
            <div>
              <span className="eyebrow circuit-title__eyebrow">
                <CircuitCountryFlag country={circuit.country} />
                <span>{circuit.country.toUpperCase()} · {(circuit.lengthMeters / 1_000).toFixed(3)} KM · {circuit.turns} TURNS</span>
              </span>
              <h1>{circuit.name}</h1>
            </div>
            <div className="operations-launcher">
              <button aria-label="Open save manager" disabled={!saveStateReady} onClick={() => { controls.pause(); setSaveManagerOpen(true); }} title="Save and restore" type="button"><HardDrive aria-hidden="true" size={14} /><span>SAVE</span></button>
              <button aria-label="Open championship" onClick={() => setChampionshipOpen(true)} title={`Championship${applyGridDropLabel(reliability.pendingGridPenaltyPlaces)}`} type="button"><Trophy aria-hidden="true" size={14} /><span>SEASON</span>{reliability.pendingGridPenaltyPlaces > 0 && <b>{reliability.pendingGridPenaltyPlaces}</b>}</button>
              <button aria-label="Open display and audio settings" onClick={() => setPreferencesOpen(true)} title="Display and audio settings" type="button"><Settings2 aria-hidden="true" size={14} /><span>SETTINGS</span></button>
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
      </div>

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
          onContinue={snapshot.status === "FINISHED" ? openChampionship : undefined}
          continueLabel={championship.status === "COMPLETED" ? "View championship" : "Next round"}
          open
          report={buildRaceReport(snapshot, { recording: replayRecording })}
        />
      )}

      {startPhase === "MENU" && systemUtilities}
      {systemOverlays}
      {tourOpen && (teamConfirmed || tourForced) && <FirstWeekendTour onComplete={() => { window.localStorage.setItem(TOUR_KEY, "complete"); setTourForced(false); setTourOpen(false); }} />}

      <EnergyDebugPanel onAction={controls.debugEnergy} snapshot={snapshot} />
      <AiDebugOverlay />

    </main>
  );
}
