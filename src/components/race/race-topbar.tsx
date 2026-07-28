"use client";

import { useEffect, useRef, useState } from "react";

import {
  Cloud,
  CloudRain,
  CloudSun,
  Droplets,
  Pause,
  Play,
  RotateCcw,
  Sun,
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
  startPhase: RaceStartPhase;
  onPlay: () => void;
  onPause: () => void;
  onSetSpeed: (speed: SimulationSpeed) => void;
  onReset: () => void;
}

function getWeatherLabel(snapshot: RaceSnapshot | null): string {
  const conditions = new Set(snapshot?.weather.sectors?.map((sector) => sector.condition) ?? []);
  if (conditions.size > 1) return "MIXED";
  if (conditions.size === 1) return [...conditions][0].replace("_", " ");
  return (snapshot?.weather.condition ?? "DRY").replace("_", " ");
}

function WeatherGlyph({ label }: { label: string }) {
  if (label === "DRY") return <Sun aria-hidden="true" size={22} />;
  if (label === "CLOUDY") return <Cloud aria-hidden="true" size={22} />;
  if (label === "LIGHT RAIN" || label === "HEAVY RAIN") return <CloudRain aria-hidden="true" size={22} />;
  return <CloudSun aria-hidden="true" size={22} />;
}

interface TrackFlagDisplay {
  label: "GREEN" | "YELLOW" | "VIRTUAL SAFETY CAR" | "SAFETY CAR" | "SAFETY CAR ENDING" | "RED FLAG";
  tone: "green" | "yellow" | "red";
  key: string;
}

export function getTrackFlagDisplay(snapshot: RaceSnapshot | null, redFlag = false): TrackFlagDisplay {
  if (redFlag || snapshot?.raceControl === "RED_FLAG") return { label: "RED FLAG", tone: "red", key: `red-flag-${snapshot?.redFlagPhase ?? "active"}` };
  if (snapshot?.raceControl === "YELLOW") return { label: "YELLOW", tone: "yellow", key: "yellow" };
  if (snapshot?.raceControl === "VSC") return { label: "VIRTUAL SAFETY CAR", tone: "yellow", key: "vsc" };
  if (snapshot?.raceControl === "SAFETY_CAR" && snapshot.safetyCarPhase === "RESTART") {
    return { label: "SAFETY CAR ENDING", tone: "yellow", key: "sc-ending" };
  }
  if (snapshot?.raceControl === "SAFETY_CAR") return { label: "SAFETY CAR", tone: "yellow", key: "sc" };
  return { label: "GREEN", tone: "green", key: "green" };
}

export function RaceTopbar({
  snapshot,
  speed,
  paused,
  startPhase,
  onPlay,
  onPause,
  onSetSpeed,
  onReset,
}: RaceTopbarProps) {
  const weatherLabel = getWeatherLabel(snapshot);
  const playLabel = paused ? "Resume race" : "Pause race";
  const notice = snapshot ? latestRaceControlNotice(snapshot) : null;
  const controlHeadline = notice?.headline ?? "TRACK CLEAR";
  const controlDetail = notice?.detail ?? "RACE CONTROL MONITORING · PIT LANE OPEN";
  const controlMessageTime = notice?.elapsedTime ?? 0;
  const controlMessageClock = `${Math.floor(controlMessageTime / 60).toString().padStart(2, "0")}:${Math.floor(controlMessageTime % 60).toString().padStart(2, "0")}`;
  const liveRedFlag = snapshot?.raceControl === "RED_FLAG";
  const flagDisplay = getTrackFlagDisplay(snapshot, liveRedFlag);
  const flashKey = `${flagDisplay.key}:${snapshot?.safetyCarLappedCarsMayOvertake ? "wave-by" : "standard"}`;
  const previousFlagState = useRef(flashKey);
  const [flagFlashing, setFlagFlashing] = useState(false);
  const trackTemperature = Math.round(snapshot?.weather.trackTemperature ?? 31);
  const trackWetness = Math.round((snapshot?.weather.trackWetness ?? 0) * 100);

  useEffect(() => {
    if (previousFlagState.current === flashKey) return;
    previousFlagState.current = flashKey;
    setFlagFlashing(true);
    const timer = window.setTimeout(() => setFlagFlashing(false), 1_650);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  return (
    <header className="topbar topbar--telemetry" aria-label="Live race header">
      <div className="brand-block brand-block--signal">
        <div className="brand-copy">
          <strong>PROJECT PITWALL</strong>
          <small>SILVERSTONE PITWALL</small>
        </div>
      </div>

      <div className="broadcast-strip broadcast-strip--iconic">
        <section className="broadcast-session session-copy-panel" aria-label="Round 9, Great Britain, race session">
          <div className="hud-stat-copy">
            <span>ROUND 09</span>
            <strong>RACE</strong>
            <small>SILVERSTONE</small>
          </div>
        </section>

        <section
          className={`broadcast-status track-flag-panel condition--${flagDisplay.tone} status--${flagDisplay.key} ${flagFlashing ? "is-flashing" : ""}`}
          aria-label={`Race control ${flagDisplay.label}, ${snapshot?.pitLaneOpen === false ? "pit lane closed" : "pit lane open"}`}
          aria-live="polite"
        >
          <div className="hud-stat-copy">
            <strong>{flagDisplay.label}</strong>
            <small className="pit-lane-state">{snapshot?.pitLaneOpen === false ? "PIT CLOSED" : "PIT OPEN"}</small>
          </div>
        </section>

        <section aria-live="polite" className={`broadcast-control-message flag--${flagDisplay.tone} priority--${(notice?.priority ?? "NORMAL").toLowerCase()}`}>
          <div className="control-message-meta">
            <span>FIA RACE CONTROL · {controlMessageClock}</span>
          </div>
          <strong className="control-message-title" title={controlHeadline}>{controlHeadline}</strong>
          <p className="control-message-detail" title={controlDetail}>{controlDetail}</p>
        </section>

        <section className="broadcast-conditions conditions-cluster" aria-label={`Track ${Math.round(snapshot?.weather.trackTemperature ?? 31)} degrees, weather ${weatherLabel}`}>
          <span className="condition-reading condition-reading--temperature">
            <i className="condition-glyph"><Thermometer size={22} aria-hidden="true" /><b style={{ height: `${Math.max(18, Math.min(88, (trackTemperature - 15) * 3))}%` }} /></i>
            <span><small>TRACK TEMP</small><strong><b>{trackTemperature}</b><em>°C</em></strong></span>
          </span>
          <span className="condition-reading condition-reading--weather" data-weather={weatherLabel.replaceAll(" ", "_")}>
            <i className="condition-glyph"><WeatherGlyph label={weatherLabel} /></i>
            <span><small>WEATHER</small><strong>{weatherLabel}</strong><em><Droplets aria-hidden="true" size={10} /> {trackWetness}% WET</em></span>
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
