"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeftRight, Shield, Swords } from "lucide-react";

import type { EnergyMode, PaceMode, RaceCarState, TeamOrderType, TyreCompound, TyreMode, TyreSetState } from "@/domain/race";
import { TyreBadge } from "@/components/race/tyre-badge";
import { tyreSetLabel, tyreSetNumber } from "@/components/race/format";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { useRaceStore } from "@/store/race-store";

const PACE_OPTIONS: readonly { mode: PaceMode; label: string; shortLabel: string; hint: string; level: number }[] = [
  { mode: "ATTACK", label: "Attack", shortLabel: "ATK", hint: "Maximum pace", level: 5 },
  { mode: "PUSH", label: "Push", shortLabel: "PUSH", hint: "Close the gap", level: 4 },
  { mode: "STANDARD", label: "Standard", shortLabel: "STD", hint: "Race target", level: 3 },
  { mode: "CONSERVE", label: "Conserve", shortLabel: "SAVE", hint: "Save fuel", level: 2 },
  { mode: "COOL", label: "Cool", shortLabel: "COOL", hint: "Reduce temps", level: 1 },
];
/*
 * Every car, player and AI, deploys on the straights and harvests through the
 * corners automatically. The only choice the pit wall makes is how hard that
 * automatic pattern leans on the battery, so this is a three-step usage scale
 * rather than a set of deployment maps.
 */
const ENERGY_OPTIONS: readonly { mode: EnergyMode; label: string; shortLabel: string; hint: string; level: number }[] = [
  { mode: "ATTACK", label: "Tight", shortLabel: "TIGHT", hint: "Spend the battery hard on every straight · shortest reserve", level: 4 },
  { mode: "BALANCED", label: "Balanced", shortLabel: "BAL", hint: "Match deployment to recovery lap by lap", level: 3 },
  { mode: "CONSERVE", label: "Save", shortLabel: "SAVE", hint: "Deploy on the straights but keep a reserve in hand", level: 2 },
];
const TYRE_OPTIONS: readonly { mode: TyreMode; label: string; shortLabel: string; hint: string; grip: number }[] = [
  { mode: "GRIP", label: "Grip", shortLabel: "GRIP", hint: "Use tyre", grip: 4 },
  { mode: "BALANCED", label: "Balanced", shortLabel: "BAL", hint: "Target life", grip: 3 },
  { mode: "SAVE", label: "Save", shortLabel: "SAVE", hint: "Extend stint", grip: 2 },
  { mode: "TEMPERATURE", label: "Cool", shortLabel: "COOL", hint: "Lower temp", grip: 1 },
];
const PIT_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

export interface CommandDockControls {
  setPace: (carId: string, mode: PaceMode) => void;
  setEnergyMode: (carId: string, mode: EnergyMode) => void;
  setTyreMode: (carId: string, mode: TyreMode) => void;
  setTeamOrder: (order: TeamOrderType) => void;
  box: (carId: string, compound: TyreCompound, tyreSetId?: string) => void;
  servePenalty: (carId: string) => void;
  stayOut: (carId: string) => void;
}

/** Freshest usable set first, so the default choice is the obvious one. */
function orderedSets(sets: readonly TyreSetState[]): readonly TyreSetState[] {
  return [...sets].sort((left, right) => right.condition - left.condition || tyreSetNumber(left.id) - tyreSetNumber(right.id));
}

function LevelGlyph({ level, kind }: { level: number; kind: "pace" | "energy" | "tyre" }) {
  return <span className={`control-glyph control-glyph--${kind}`}>{Array.from({ length: kind === "pace" ? 5 : 4 }, (_, index) => <i className={index < level ? "is-on" : ""} key={index} />)}</span>;
}

