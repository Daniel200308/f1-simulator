"use client";

import type { CSSProperties } from "react";
import { Radio } from "lucide-react";

import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { useRaceStore } from "@/store/race-store";

function messageClock(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function TeamRadioOverlay() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const playerTeamId = snapshot?.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID;
  const team = TEAM_BY_ID.get(playerTeamId);
  const playerCarIds = playerCarIdsFor(playerTeamId);
  const teamMessages = snapshot?.radioMessages
    .filter((message) => message.source !== "RACE CONTROL" && message.carId !== null && playerCarIds.includes(message.carId)) ?? [];
  const radioMessages = teamMessages.slice(0, 1);
  const tone = team ? `#${team.primaryColor.toString(16).padStart(6, "0")}` : "#20d7e7";
  const liveMessage = radioMessages[0];
  const liveDriver = liveMessage?.carId ? DRIVER_BY_ID.get(liveMessage.carId) : undefined;

  return (
    <section
      aria-label={`${team?.name ?? "Team"} driver radio`}
      aria-live="polite"
      className="track-radio"
      style={{ "--radio-tone": tone } as CSSProperties}
    >
      <header>
        <span><Radio aria-hidden="true" size={15} /> TEAM RADIO</span>
        <strong>{playerCarIds.map((carId) => DRIVER_BY_ID.get(carId)?.shortName).join(" · ")}</strong>
      </header>
      <div className="track-radio__messages" role="log">
        {radioMessages.length ? radioMessages.map((message) => (
          <article className={`track-radio__message track-radio__message--${message.priority.toLowerCase()}`} key={message.id}>
            <div className="track-radio__speaker">
              <strong>{liveDriver?.shortName ?? "PIT"}</strong>
              <span><b>{liveDriver?.name ?? `${team?.shortName ?? "TEAM"} ENGINEER`}</b><small>{message.source} · {messageClock(message.elapsedTime)}</small></span>
            </div>
            <p>{message.message}</p>
          </article>
        )) : (
          <p className="track-radio__standby">Radio check complete. Live calls will appear here.</p>
        )}
      </div>
    </section>
  );
}
