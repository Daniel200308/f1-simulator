"use client";

import type { CSSProperties } from "react";
import { ChevronRight, RadioTower, Users } from "lucide-react";

import { DRIVERS, TEAM_BY_ID, TEAMS } from "@/fixtures/grid";

import styles from "./team-selection.module.css";

interface TeamSelectionProps {
  selectedTeamId: string;
  onSelect: (teamId: string) => void;
  onConfirm: () => void;
}

function colorHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export function TeamSelection({ selectedTeamId, onSelect, onConfirm }: TeamSelectionProps) {
  const selectedTeam = TEAM_BY_ID.get(selectedTeamId) ?? TEAMS[0];
  const selectedDrivers = DRIVERS.filter((driver) => driver.teamId === selectedTeam.id);

  return (
    <div className={styles.backdrop}>
      <main className={styles.selector} style={{ "--selected-team": colorHex(selectedTeam.primaryColor) } as CSSProperties}>
        <header className={styles.header}>
          <span className={styles.mark}><RadioTower aria-hidden="true" size={25} /></span>
          <div><small>PROJECT PITWALL · CAREER SETUP</small><h1>Choose Your Team</h1><p>Your selection controls both cars through Practice, Qualifying and the Grand Prix.</p></div>
          <b>ROUND 09<br /><span>SILVERSTONE</span></b>
        </header>

        <section className={styles.workspace}>
          <div className={styles.teamGrid} role="listbox" aria-label="Select Formula 1 team">
            {TEAMS.map((team, index) => {
              const drivers = DRIVERS.filter((driver) => driver.teamId === team.id);
              const selected = team.id === selectedTeamId;
              return (
                <button
                  aria-selected={selected}
                  className={selected ? styles.selected : ""}
                  key={team.id}
                  onClick={() => onSelect(team.id)}
                  role="option"
                  style={{ "--team": colorHex(team.primaryColor) } as CSSProperties}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{team.name}</strong><small>{team.shortName} · {drivers.map((driver) => driver.shortName).join(" / ")}</small></div>
                  <i />
                </button>
              );
            })}
          </div>

          <aside className={styles.teamBrief}>
            <span>SELECTED CONSTRUCTOR</span>
            <h2>{selectedTeam.name}</h2>
            <p>Both race seats are linked to your pitwall. Setup decisions and tyre allocations carry through the full weekend.</p>
            <div className={styles.performance}><span>CAR PERFORMANCE</span><strong>{Math.round(selectedTeam.performance * 100)}%</strong><i><b style={{ width: `${Math.min(100, selectedTeam.performance * 98)}%` }} /></i></div>
            <div className={styles.driverPair}>
              {selectedDrivers.map((driver) => <article key={driver.id}><span>#{driver.number}</span><div><strong>{driver.name}</strong><small>{driver.shortName} · RACE DRIVER</small></div></article>)}
            </div>
            <div className={styles.scope}><Users aria-hidden="true" size={17} /><span><b>2-CAR CONTROL</b><small>Shared strategy, independent setup and live team radio</small></span></div>
            <button className={styles.confirm} onClick={onConfirm} type="button">ENTER WEEKEND <ChevronRight aria-hidden="true" size={20} /></button>
          </aside>
        </section>
      </main>
    </div>
  );
}