export function CommandDock({ car, controls, pitLaneOpen }: { car?: RaceCarState; controls: CommandDockControls; pitLaneOpen: boolean }) {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const setSelectedCarId = useRaceStore((state) => state.setSelectedCarId);
  // Which compound's set list is open. Null keeps the dock exactly as before.
  const [openCompound, setOpenCompound] = useState<TyreCompound | null>(null);
  const pitSectionRef = useRef<HTMLElement>(null);
  const driver = car ? DRIVER_BY_ID.get(car.driverId) : undefined;
  const team = car ? TEAM_BY_ID.get(car.teamId) : undefined;
  const playerCarIds = playerCarIdsFor(snapshot?.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID);
  const enabled = Boolean(car && car.teamId === snapshot?.playerTeamId && !car.finished && car.incidentStatus !== "RETIRED");
  const tyreSetsFor = (compound: TyreCompound) => car?.tyreSets?.filter((set) => set.compound === compound) ?? [];
  const usableSetsFor = (compound: TyreCompound) => orderedSets(
    tyreSetsFor(compound).filter((set) => set.status === "AVAILABLE" || set.status === "USED" || set.status === "RESERVED"),
  );
  const availableSetsFor = (compound: TyreCompound) => usableSetsFor(compound).length;
  const canCallPit = Boolean(enabled && car?.pitStatus === "TRACK" && pitLaneOpen);
  // Derived rather than synced: a pit call that is no longer possible closes the
  // list without an extra render pass.
  const activeCompound = canCallPit ? openCompound : null;
  const openSets = activeCompound ? usableSetsFor(activeCompound) : [];

  // Close the set list on outside click or Escape, like any transient popover.
  useEffect(() => {
    if (!activeCompound) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pitSectionRef.current?.contains(event.target as Node)) setOpenCompound(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCompound(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeCompound]);

  return (
    <div className="command-console">
      <div className="command-console__target">
        <span className="eyebrow">DRIVER CONTROL</span>
        <div aria-label="Select driver to control" className="command-driver-selector" role="group">
          {playerCarIds.map((carId) => {
            const playerDriver = DRIVER_BY_ID.get(carId);
            const playerCar = snapshot?.cars.find((candidate) => candidate.carId === carId);
            if (!playerDriver) return null;
            return (
              <button
                aria-label={`Control ${playerDriver.name}, car ${playerDriver.number}`}
                aria-pressed={selectedCarId === carId}
                className="command-driver-select"
                key={carId}
                onClick={() => setSelectedCarId(carId)}
                type="button"
              >
                <i />
                <span><b>{playerDriver.shortName}</b><small>#{playerDriver.number} · {playerCar ? `P${playerCar.racePosition}` : "GRID"}</small></span>
              </button>
            );
          })}
        </div>
        <div aria-label="Team orders" className="team-order-rail" role="group">
          {(["NONE", "HOLD_POSITION", "SWAP_CARS"] as const).map((order) => (
            <button aria-pressed={(snapshot?.teamOrder?.type ?? "NONE") === order} disabled={!snapshot || snapshot.status === "FINISHED"} key={order} onClick={() => controls.setTeamOrder(order)} title={order === "NONE" ? "Let both drivers race" : order === "HOLD_POSITION" ? "Hold the current team order" : "Release the following car and swap positions"} type="button">
              {order === "NONE" ? <Swords aria-hidden="true" size={14} /> : order === "HOLD_POSITION" ? <Shield aria-hidden="true" size={14} /> : <ArrowLeftRight aria-hidden="true" size={14} />}
              <span>{order === "NONE" ? "FREE" : order === "HOLD_POSITION" ? "HOLD" : "SWAP"}</span>
            </button>
          ))}
        </div>
        <small className={enabled ? "command-link-status is-live" : "command-link-status"}>{enabled ? `${driver?.shortName} · ${team?.shortName} LINKED` : "SELECT PLAYER CAR"}</small>
      </div>

      <section aria-label="Pace" className="visual-control visual-control--pace">
        <header><span>PACE</span><b>{car?.paceMode ?? "—"}</b></header>
        <div className="pace-mode-rail">{PACE_OPTIONS.map((option) => (
          <button aria-label={`Set pace ${option.label}`} aria-pressed={car?.paceMode === option.mode} className={`command-node pace-node pace-node--${option.mode.toLowerCase()}`} disabled={!enabled} key={option.mode} onClick={() => car && controls.setPace(car.carId, option.mode)} title={`${option.label} · ${option.hint}`} type="button"><LevelGlyph kind="pace" level={option.level} /><strong>{option.shortLabel}</strong></button>
        ))}</div>
      </section>

      <section aria-label="Battery usage" className="visual-control visual-control--energy">
        <header><span>BATTERY USAGE</span><b className={car?.overtakeActive ? "is-ovt-live" : ""}>{car?.overtakeActive ? "OVT LIVE" : car?.energySystem?.overtakeEligible ? "OVT READY" : "AUTO DEPLOY"}</b></header>
        <div className="energy-mode-rail">{ENERGY_OPTIONS.map((option) => (
          <button aria-label={`Set battery usage ${option.label}`} aria-pressed={car?.energyMode === option.mode} className={`command-node energy-node energy-node--${option.mode.toLowerCase()}`} disabled={!enabled} key={option.mode} onClick={() => car && controls.setEnergyMode(car.carId, option.mode)} title={`${option.label} · ${option.hint}`} type="button"><LevelGlyph kind="energy" level={option.level} /><strong>{option.shortLabel}</strong></button>
        ))}</div>
      </section>

      <section aria-label="Tyre management" className="visual-control visual-control--tyre">
        <header><span>TYRE MANAGEMENT</span><b>{car?.tyreMode ?? "—"}</b></header>
        <div className="tyre-mode-rail">{TYRE_OPTIONS.map((option) => (
          <button aria-label={`Set tyre management ${option.label}`} aria-pressed={car?.tyreMode === option.mode} className={`command-node tyre-node tyre-node--${option.mode.toLowerCase()}`} disabled={!enabled} key={option.mode} onClick={() => car && controls.setTyreMode(car.carId, option.mode)} title={`${option.label} · ${option.hint}`} type="button"><LevelGlyph kind="tyre" level={option.grip} /><strong>{option.shortLabel}</strong></button>
        ))}</div>
      </section>

      <section className="pit-tyre-control" ref={pitSectionRef}>
        <header><span>NEXT TYRE</span><b>{pitLaneOpen ? "PIT OPEN" : "PIT CLOSED"}</b></header>
        <div className="pit-tyre-control__buttons">{PIT_COMPOUNDS.map((compound) => {
          const available = availableSetsFor(compound);
          const isScheduled = car?.scheduledPitCompound === compound;
          return <button
            aria-expanded={activeCompound === compound}
            aria-haspopup="true"
            aria-label={`Choose ${compound} set, ${available} available`}
            aria-pressed={isScheduled}
            className="tyre-select-button"
            data-compound={compound}
            disabled={!canCallPit || (available === 0 && !isScheduled)}
            key={compound}
            onClick={() => setOpenCompound((current) => current === compound ? null : compound)}
            title={`${compound} · ${available} set${available === 1 ? "" : "s"} · choose set and life`}
            type="button"
          >
            <TyreBadge compound={compound} size="large" />
            <b className="tyre-select-button__count">{available}</b>
          </button>;
        })}<button aria-label="Stay out" className="stay-out-control" disabled={!enabled || car?.pitStatus !== "TRACK" || !car?.scheduledPitCompound} onClick={() => { setOpenCompound(null); if (car) controls.stayOut(car.carId); }} title="Cancel pit call" type="button"><b>×</b></button></div>

        {/* The chosen compound's remaining sets, each with its life, so the pit
            wall picks an exact set instead of only a compound. */}
        {activeCompound && car && (
          <div aria-label={`${activeCompound} tyre sets`} className="tyre-set-picker" role="group">
            <header>
              <span><TyreBadge compound={activeCompound} size="small" />{activeCompound}</span>
              <span className="tyre-set-picker__meta">
                <b>{openSets.length} SET{openSets.length === 1 ? "" : "S"} LEFT</b>
                <button aria-label="Close tyre set list" onClick={() => setOpenCompound(null)} type="button">×</button>
              </span>
            </header>
            {openSets.length === 0
              ? <p className="tyre-set-picker__empty">NO SETS REMAINING</p>
              : <div className="tyre-set-picker__grid">{openSets.map((set) => {
                const isScheduledSet = car.scheduledPitTyreSetId === set.id;
                const life = Math.round(set.condition);
                // Stint laps accumulate as a fraction of a lap, so the label has
                // to be rounded before it reaches the UI.
                const laps = Math.round(set.lapsUsed);
                return <button
                  aria-label={`Box for ${activeCompound} set ${tyreSetLabel(set.id)}, ${life} percent life, ${laps} laps used`}
                  aria-pressed={isScheduledSet}
                  data-freshness={laps === 0 ? "NEW" : "USED"}
                  data-life={life >= 85 ? "FRESH" : life >= 60 ? "WORN" : "LOW"}
                  data-set-id={set.id}
                  key={set.id}
                  onClick={() => { controls.box(car.carId, activeCompound, set.id); setOpenCompound(null); }}
                  style={{ "--set-life": `${life}%` } as CSSProperties}
                  title={`${activeCompound} set ${tyreSetLabel(set.id)} · ${life}% life · ${laps} lap${laps === 1 ? "" : "s"}`}
                  type="button"
                >
                  <span><b>#{tyreSetLabel(set.id)}</b><strong>{life}%</strong></span>
                  <i aria-hidden="true"><em /></i>
                  <small>{laps === 0 ? "NEW" : `${laps}L USED`}</small>
                </button>;
              })}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
