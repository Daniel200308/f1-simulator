"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CircleGauge,
  Clock3,
  Flag,
  Gauge,
  History,
  Pause,
  Play,
  RotateCcw,
  Thermometer,
  Trophy,
  Wrench,
  X,
} from "lucide-react";

import { formatLapTime } from "@/components/race/format";
import { DRIVER_BY_ID } from "@/fixtures/grid";
import type { RaceReport } from "@/simulation/race-report";
import {
  advanceReplay,
  replayMetadata,
  seekReplay,
  type RaceReplayRecording,
  type ReplaySeekResult,
} from "@/simulation/race-replay";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";

import styles from "./replay-report-panel.module.css";

export type ReplayReportView = "REPLAY" | "REPORT";

export interface ReplayReportPanelProps {
  open: boolean;
  recording: RaceReplayRecording;
  report: RaceReport;
  onClose: () => void;
  onReplaySeek?: (seek: ReplaySeekResult) => void;
  initialView?: ReplayReportView;
}

const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;

function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = Math.floor(safe % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function ReplayReportPanel({
  open,
  recording,
  report,
  onClose,
  onReplaySeek,
  initialView = "REPORT",
}: ReplayReportPanelProps) {
  const metadata = useMemo(() => replayMetadata(recording), [recording]);
  const [view, setView] = useState<ReplayReportView>(initialView);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1);
  const [playhead, setPlayhead] = useState(recording.startedAt);
  const playheadRef = useRef(recording.startedAt);
  const animationFrame = useRef<number | null>(null);
  const previousAnimationTime = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !playing || view !== "REPLAY") return;
    const animate = (time: number) => {
      const previous = previousAnimationTime.current ?? time;
      previousAnimationTime.current = time;
      const step = advanceReplay(recording, playheadRef.current, (time - previous) / 1_000, playbackRate);
      playheadRef.current = step.elapsedTime;
      setPlayhead(step.elapsedTime);
      onReplaySeek?.(step.seek);
      if (step.ended) {
        setPlaying(false);
        previousAnimationTime.current = null;
        return;
      }
      animationFrame.current = window.requestAnimationFrame(animate);
    };
    animationFrame.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
      previousAnimationTime.current = null;
    };
  }, [onReplaySeek, open, playbackRate, playing, recording, view]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPlaying(false);
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const boundedPlayhead = Math.max(recording.startedAt, Math.min(recording.endedAt, playhead));
  const seek = seekReplay(recording, boundedPlayhead);
  const selectedFrame = seek.frame;
  const nextCars = new Map(seek.nextFrame?.cars.map((car) => [car.carId, car]) ?? []);
  const replayCars = selectedFrame
    ? [...selectedFrame.cars].sort((left, right) => left.racePosition - right.racePosition).slice(0, 6)
    : [];
  const winner = report.classification[0];

  function updatePlayhead(value: number) {
    playheadRef.current = value;
    setPlayhead(value);
    onReplaySeek?.(seekReplay(recording, value));
  }

  function selectView(nextView: ReplayReportView) {
    setView(nextView);
    if (nextView !== "REPLAY") setPlaying(false);
  }

  function closePanel() {
    setPlaying(false);
    onClose();
  }

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) closePanel();
    }}>
      <section aria-labelledby="race-review-title" aria-modal="true" className={styles.panel} ref={panelRef} role="dialog">
        <header className={styles.header}>
          <div className={styles.titleMark}><Flag aria-hidden="true" size={21} strokeWidth={2.2} /></div>
          <div className={styles.title}>
            <span>POST-RACE OPERATIONS</span>
            <h2 id="race-review-title">Race review</h2>
          </div>
          <div aria-label="Review view" className={styles.viewSwitch} role="group">
            <button aria-pressed={view === "REPORT"} onClick={() => selectView("REPORT")} type="button"><Trophy aria-hidden="true" size={15} />Report</button>
            <button aria-pressed={view === "REPLAY"} onClick={() => selectView("REPLAY")} type="button"><History aria-hidden="true" size={15} />Replay</button>
          </div>
          <button aria-label="Close race review" className={styles.closeButton} onClick={closePanel} ref={closeRef} type="button"><X aria-hidden="true" size={19} /></button>
        </header>

        {view === "REPORT" ? (
          <div className={styles.reportView}>
            <section className={styles.reportHero}>
              <div className={styles.winnerMark}><Trophy aria-hidden="true" size={28} /></div>
              <div>
                <span>{report.completed ? "RACE WINNER" : "CURRENT LEADER"}</span>
                <strong>{winner?.driverName ?? "Classification pending"}</strong>
                <small>{winner ? `${winner.teamName} · P${winner.position}${report.completed ? "" : " · PROVISIONAL"}` : "No classified cars"}</small>
              </div>
              <div className={styles.fastestLap}>
                <Gauge aria-hidden="true" size={19} />
                <span>FASTEST LAP</span>
                <strong>{report.fastestLap ? formatLapTime(report.fastestLap.lapTimeSeconds) : "—"}</strong>
                <small>{report.fastestLap?.driverShortName ?? "NO TIME"}</small>
              </div>
            </section>

            <section aria-label="Race totals" className={styles.statRail}>
              <div><ChevronRight aria-hidden="true" size={16} /><span>OVERTAKES</span><strong>{report.totals.overtakes}</strong></div>
              <div><Wrench aria-hidden="true" size={16} /><span>PIT STOPS</span><strong>{report.totals.pitStops}</strong></div>
              <div><AlertTriangle aria-hidden="true" size={16} /><span>INCIDENTS</span><strong>{report.totals.incidents}</strong></div>
              <div><Thermometer aria-hidden="true" size={16} /><span>THERMAL</span><strong>{report.totals.thermalWarnings}</strong></div>
              <div><Clock3 aria-hidden="true" size={16} /><span>DURATION</span><strong>{formatClock(report.elapsedTimeSeconds)}</strong></div>
            </section>

            <div className={styles.reportGrid}>
              <section className={styles.classification}>
                <header><span>CLASSIFICATION</span><small>{report.completed ? "FINAL" : "PROVISIONAL"}</small></header>
                <div className={styles.tableHead}><span>P</span><span>DRIVER</span><span>FROM</span><span>BEST</span><span>STOPS</span></div>
                <div className={styles.classificationList}>
                  {report.classification.map((entry) => (
                    <div className={styles.classificationRow} key={entry.carId}>
                      <strong>{String(entry.position).padStart(2, "0")}</strong>
                      <span><b>{entry.driverShortName}</b><small>{entry.teamName}</small></span>
                      <em className={entry.positionsGained > 0 ? styles.positive : entry.positionsGained < 0 ? styles.negative : undefined}>{entry.positionsGained > 0 ? `+${entry.positionsGained}` : entry.positionsGained}</em>
                      <time>{formatLapTime(entry.bestLapTimeSeconds)}</time>
                      <i>{entry.pitStops}</i>
                    </div>
                  ))}
                </div>
              </section>

              <aside className={styles.debrief}>
                <header><span>PLAYER DEBRIEF</span><small>{report.playerReports.length} CARS</small></header>
                <div className={styles.debriefList}>
                  {report.playerReports.map((player) => (
                    <article key={player.carId}>
                      <div className={styles.debriefDriver}><span>{player.driverShortName}</span><strong>P{player.finishPosition}</strong></div>
                      <div className={styles.debriefMetrics}><span>GRID <b>P{player.gridPosition}</b></span><span>GAIN <b>{player.positionsGained > 0 ? `+${player.positionsGained}` : player.positionsGained}</b></span><span>OVT <b>{player.overtakes}</b></span></div>
                      <div className={styles.tyreSequence}>{player.tyreStrategy.map((compound, index) => <span data-compound={compound} key={`${compound}-${index}`}>{compound.slice(0, 1)}</span>)}</div>
                      <footer><span><CircleGauge aria-hidden="true" size={13} />{player.strategyEvents.length} calls</span><span className={player.criticalThermalWarningCount > 0 ? styles.warning : undefined}><Thermometer aria-hidden="true" size={13} />{player.thermalWarnings.length} thermal</span></footer>
                    </article>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        ) : (
          <div className={styles.replayView}>
            <section className={styles.replayStage}>
              <div className={styles.replayTelemetry}>
                <div><span>PLAYHEAD</span><strong>{formatClock(boundedPlayhead)}</strong></div>
                <div><span>LAP</span><strong>{selectedFrame?.cars[0]?.currentLap ?? "—"}</strong></div>
                <div><span>CONTROL</span><strong data-control={selectedFrame?.raceControl}>{selectedFrame?.raceControl.replace("_", " ") ?? "—"}</strong></div>
                <div><span>TRACK</span><strong>{selectedFrame ? `${Math.round(selectedFrame.trackWetness * 100)}% WET` : "—"}</strong></div>
              </div>
              <div className={styles.replayStageBody}>
                <div className={styles.playbackSummary}>
                  <History aria-hidden="true" size={34} />
                  <span>FRAME {seek.frameIndex + 1} / {metadata.frameCount}</span>
                  <strong>{selectedFrame?.cars.length ?? 0} cars · tick {selectedFrame?.tick ?? 0}</strong>
                  <small>{metadata.droppedFrameCount > 0 ? `${metadata.droppedFrameCount} older frames compacted` : "Full-resolution recording"}</small>
                </div>
                <div aria-label="Replay running order" className={styles.replayField}>
                  {replayCars.map((car) => {
                    const nextCar = nextCars.get(car.carId);
                    const totalDistance = car.totalDistance + ((nextCar?.totalDistance ?? car.totalDistance) - car.totalDistance) * seek.interpolation;
                    const lapProgress = ((totalDistance % SILVERSTONE_CIRCUIT.lengthMeters) + SILVERSTONE_CIRCUIT.lengthMeters) % SILVERSTONE_CIRCUIT.lengthMeters / SILVERSTONE_CIRCUIT.lengthMeters;
                    const driver = DRIVER_BY_ID.get(car.carId);
                    return (
                      <div key={car.carId}>
                        <strong>P{car.racePosition}</strong>
                        <span>{driver?.shortName ?? car.carId.slice(0, 3).toUpperCase()}</span>
                        <i><b style={{ width: `${lapProgress * 100}%` }} /></i>
                        <em>{Math.round(car.speedKph)}<small> km/h</small></em>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className={styles.timeline}>
              <div className={styles.timelineControls}>
                <button aria-label={playing ? "Pause replay" : "Play replay"} className={styles.playButton} disabled={!metadata.seekable} onClick={() => setPlaying((current) => !current)} type="button">{playing ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}</button>
                <button aria-label="Return replay to start" className={styles.restartButton} onClick={() => updatePlayhead(recording.startedAt)} type="button"><RotateCcw aria-hidden="true" size={16} /></button>
                <div aria-label="Replay speed" className={styles.rateRail} role="group">{PLAYBACK_RATES.map((rate) => <button aria-pressed={rate === playbackRate} key={rate} onClick={() => setPlaybackRate(rate)} type="button">{rate}×</button>)}</div>
                <span>{formatClock(recording.startedAt)}</span>
                <input aria-label="Replay timeline" max={recording.endedAt} min={recording.startedAt} onChange={(event) => updatePlayhead(Number(event.currentTarget.value))} step="0.1" type="range" value={boundedPlayhead} />
                <span>{formatClock(recording.endedAt)}</span>
              </div>
              <div className={styles.eventTicks}>{recording.events.map((event) => {
                const duration = Math.max(0.001, recording.endedAt - recording.startedAt);
                const position = ((event.elapsedTime - recording.startedAt) / duration) * 100;
                return <button aria-label={`${formatClock(event.elapsedTime)} ${event.message}`} data-severity={event.severity} key={event.id} onClick={() => updatePlayhead(event.elapsedTime)} style={{ left: `${Math.max(0, Math.min(100, position))}%` }} type="button" />;
              })}</div>
            </section>

            <section className={styles.eventLog}>
              <header><span>KEY MOMENTS</span><small>{recording.events.length} EVENTS</small></header>
              <div>{recording.events.map((event) => (
                <button key={event.id} onClick={() => updatePlayhead(event.elapsedTime)} type="button">
                  <time>{formatClock(event.elapsedTime)}</time><i data-severity={event.severity} /><span><b>{event.kind.replace("_", " ")}</b><small>{event.message}</small></span><ChevronRight aria-hidden="true" size={14} />
                </button>
              ))}</div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
