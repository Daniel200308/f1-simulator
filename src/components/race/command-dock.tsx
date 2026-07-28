"use client";

import { ArrowLeftRight, Shield, Swords } from "lucide-react";

import type { EnergyMode, PaceMode, RaceCarState, TeamOrderType, TyreCompound, TyreMode } from "@/domain/race";
import { TyreBadge } from "@/components/race/tyre-badge";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { useRaceStore } from "@/store/race-store";

const PACE_OPTIONS: readonly { mode: PaceMode; label: string; hint: string; level: number }[] = [
  { mode: "ATTACK", label: "Attack", hint: "Maximum pace", level: 5 },
  { mode: "PUSH", label: "Push", hint: "Close the gap", level: 4 },
  { mode: "STANDARD", label: "Standard", hint: "Race target", level: 3 },
  { mode: "CONSERVE", label: "Conserve", hint: "Save fuel", level: 2 },
  { mode: "COOL", label: "Cool", hint: "Reduce temps", level: 1 },
];
const ENERGY_OPTIONS: readonly { mode: EnergyMode; label: string; shortLabel: string; hint: string; level: number }[] = [
  { mode: "HARVEST", label: "Harvest", shortLabel: "HAR", hint: "Recovery-biased map · the driver still deploys automatically on straights", level: 1 },
  { mode: "CONSERVE", label: "Conserve", shortLabel: "CON", hint: "Reserve-biased map · automatic deployment and braking recovery", level: 2 },
  { mode: "BALANCED", label: "Balanced", shortLabel: "BAL", hint: "Neutral automatic deployment and braking recovery", level: 3 },
  { mode: "ATTACK", label: "Attack", shortLabel: "ATK", hint: "Deployment-biased map · braking recovery remains automatic", level: 4 },
  { mode: "BOOST", label: "Boost", shortLabel: "BST", hint: "Maximum deployment tendency · braking recovery remains automatic", level: 4 },
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
  setTeamOrder: (order: TeamOrderType) => void;
  box: (carId: string, compound: TyreCompound) => void;
  servePenalty: (carId: string) => void;
  stayOut: (carId: string) => void;
}

function LevelGlyph({ level, kind }: { level: number; kind: "pace" | "energy" | "tyre" }) {
  return <span className={`control-glyph control-glyph--${kind}`}>{Array.from({ length: kind === "pace" ? 5 : 4 }, (_, index) => <i className={index < level ? "is-on" : ""} key={index} />)}</span>;
}

export function CommandDock({ car, controls, pitLaneOpen }: { car?: RaceCarState; controls: CommandDockControls; pitLaneOpen: boolean }) {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const setSelectedCarId = useRaceStore((state) => state.setSelectedCarId);
  const driver = car ? DRIVER_BY_ID.get(car.driverId) : undefined;
  const team = car ? TEAM_BY_ID.get(car.teamId) : undefined;
  const playerCarIds = playerCarIdsFor(snapshot?.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID);
  const enabled = Boolean(car && car.teamId === snapshot?.playerTeamId && !car.finished && car.incidentStatus !== "RETIRED");
  const tyreSetsFor = (compound: TyreCompound) => car?.tyreSets?.filter((set) => set.compound === compound) ?? [];
  const availableSetsFor = (compound: TyreCompound) => tyreSetsFor(compound).filter((set) => set.status === "AVAILABLE" || set.status === "USED").length;

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

      <section className="visual-control visual-control--pace">
        <header><span>PACE</span><b>{car?.paceMode ?? "—"}</b></header>
        <div>{PACE_OPTIONS.map((option) => <button aria-label={`Set pace ${option.mode}`} aria-pressed={car?.paceMode === option.mode} className="command-node" disabled={!enabled} key={option.mode} onClick={() => car && controls.setPace(car.carId, option.mode)} title={option.hint} type="button"><LevelGlyph kind="pace" level={option.level} /><strong>{option.label}</strong></button>)}</div>
      </section>

      <section aria-label="Energy deployment tendency" className="visual-control visual-control--energy">
        <header><span>ENERGY TENDENCY</span><b className={car?.overtakeActive ? "is-ovt-live" : ""}>{car?.overtakeActive ? "OVT LIVE" : car?.energySystem?.overtakeEligible ? "OVT READY" : "AUTO OVT"}</b></header>
        <div className="energy-mode-rail">{ENERGY_OPTIONS.map((option) => {
          return <button aria-label={`Set energy tendency ${option.mode}`} aria-pressed={car?.energyMode === option.mode} className={`command-node energy-node energy-node--${option.mode.toLowerCase()}`} disabled={!enabled} key={option.mode} onClick={() => car && controls.setEnergyMode(car.carId, option.mode)} title={`${option.label} · ${option.hint}`} type="button"><LevelGlyph kind="energy" level={option.level} /><strong>{option.shortLabel}</strong></button>;
        })}</div>
      </section>

      <section className="visual-control visual-control--tyre">
        <header><span>TYRE MANAGEMENT</span><b>{car?.tyreMode ?? "—"}</b></header>
        <div>{TYRE_OPTIONS.map((option) => <button aria-label={`Set tyre management ${option.mode}`} aria-pressed={car?.tyreMode === option.mode} className="command-node" disabled={!enabled} key={option.mode} onClick={() => car && controls.setTyreMode(car.carId, option.mode)} title={option.hint} type="button"><LevelGlyph kind="tyre" level={option.grip} /><strong>{option.label}</strong></button>)}</div>
      </section>

      <section className="pit-tyre-control">
        <header><span>NEXT TYRE</span><b>{pitLaneOpen ? "PIT OPEN" : "PIT CLOSED"}</b></header>
        <div className="pit-tyre-control__buttons">{PIT_COMPOUNDS.map((compound) => {
          const available = availableSetsFor(compound);
          const isScheduled = car?.scheduledPitCompound === compound;
          return <button aria-label={`Box for ${compound}, ${available} sets available`} aria-pressed={isScheduled} className="tyre-select-button" disabled={!enabled || car?.pitStatus !== "TRACK" || !pitLaneOpen || (available === 0 && !isScheduled)} key={compound} onClick={() => car && controls.box(car.carId, compound)} title={`${compound} · ${available} fresh set${available === 1 ? "" : "s"}`} type="button"><TyreBadge compound={compound} size="large" /></button>;
        })}<button aria-label="Stay out" className="stay-out-control" disabled={!enabled || car?.pitStatus !== "TRACK" || !car?.scheduledPitCompound} onClick={() => car && controls.stayOut(car.carId)} title="Cancel pit call" type="button"><b>×</b></button></div>
      </section>
    </div>
  );
}
