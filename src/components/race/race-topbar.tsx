"use client";

import type { CSSProperties } from "react";
import {
  CloudSun,
  Flag,
  Gauge,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  ShieldCheck,
  Thermometer,
  Timer,
  Zap,
} from "lucide-react";

import type { RaceSnapshot, SimulationSpeed } from "@/domain/race";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

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

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hours, minutes, secs].map((value) => value.toString().padStart(2, "0")).join(":");
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
  const currentLap = snapshot?.cars.find((car) => car.racePosition === 1)?.currentLap ?? 1;
  const totalLaps = SILVERSTONE_CIRCUIT.totalLaps;
  const lapProgress = Math.min(100, Math.max(0, (currentLap / totalLaps) * 100));
  const raceControlLabel = getRaceControlLabel(snapshot);
  const weatherLabel = getWeatherLabel(snapshot);
  const controlStatus = startPhase === "RACING" ? raceControlLabel : "GRID";
  const playLabel = paused ? "Resume race" : "Pause race";
  const lapStyle = { "--lap-progress": `${lapProgress * 3.6}deg` } as CSSProperties;

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
        <section className="broadcast-session status-cluster" aria-label="Round 9, Great Britain, race session">
          <span className="cluster-icon" aria-hidden="true"><Flag size={16} /></span>
          <div>
            <span>ROUND 09</span>
            <strong>RACE</strong>
            <em>GBR</em>
          </div>
        </section>

        <section className="broadcast-lap lap-cluster" aria-label={`Lap ${currentLap} of ${totalLaps}`}>
          <span className="lap-dial" style={lapStyle} aria-hidden="true">
            <Gauge size={16} />
            <strong>{currentLap}</strong>
          </span>
          <span className="lap-copy"><small>LAP</small><em>/ {totalLaps}</em></span>
          <i className="lap-progress" aria-hidden="true"><b style={{ width: `${lapProgress}%` }} /></i>
        </section>

        <section className="broadcast-clock status-cluster" aria-label={`Race time ${formatTime(snapshot?.elapsedTime ?? 0)}`}>
          <span className="cluster-icon" aria-hidden="true"><Timer size={16} /></span>
          <div><span>RACE TIME</span><strong>{formatTime(snapshot?.elapsedTime ?? 0)}</strong></div>
        </section>

        <section
          className={`broadcast-status status-cluster condition--${(snapshot?.raceControl ?? "GREEN").toLowerCase()}`}
          aria-label={`Race control ${controlStatus}, ${snapshot?.pitLaneOpen === false ? "pit lane closed" : "pit lane open"}`}
          aria-live="polite"
        >
          <span className="cluster-icon race-control-icon" aria-hidden="true"><Flag size={17} /></span>
          <div>
            <span>RACE CONTROL</span>
            <strong>{controlStatus}</strong>
            <small className="pit-lane-state">{snapshot?.pitLaneOpen === false ? "PIT CLOSED" : "PIT OPEN"}</small>
          </div>
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
