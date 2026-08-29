"use client";

import type { CSSProperties } from "react";
import { ChevronRight, Users } from "lucide-react";

import { DRIVERS, TEAM_BY_ID, TEAMS } from "@/fixtures/grid";
import { season2026TeamCarRating } from "@/fixtures/season-2026-performance";

import styles from "./team-selection.module.css";

interface TeamSelectionProps {
  selectedTeamId: string;
  circuitName?: string;
  onSelect: (teamId: string) => void;
  onConfirm: () => void;
}

function colorHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export function TeamSelection({ selectedTeamId, circuitName = "SILVERSTONE", onSelect, onConfirm }: TeamSelectionProps) {
  const selectedTeam = TEAM_BY_ID.get(selectedTeamId) ?? TEAMS[0];
  const selectedDrivers = DRIVERS.filter((driver) => driver.teamId === selectedTeam.id);
  const carRating = season2026TeamCarRating(selectedTeam.id);

  return (
    <div className={styles.backdrop}>
      <main className={styles.selector} style={{ "--selected-team": colorHex(selectedTeam.primaryColor) } as CSSProperties}>
        <header className={styles.header}>
          <strong className={styles.brandTitle}>PROJECT PITWALL</strong>
          <div className={styles.eventTitle}>
            <strong>BRITISH GRAND PRIX</strong>
            <span>{circuitName.toUpperCase()}</span>
          </div>
          <h1 className={styles.teamPrompt}>Choose Your Team</h1>
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
                  <strong>{team.name}</strong>
                  <small>{drivers.map((driver) => driver.shortName).join(" · ")}</small>
                  <i />
                </button>
              );
            })}
          </div>

          <aside className={styles.teamBrief}>
            {/* The brief scrolls internally on short viewports so the confirm
                button below it is always reachable. */}
            <div className={styles.briefBody}>
              <span>SELECTED CONSTRUCTOR</span>
              <h2>{selectedTeam.name}</h2>
              <p>Both race seats are linked to your pitwall.</p>
              {/* The engine's `performance` field is a lap-time multiplier with a
                  0.02 total spread, so it is not a readable rating. This uses the
                  normalised car rating instead. */}
              <div className={styles.performance}><span>CAR PERFORMANCE</span><strong>{carRating}</strong><i><b style={{ width: `${carRating}%` }} /></i></div>
              <div className={styles.driverPair}>
                {selectedDrivers.map((driver) => <article key={driver.id}><span>#{driver.number}</span><strong>{driver.name}</strong><small>{driver.shortName} · RACE DRIVER</small></article>)}
              </div>
              <div className={styles.scope}><Users aria-hidden="true" size={17} /><span><b>2-CAR CONTROL</b><small>Shared strategy, independent setup and live team radio</small></span></div>
            </div>
            <button className={styles.confirm} onClick={onConfirm} type="button">ENTER WEEKEND <ChevronRight aria-hidden="true" size={20} /></button>
          </aside>
        </section>
      </main>
    </div>
  );
}
