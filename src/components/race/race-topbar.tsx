"use client";

import { useEffect, useRef, useState } from "react";

import {
  CloudSun,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  ShieldCheck,
  Thermometer,
  Zap,
} from "lucide-react";

import type { RaceSnapshot, SimulationSpeed } from "@/domain/race";
import { latestRaceControlNotice } from "@/simulation/race-control-feed";

const SPEEDS: readonly SimulationSpeed[] = [1, 2, 4, 8, 16];

export type RaceStartPhase = "MENU" | "LIGHTS" | "GO" | "RACING";

interface RaceTopbarProps {
  snapshot: RaceSnapshot | null;
  speed: SimulationSpeed;
  paused: boolean;
  autoPauseEnabled: boolean;
  autoPauseReason: string | null;
  startPhase: RaceStartPhase;
  onPlay: () => void;
  onPause: () => void;
  onSetAutoPause: (enabled: boolean) => void;
  onSetSpeed: (speed: SimulationSpeed) => void;
  onReset: () => void;
}

function getWeatherLabel(snapshot: RaceSnapshot | null): string {
  const conditions = new Set(snapshot?.weather.sectors?.map((sector) => sector.condition) ?? []);
  if (conditions.size > 1) return "MIXED";
  if (conditions.size === 1) return [...conditions][0].replace("_", " ");
  return (snapshot?.weather.condition ?? "DRY").replace("_", " ");
}

function getRaceControlLabel(snapshot: RaceSnapshot | null): string {
  if (snapshot?.raceControl === "YELLOW") return `YELLOW S${snapshot.yellowSector ?? "—"}`;
  if (snapshot?.raceControl === "SAFETY_CAR") return `SC · ${snapshot.safetyCarPhase}`;
  return snapshot?.raceControl.replace("_", " ") ?? "GREEN";
}

