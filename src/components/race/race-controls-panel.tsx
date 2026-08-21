"use client";

import { useMemo, useState } from "react";
import { Clock3, Flag, Radio, ShieldAlert, TriangleAlert } from "lucide-react";

import type { RaceEvent, RaceSnapshot } from "@/domain/race";
import { latestRaceControlNotice } from "@/simulation/race-control-feed";

import styles from "./race-controls-panel.module.css";

type ControlTone = "clear" | "yellow" | "orange" | "red" | "blue" | "neutral";

interface RaceControlListItem {
  id: string;
  elapsedTime: number;
  title: string;
  message: string;
  sector: 1 | 2 | 3;
  tone: ControlTone;
  icon: "flag" | "alert" | "shield";
}

function boundedSector(value: number | null | undefined): 1 | 2 | 3 {
  if (value === 2 || value === 3) return value;
  return 1;
}

function sectorFromMessage(message: string): 1 | 2 | 3 | null {
  const match = message.match(/(?:TRACK\s+)?SECTOR\s+([1-3])\b/i);
  return match ? boundedSector(Number(match[1])) : null;
}

function formatRaceClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `T+${Math.floor(safeSeconds / 60).toString().padStart(2, "0")}:${(safeSeconds % 60).toString().padStart(2, "0")}`;
}

function formatRelativeTime(now: number, eventTime: number): string {
  const delta = Math.max(0, Math.floor(now - eventTime));
  if (delta < 2) return "JUST NOW";
  if (delta < 60) return `${delta}s AGO`;
  return `${Math.floor(delta / 60)}m AGO`;
}

function eventDescriptor(message: string): Pick<RaceControlListItem, "title" | "tone" | "icon"> {
  const content = message.toUpperCase();
  if (content.includes("DOUBLE YELLOW")) return { title: "DOUBLE YELLOW FLAG", tone: "orange", icon: "flag" };
  if (content.includes("RED FLAG") || content.includes("RED-FLAG")) return { title: "RED FLAG", tone: "red", icon: "alert" };
  if (content.includes("SAFETY CAR") || content.includes("VSC") || content.includes("VIRTUAL SAFETY")) {
    return { title: content.includes("VSC") || content.includes("VIRTUAL SAFETY") ? "VIRTUAL SAFETY CAR" : "SAFETY CAR", tone: "yellow", icon: "shield" };
  }
  if (content.includes("BLUE FLAG") || content.includes("BLUE FLAGS")) return { title: "BLUE FLAG", tone: "blue", icon: "flag" };
  if (content.includes("YELLOW FLAG") || content.includes("LOCAL YELLOW")) return { title: "YELLOW FLAG", tone: "yellow", icon: "flag" };
  if (content.includes("GREEN FLAG") || content.includes("TRACK CLEAR") || content.includes("CLEAR")) return { title: "CLEAR FLAG", tone: "clear", icon: "flag" };
  if (content.includes("PIT LANE")) return { title: "PIT LANE CONTROL", tone: "neutral", icon: "shield" };
  return { title: "RACE CONTROL", tone: "neutral", icon: "flag" };
}

function messageFor(descriptor: Pick<RaceControlListItem, "title" | "tone">, sector: 1 | 2 | 3, source: string): string {
  if (descriptor.title === "CLEAR FLAG") return `CLEAR IN TRACK SECTOR ${sector}`;
  if (descriptor.title === "PIT LANE CONTROL") return `${source.toUpperCase()} · SECTOR ${sector}`;
  if (descriptor.tone === "blue") return `BLUE FLAG IN TRACK SECTOR ${sector}`;
  return `${descriptor.title.replace(/ FLAG$/, "")} IN TRACK SECTOR ${sector}`;
}

function itemFromEvent(event: RaceEvent, snapshot: RaceSnapshot, fallbackSector: 1 | 2 | 3): RaceControlListItem {
  const descriptor = eventDescriptor(event.message);
  const sector = boundedSector(event.sector ?? sectorFromMessage(event.message) ?? snapshot.activeIncident?.sector ?? snapshot.yellowSector ?? fallbackSector);
  return {
    id: event.id,
    elapsedTime: event.elapsedTime,
    title: descriptor.title,
    message: messageFor(descriptor, sector, event.message),
    sector,
    tone: descriptor.tone,
    icon: descriptor.icon,
  };
}

