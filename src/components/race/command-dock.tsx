"use client";

import type { EnergyMode, PaceMode, RaceCarState, TyreCompound, TyreMode } from "@/domain/race";
import { TyreBadge } from "@/components/race/tyre-badge";
import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";

const PACE_OPTIONS: readonly { mode: PaceMode; label: string; hint: string; level: number }[] = [
  { mode: "ATTACK", label: "Attack", hint: "Maximum pace", level: 5 },
  { mode: "PUSH", label: "Push", hint: "Close the gap", level: 4 },
  { mode: "STANDARD", label: "Standard", hint: "Race target", level: 3 },
  { mode: "CONSERVE", label: "Conserve", hint: "Save fuel", level: 2 },
  { mode: "COOL", label: "Cool", hint: "Reduce temps", level: 1 },
];
const ENERGY_OPTIONS: readonly { mode: EnergyMode; label: string; hint: string; level: number }[] = [
  { mode: "ATTACK", label: "Attack", hint: "Deploy", level: 4 },
  { mode: "BALANCED", label: "Balanced", hint: "Auto", level: 3 },
  { mode: "DEFEND", label: "Defend", hint: "Hold position", level: 3 },
  { mode: "RECHARGE", label: "Recharge", hint: "Harvest", level: 1 },
];
const TYRE_OPTIONS: readonly { mode: TyreMode; label: string; hint: string; grip: number }[] = [
  { mode: "GRIP", label: "Grip", hint: "Use tyre", grip: 4 },
  { mode: "BALANCED", label: "Balanced", hint: "Target life", grip: 3 },
  { mode: "SAVE", label: "Save", hint: "Extend stint", grip: 2 },
  { mode: "TEMPERATURE", label: "Cool", hint: "Lower temp", grip: 1 },
];
const PIT_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

export interface CommandDockControls {
  setPace: (carId: string, mode: PaceMode) => void;
  setEnergyMode: (carId: string, mode: EnergyMode) => void;
  setTyreMode: (carId: string, mode: TyreMode) => void;
  box: (carId: string, compound: TyreCompound) => void;
  stayOut: (carId: string) => void;
}

function LevelGlyph({ level, kind }: { level: number; kind: "pace" | "energy" | "tyre" }) {
  return <span className={`control-glyph control-glyph--${kind}`}>{Array.from({ length: kind === "pace" ? 5 : 4 }, (_, index) => <i className={index < level ? "is-on" : ""} key={index} />)}</span>;
}

export function CommandDock({ car, controls, pitLaneOpen }: { car?: RaceCarState; controls: CommandDockControls; pitLaneOpen: boolean }) {
  const driver = car ? DRIVER_BY_ID.get(car.driverId) : undefined;
  const team = car ? TEAM_BY_ID.get(car.teamId) : undefined;
  const enabled = Boolean(car && team?.isPlayer);
  const tyreSetsFor = (compound: TyreCompound) => car?.tyreSets?.filter((set) => set.compound === compound) ?? [];
  const availableSetsFor = (compound: TyreCompound) => tyreSetsFor(compound).filter((set) => set.status === "AVAILABLE").length;

  return (
    <div className="command-console">
      <div className="command-console__target">
        <span className="eyebrow">DRIVER CONTROL</span>
        <strong>{driver?.shortName ?? "—"} <i /> {team?.shortName ?? "—"}</strong>
        <small>{enabled ? "LIVE COMMAND LINK" : "RIVAL TELEMETRY"}</small>
      </div>

      <section className="visual-control visual-control--pace">
        <header><span>PACE</span><b>{car?.paceMode ?? "—"}</b></header>
        <div>{PACE_OPTIONS.map((option) => <button aria-label={`Set pace ${option.mode}`} className={car?.paceMode === option.mode ? "is-active" : ""} disabled={!enabled} key={option.mode} onClick={() => car && controls.setPace(car.carId, option.mode)} type="button"><LevelGlyph kind="pace" level={option.level} /><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
      </section>

      <section className="visual-control visual-control--energy">
        <header><span>ENERGY</span><b>{Math.round(car?.batteryPercent ?? 0)}% · {car?.energyState ?? "—"}</b></header>
        <div>{ENERGY_OPTIONS.map((option) => <button aria-label={`Set energy ${option.mode}`} className={car?.energyMode === option.mode ? "is-active" : ""} disabled={!enabled} key={option.mode} onClick={() => car && controls.setEnergyMode(car.carId, option.mode)} type="button"><LevelGlyph kind="energy" level={option.level} /><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
      </section>

      <section className="visual-control visual-control--tyre">
        <header><span>TYRE MANAGEMENT</span><b>{car?.tyreMode ?? "—"}</b></header>
        <div>{TYRE_OPTIONS.map((option) => <button aria-label={`Set tyre management ${option.mode}`} className={car?.tyreMode === option.mode ? "is-active" : ""} disabled={!enabled} key={option.mode} onClick={() => car && controls.setTyreMode(car.carId, option.mode)} type="button"><LevelGlyph kind="tyre" level={option.grip} /><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
      </section>

      <section className="pit-tyre-control">
        <header><span>NEXT TYRE</span><b>{pitLaneOpen ? "PIT OPEN" : "PIT CLOSED"}</b></header>
        <div className="pit-tyre-control__buttons">{PIT_COMPOUNDS.map((compound) => {
          const available = availableSetsFor(compound);
          const isScheduled = car?.scheduledPitCompound === compound;
          return <button aria-label={`Box for ${compound}, ${available} sets available`} className={isScheduled ? "is-active" : ""} disabled={!enabled || car?.pitStatus !== "TRACK" || !pitLaneOpen || (available === 0 && !isScheduled)} key={compound} onClick={() => car && controls.box(car.carId, compound)} type="button"><TyreBadge compound={compound} size="medium" /><span>BOX</span><em>{available}</em></button>;
        })}<button className="stay-out-control" disabled={!enabled || !car?.scheduledPitCompound} onClick={() => car && controls.stayOut(car.carId)} type="button"><b>×</b><span>STAY OUT</span></button></div>
        <div className="tyre-set-strip" aria-label="Tyre set inventory">{PIT_COMPOUNDS.map((compound) => <span key={compound} title={`${compound} tyre sets`}><TyreBadge compound={compound} size="small" />{tyreSetsFor(compound).map((set) => <i className={`tyre-set-dot tyre-set-dot--${set.status.toLowerCase()}`} key={set.id} title={`${set.status} · ${set.condition.toFixed(0)}%`} />)}</span>)}</div>
      </section>
    </div>
  );
}