export function RaceTopbar({
  snapshot,
  speed,
  paused,
  autoPauseEnabled,
  autoPauseReason,
  startPhase,
  onPlay,
  onPause,
  onSetAutoPause,
  onSetSpeed,
  onReset,
}: RaceTopbarProps) {
  const raceControlLabel = getRaceControlLabel(snapshot);
  const weatherLabel = getWeatherLabel(snapshot);
  const controlStatus = raceControlLabel;
  const playLabel = paused ? "Resume race" : "Pause race";
  const notice = snapshot ? latestRaceControlNotice(snapshot) : null;
  const controlMessage = notice?.message ?? "TRACK CLEAR · RACE CONTROL MONITORING";
  const controlMessageTime = notice?.elapsedTime ?? 0;
  const controlMessageClock = `${Math.floor(controlMessageTime / 60).toString().padStart(2, "0")}:${Math.floor(controlMessageTime % 60).toString().padStart(2, "0")}`;
  const flagState = snapshot?.raceControl ?? "GREEN";
  const previousFlagState = useRef(flagState);
  const [flagFlashing, setFlagFlashing] = useState(false);

  useEffect(() => {
    if (previousFlagState.current === flagState) return;
    previousFlagState.current = flagState;
    setFlagFlashing(true);
    const timer = window.setTimeout(() => setFlagFlashing(false), 1_650);
    return () => window.clearTimeout(timer);
  }, [flagState]);

  return (
    <header className="topbar topbar--telemetry" aria-label="Live race header">
      <div className="brand-block brand-block--signal">
        <span className="brand-mark" aria-hidden="true"><RadioTower size={20} strokeWidth={2.4} /></span>
        <div className="brand-copy">
          <strong>PROJECT PITWALL</strong>
          <small>LIVE RACE OPERATIONS</small>
        </div>
        <span className="brand-signal" aria-hidden="true"><i /><i /><i /></span>
      </div>

      <div className="broadcast-strip broadcast-strip--iconic">
        <section className="broadcast-session session-copy-panel" aria-label="Round 9, Great Britain, race session">
          <div className="hud-stat-copy">
            <span>ROUND 09</span>
            <strong>RACE</strong>
            <small>GBR</small>
          </div>
        </section>

        <section
          className={`broadcast-status track-flag-panel condition--${flagState.toLowerCase()} ${flagFlashing ? "is-flashing" : ""}`}
          aria-label={`Race control ${controlStatus}, ${snapshot?.pitLaneOpen === false ? "pit lane closed" : "pit lane open"}`}
          aria-live="polite"
        >
          <div className="hud-stat-copy">
            <span>TRACK FLAG</span>
            <strong>{controlStatus}</strong>
            <small className="pit-lane-state">{snapshot?.pitLaneOpen === false ? "PIT CLOSED" : "PIT OPEN"}</small>
          </div>
        </section>

        <section aria-live="polite" className={`broadcast-control-message priority--${(notice?.priority ?? "NORMAL").toLowerCase()}`}>
          <div className="control-message-meta">
            <span>FIA RACE CONTROL · {controlMessageClock}</span>
            <span>{notice?.category ?? "Other"} · {notice?.scope ?? "Track"}{notice?.sector ? ` S${notice.sector}` : ""} · LAP {notice?.lapNumber ?? 1}{notice?.driverNumber ? ` · CAR ${notice.driverNumber}` : ""}</span>
          </div>
          <strong>{controlMessage}</strong>
        </section>

        <section className="broadcast-conditions conditions-cluster" aria-label={`Track ${Math.round(snapshot?.weather.trackTemperature ?? 31)} degrees, weather ${weatherLabel}`}>
          <span className="condition-reading">
            <Thermometer size={16} aria-hidden="true" />
            <span><small>TRACK</small><strong>{Math.round(snapshot?.weather.trackTemperature ?? 31)}°</strong></span>
          </span>
          <span className="condition-reading">
            <CloudSun size={16} aria-hidden="true" />
            <span><small>WEATHER</small><strong>{weatherLabel}</strong></span>
          </span>
        </section>
      </div>

      <nav className="transport transport--iconic" aria-label="Race playback controls">
        <button
          aria-label={playLabel}
          className="pause-button transport-orb"
          disabled={startPhase !== "RACING"}
          onClick={paused ? onPlay : onPause}
          title={playLabel}
          type="button"
        >
          {paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
          <span className="transport-orb-ring" aria-hidden="true" />
        </button>

        <button
          aria-label={`Important race-control event auto pause ${autoPauseEnabled ? "on" : "off"}`}
          aria-pressed={autoPauseEnabled}
          className="auto-pause-toggle auto-event-hold"
          onClick={() => onSetAutoPause(!autoPauseEnabled)}
          title={autoPauseReason ?? "Pause on yellow, VSC, safety car and restart calls"}
          type="button"
        >
          <ShieldCheck size={16} aria-hidden="true" />
          <span>AUTO</span>
          <small>EVENT HOLD</small>
        </button>

        <div className="speed-selector" role="group" aria-label="Simulation speed">
          <span className="speed-selector-label"><Zap size={13} aria-hidden="true" /> SIM RATE</span>
          <div className="speed-buttons speed-rail">
            <i className="speed-rail-line" aria-hidden="true" />
            {SPEEDS.map((value) => (
              <button
                aria-label={`Set simulation speed to ${value} times`}
                aria-pressed={speed === value}
                className={`speed-step ${speed === value ? "is-active" : ""}`}
                key={value}
                onClick={() => onSetSpeed(value)}
                title={`${value}× simulation speed`}
                type="button"
              >
                <i className="speed-pip" aria-hidden="true" />
                <span>{value}×</span>
              </button>
            ))}
          </div>
        </div>

        <button className="reset-button reset-button--icon" aria-label="Reset race and return to start menu" onClick={onReset} title="Reset race" type="button">
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </nav>
    </header>
  );
}