function itemFromLiveNotice(snapshot: RaceSnapshot): RaceControlListItem | null {
  if (snapshot.raceControl === "GREEN") return null;
  const notice = latestRaceControlNotice(snapshot);
  const descriptor = eventDescriptor(`${notice.headline} ${notice.message}`);
  const sector = boundedSector(notice.sector ?? sectorFromMessage(`${notice.headline} ${notice.message}`) ?? snapshot.activeIncident?.sector ?? snapshot.yellowSector ?? 1);
  return {
    id: `live-${notice.id}-${snapshot.raceControl}-${snapshot.yellowSector ?? 0}`,
    elapsedTime: snapshot.elapsedTime,
    title: descriptor.title,
    message: messageFor(descriptor, sector, notice.message),
    sector,
    tone: descriptor.tone,
    icon: descriptor.icon,
  };
}

function EventIcon({ kind }: { kind: RaceControlListItem["icon"] }) {
  if (kind === "alert") return <TriangleAlert aria-hidden="true" size={20} strokeWidth={2.1} />;
  if (kind === "shield") return <ShieldAlert aria-hidden="true" size={20} strokeWidth={2.1} />;
  return <Flag aria-hidden="true" size={21} strokeWidth={2.1} />;
}

export function RaceControlsPanel({ snapshot }: { snapshot: RaceSnapshot | null }) {
  const [showBlueFlags, setShowBlueFlags] = useState(true);
  const items = useMemo(() => {
    if (!snapshot) return [];
    const controlEvents = snapshot.events
      .filter((event) => event.type === "RACE_CONTROL")
      .slice(0, 24)
      .map((event, index) => itemFromEvent(event, snapshot, ([1, 2, 3] as const)[index % 3]));
    const liveNotice = itemFromLiveNotice(snapshot);
    if (liveNotice && !controlEvents.some((event) => event.elapsedTime === liveNotice.elapsedTime && event.title === liveNotice.title)) {
      controlEvents.unshift(liveNotice);
    }
    return controlEvents
      .filter((event) => showBlueFlags || event.tone !== "blue")
      .sort((left, right) => right.elapsedTime - left.elapsedTime)
      .slice(0, 24);
  }, [showBlueFlags, snapshot]);

  return (
    <section className={styles.panel} aria-label="Race Controls" data-race-controls data-event-count={items.length}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span><Radio aria-hidden="true" size={14} /> FIA RACE CONTROL</span>
          <h2>Race Controls</h2>
        </div>
        <label className={styles.toggle}>
          <span>BLUE FLAG</span>
          <input
            aria-label="Show blue flag messages"
            checked={showBlueFlags}
            onChange={(event) => setShowBlueFlags(event.target.checked)}
            type="checkbox"
          />
          <i aria-hidden="true" />
        </label>
      </header>

      <div className={styles.feed} role="log" aria-live="polite" aria-relevant="additions text">
        {items.length ? items.map((event, index) => (
          <article className={styles.event} data-tone={event.tone} data-latest={index === 0} key={event.id}>
            <div className={styles.timeline} aria-hidden="true">
              <span><EventIcon kind={event.icon} /></span>
            </div>
            <div className={styles.eventBody}>
              <div className={styles.eventMeta}>
                <strong>{event.title}</strong>
                <span><Clock3 aria-hidden="true" size={13} /> {formatRaceClock(event.elapsedTime)} · {formatRelativeTime(snapshot?.elapsedTime ?? event.elapsedTime, event.elapsedTime)}</span>
              </div>
              <div className={styles.message}>{event.message}</div>
              <small>Sector: {event.sector}</small>
            </div>
          </article>
        )) : (
          <div className={styles.empty}>
            <Flag aria-hidden="true" size={21} />
            <strong>NO FLAG CALLS YET</strong>
            <span>Sectors 1–3 are being monitored.</span>
          </div>
        )}
      </div>
    </section>
  );
}
