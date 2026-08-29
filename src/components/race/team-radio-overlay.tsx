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
  const latestDriverMessage = teamMessages.find((message) => message.source === "DRIVER");
  const latestCommandEngineerMessage = [...teamMessages]
    .filter((message) => message.source === "ENGINEER"
      && (/-(pace|tyre|energy|box|stay-out|team-order|serve-penalty|cooling)$/.test(message.id)
        || message.id.endsWith("-operations-radio-control-engineer")))
    .sort((left, right) => right.elapsedTime - left.elapsedTime)[0];
  const radioMessages = [latestDriverMessage, latestCommandEngineerMessage].filter((message): message is NonNullable<typeof message> => Boolean(message));
  const tone = team ? `#${team.primaryColor.toString(16).padStart(6, "0")}` : "#7b858f";

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
        {radioMessages.length ? radioMessages.map((message) => {
          const messageDriver = message.carId ? DRIVER_BY_ID.get(message.carId) : undefined;
          const isDriver = message.source === "DRIVER";
          const speakerCode = isDriver ? messageDriver?.shortName ?? "DRV" : "ENG";
          const speakerName = isDriver ? messageDriver?.name ?? "DRIVER" : "RACE ENGINEER";
          const speakerMeta = isDriver
            ? `DRIVER · ${messageClock(message.elapsedTime)}`
            : `TO ${messageDriver?.shortName ?? "TEAM"} · ${messageClock(message.elapsedTime)}`;
          return <article className={`track-radio__message track-radio__message--${message.priority.toLowerCase()} track-radio__message--${isDriver ? "driver" : "engineer"}`} data-source={message.source} key={message.id}>
            <div className="track-radio__speaker">
              <strong>{speakerCode}</strong>
              <span><b title={speakerName}>{speakerName}</b><small title={speakerMeta}>{speakerMeta}</small></span>
            </div>
            <p title={message.message}>{message.message}</p>
          </article>;
        }) : (
          <p className="track-radio__standby">Radio check complete. Live calls will appear here.</p>
        )}
      </div>
    </section>
  );
}
