"use client";

import { BatteryCharging, CircleAlert, Crosshair, Gauge, Shield, Timer, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { CommandDockControls } from "@/components/race/command-dock";
import { TyreBadge } from "@/components/race/tyre-badge";
import type { RaceCarState, RaceSnapshot, TyreCompound } from "@/domain/race";
import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import { assessPitOperation } from "@/simulation/pit-operations";
import { calculateRacecraftDecision } from "@/simulation/racecraft";

import styles from "./race-operations-panel.module.css";

type OperationsTab = "RACECRAFT" | "PIT_STOP";
type RaceOperationsControls = Pick<CommandDockControls, "setPace" | "setEnergyMode" | "setCoolingMode" | "box" | "stayOut">;

export interface RaceOperationsPanelProps {
  snapshot: RaceSnapshot;
  car: RaceCarState;
  controls: RaceOperationsControls;
  initialTab?: OperationsTab;
  onClose: () => void;
}

const COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

function preferredCompound(snapshot: RaceSnapshot, car: RaceCarState): TyreCompound {
  if (snapshot.weather.trackWetness > 0.68) return "WET";
  if (snapshot.weather.trackWetness > 0.2) return "INTERMEDIATE";
  return car.tyreCompound === "MEDIUM" ? "HARD" : "MEDIUM";
}

export function RaceOperationsPanel({ snapshot, car, controls, initialTab = "RACECRAFT", onClose }: RaceOperationsPanelProps) {
  const [tab, setTab] = useState<OperationsTab>(initialTab);
  const [compound, setCompound] = useState<TyreCompound>(() => preferredCompound(snapshot, car));
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const driver = DRIVER_BY_ID.get(car.driverId);
  const team = TEAM_BY_ID.get(car.teamId);
  const teamColor = team ? `#${team.primaryColor.toString(16).padStart(6, "0")}` : "#20d7e7";
  const racecraft = useMemo(() => calculateRacecraftDecision({ raceControl: snapshot.raceControl, weather: snapshot.weather, cars: snapshot.cars }, car.carId), [car.carId, snapshot.cars, snapshot.raceControl, snapshot.weather]);
  const pit = useMemo(() => assessPitOperation({ seed: snapshot.seed, tick: snapshot.tick, elapsedTime: snapshot.elapsedTime, pitLaneOpen: snapshot.pitLaneOpen, cars: snapshot.cars }, car.carId, compound), [car.carId, compound, snapshot.cars, snapshot.elapsedTime, snapshot.pitLaneOpen, snapshot.seed, snapshot.tick]);
  const inactive = car.finished || car.incidentStatus === "RETIRED";

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, []);

  function applyRacecraftPlan() {
    controls.setPace(car.carId, racecraft.recommendedPaceMode);
    controls.setEnergyMode(car.carId, racecraft.recommendedEnergyMode);
    if (racecraft.intent === "HARVEST" && car.thermalDeratePercent >= 2.5) controls.setCoolingMode(car.carId, "LIFT_AND_COAST");
  }

  function applyPreset(preset: "ATTACK" | "DEFEND" | "RECHARGE") {
    if (preset === "ATTACK") { controls.setPace(car.carId, "ATTACK"); controls.setEnergyMode(car.carId, "ATTACK"); }
    else if (preset === "DEFEND") { controls.setPace(car.carId, "PUSH"); controls.setEnergyMode(car.carId, "DEFEND"); }
    else { controls.setPace(car.carId, car.thermalDeratePercent > 0 ? "COOL" : "CONSERVE"); controls.setEnergyMode(car.carId, "RECHARGE"); }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="race-operations-title" aria-modal="true" className={styles.dialog} ref={dialogRef} role="dialog" style={{ "--team-color": teamColor } as CSSProperties}>
        <header className={styles.header}>
          <span className={styles.mark}><Gauge aria-hidden="true" size={23} /></span>
          <div><span>LIVE COMMAND CENTRE · CAR #{driver?.number ?? "—"}</span><h2 id="race-operations-title">Race Operations 2.0</h2><small>{driver?.name ?? car.carId} · P{car.racePosition} · LAP {car.currentLap}</small></div>
          <div className={styles.tabs} role="tablist" aria-label="Race operations view">
            <button aria-selected={tab === "RACECRAFT"} onClick={() => setTab("RACECRAFT")} role="tab" type="button"><Crosshair size={14} />RACECRAFT</button>
            <button aria-selected={tab === "PIT_STOP"} onClick={() => setTab("PIT_STOP")} role="tab" type="button"><Wrench size={14} />PIT STOP</button>
          </div>
          <button aria-label="Close race operations" className={styles.close} onClick={onClose} ref={closeRef} type="button"><X size={19} /></button>
        </header>

        {tab === "RACECRAFT" ? (
          <div className={styles.racecraftView} role="tabpanel">
            <section className={styles.intentHero} data-intent={racecraft.intent}>
              <span className={styles.intentOrb}>{racecraft.intent === "ATTACK" ? <Crosshair size={28} /> : racecraft.intent === "DEFEND" ? <Shield size={28} /> : racecraft.intent === "HARVEST" ? <BatteryCharging size={28} /> : <Gauge size={28} />}</span>
              <div><span>AI RECOMMENDATION</span><strong>{racecraft.intent}</strong><small>{racecraft.reasons[0]}</small></div>
              <div className={styles.confidence}><span>CONFIDENCE</span><strong>{Math.round(racecraft.confidence * 100)}%</strong><i><b style={{ width: `${racecraft.confidence * 100}%` }} /></i></div>
              <button disabled={inactive} onClick={applyRacecraftPlan} type="button">APPLY {racecraft.recommendedPaceMode} / {racecraft.recommendedEnergyMode}</button>
            </section>

            <section className={styles.battleMap}>
              <article><span>CAR AHEAD</span><strong>{racecraft.targetCarId ? DRIVER_BY_ID.get(racecraft.targetCarId)?.shortName ?? racecraft.targetCarId : "CLEAR"}</strong><small>{Number.isFinite(car.gapToCarAhead) ? `${car.gapToCarAhead.toFixed(3)}s` : "—"}</small></article>
              <i className={styles.flowLine}><b style={{ width: `${racecraft.overtakeProbability * 100}%` }} /></i>
              <div className={styles.playerNode}><span>YOU</span><strong>{driver?.shortName ?? car.carId}</strong><small>{Math.round(car.currentSpeed)} km/h</small></div>
              <i className={styles.flowLine}><b style={{ width: `${racecraft.defenceProbability * 100}%` }} /></i>
              <article><span>THREAT</span><strong>{racecraft.threatCarId ? DRIVER_BY_ID.get(racecraft.threatCarId)?.shortName ?? racecraft.threatCarId : "CLEAR"}</strong><small>{Number.isFinite(car.gapToCarBehind) ? `${car.gapToCarBehind.toFixed(3)}s` : "—"}</small></article>
            </section>

            <section className={styles.metricRail}>
              <div><Crosshair size={16} /><span>PASS CHANCE</span><strong>{Math.round(racecraft.overtakeProbability * 100)}%</strong></div>
              <div><Shield size={16} /><span>THREAT</span><strong>{Math.round(racecraft.defenceProbability * 100)}%</strong></div>
              <div><Gauge size={16} /><span>CLOSING</span><strong>{racecraft.closingRateKph >= 0 ? "+" : ""}{racecraft.closingRateKph.toFixed(1)}<small> km/h</small></strong></div>
              <div><Timer size={16} /><span>GAP IN 3s</span><strong>{racecraft.predictedGapInThreeSeconds?.toFixed(3) ?? "—"}<small> s</small></strong></div>
              <div><CircleAlert size={16} /><span>DIRTY AIR</span><strong>{racecraft.dirtyAirCostSecondsPerLap.toFixed(2)}<small> s/lap</small></strong></div>
            </section>

            <section className={styles.quickCommands}>
              <div><span>QUICK COMMAND</span><small>Manual override</small></div>
              <button data-command="attack" disabled={inactive} onClick={() => applyPreset("ATTACK")} type="button"><Crosshair size={18} /><span>ATTACK<b>Maximum deployment</b></span></button>
              <button data-command="defend" disabled={inactive} onClick={() => applyPreset("DEFEND")} type="button"><Shield size={18} /><span>DEFEND<b>Protect position</b></span></button>
              <button data-command="recharge" disabled={inactive} onClick={() => applyPreset("RECHARGE")} type="button"><BatteryCharging size={18} /><span>RECHARGE<b>Build energy</b></span></button>
            </section>
          </div>
        ) : (
          <div className={styles.pitView} role="tabpanel">
            <section className={styles.pitHero} data-readiness={pit.readiness}>
              <span className={styles.pitOrb}><Wrench size={26} /></span>
              <div><span>PIT CREW STATUS</span><strong>{pit.readiness}</strong><small>{pit.reasons[0]}</small></div>
              <div><span>STATIONARY</span><strong>{pit.predictedStationarySeconds.toFixed(2)}s</strong><small>{pit.predictedIssue.replace("_", " ")}</small></div>
              <div><span>TOTAL LOSS</span><strong>{pit.predictedTotalLossSeconds.toFixed(1)}s</strong><small>{pit.trafficRisk} TRAFFIC</small></div>
            </section>

            <section className={styles.tyreWall}>
              <header><span>NEXT TYRE</span><small>SELECT A PREPARED SET</small></header>
              <div>{COMPOUNDS.map((item) => {
                const available = car.tyreSets.filter((set) => set.compound === item && set.status === "AVAILABLE").length;
                const reserved = car.scheduledPitCompound === item;
                return <button aria-pressed={compound === item} disabled={available === 0 && !reserved} key={item} onClick={() => setCompound(item)} title={`${available} fresh ${item} sets`} type="button"><TyreBadge compound={item} size="large" /><span>{item}<b>{reserved ? "RESERVED" : `${available} FRESH`}</b></span></button>;
              })}</div>
            </section>

            <section className={styles.stopSequence} aria-label="Predicted pit stop sequence">
              <div data-state="ready"><b>1</b><span>CALL<small>{compound}</small></span></div><i />
              <div data-state={snapshot.pitLaneOpen ? "ready" : "blocked"}><b>2</b><span>ENTRY<small>{snapshot.pitLaneOpen ? "OPEN" : "CLOSED"}</small></span></div><i />
              <div data-state={pit.doubleStackConflict ? "watch" : "ready"}><b>3</b><span>SERVICE<small>{pit.predictedStationarySeconds.toFixed(2)}s</small></span></div><i />
              <div data-state={pit.trafficRisk === "HIGH" ? "watch" : "ready"}><b>4</b><span>RELEASE<small>{pit.trafficRisk}</small></span></div>
            </section>

            <section className={styles.pitChecks}>
              <span data-ok={pit.tyreSetReady}><i />TYRE SET <b>{pit.tyreSetReady ? "READY" : "MISSING"}</b></span>
              <span data-ok={!pit.doubleStackConflict}><i />TEAM BOX <b>{pit.doubleStackConflict ? "OCCUPIED" : "CLEAR"}</b></span>
              <span data-ok={pit.trafficRisk !== "HIGH"}><i />RELEASE <b>{pit.trafficRisk}</b></span>
              <span data-ok={snapshot.pitLaneOpen}><i />PIT LANE <b>{snapshot.pitLaneOpen ? "OPEN" : "CLOSED"}</b></span>
            </section>

            <footer className={styles.pitActions}>
              <button className={styles.stayOut} disabled={car.pitStatus !== "TRACK" || !car.scheduledPitCompound} onClick={() => controls.stayOut(car.carId)} type="button">STAY OUT</button>
              <button className={styles.boxCall} disabled={pit.readiness === "BLOCKED"} onClick={() => controls.box(car.carId, compound)} type="button"><Wrench size={17} />BOX THIS LAP · {compound}</button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
