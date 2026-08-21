"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { MapPinned } from "lucide-react";

import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import {
  activeQualifyingTrafficTargets,
  interpolateTrackProgress,
  QUALIFYING_PIT_BOX_PROGRESS,
  QUALIFYING_PIT_SAMPLES,
  QUALIFYING_TRACK_SAMPLE_COUNT,
  QUALIFYING_TRACK_SAMPLES,
  sampledPitPoint,
  sampledTrackPoint,
  type QualifyingTrafficTarget,
} from "@/simulation/qualifying-traffic";
import { SILVERSTONE_CIRCUIT, SILVERSTONE_SECTOR_ENDS } from "@/simulation/track";
import type { LiveQualifyingState, QualifyingCarPhase } from "@/simulation/weekend";

import styles from "./qualifying-traffic-overview.module.css";

interface AnimatedCar {
  carId: string;
  code: string;
  color: string;
  phase: QualifyingCarPhase;
  recoveryLap: boolean;
  player: boolean;
  pitLane: boolean;
  yielding: boolean;
  decisionState: QualifyingTrafficTarget["decisionState"];
  conflictCarId: string | null;
  conflictGapSeconds: number | null;
  fromProgress: number;
  targetProgress: number;
  currentProgress: number;
  animationStartedAt: number;
  animationDurationMs: number;
  yieldOffset: number;
  yieldTargetOffset: number;
  preferredLabelDirection: -1 | 1;
  labelOffsetX: number;
  labelOffsetY: number;
  labelTargetX: number;
  labelTargetY: number;
  labelAdjusted: boolean;
  nextLabelCollisionAt: number;
}

interface QualifyingTrafficOverviewProps {
  live: LiveQualifyingState;
  playerCars: readonly string[];
}

const TRACK_PATH = samplesToPath(QUALIFYING_TRACK_SAMPLES, true);
const PIT_PATH = samplesToPath(QUALIFYING_PIT_SAMPLES, false);
const SECTOR_RATIOS = [
  SILVERSTONE_SECTOR_ENDS[0] / SILVERSTONE_CIRCUIT.lengthMeters,
  SILVERSTONE_SECTOR_ENDS[1] / SILVERSTONE_CIRCUIT.lengthMeters,
] as const;
const SECTOR_PATHS = [
  samplesToRangePath(0, SECTOR_RATIOS[0]),
  samplesToRangePath(SECTOR_RATIOS[0], SECTOR_RATIOS[1]),
  samplesToRangePath(SECTOR_RATIOS[1], 1),
] as const;
const SECTOR_TWO_EXTERIOR_ANCHOR = closestTrackProgressInRange(
  { x: 0.214, y: 0.212 },
  SECTOR_RATIOS[0],
  SECTOR_RATIOS[1],
);
const SECTOR_LABEL_CONFIGS = [
  { id: "S1", progress: SECTOR_RATIOS[0] / 2, candidates: [{ x: 0.52, y: 0.3 }, { x: 0.52, y: 0.56 }, { x: 0.7, y: 0.78 }] },
  {
    id: "S2",
    progress: SECTOR_TWO_EXTERIOR_ANCHOR,
    candidates: [{ x: 0.11, y: 0.29 }, { x: 0.08, y: 0.39 }],
    exteriorDock: "RIGHT",
  },
  { id: "S3", progress: (SECTOR_RATIOS[1] + 1) / 2, candidates: [{ x: 0.3, y: 0.64 }, { x: 0.22, y: 0.72 }, { x: 0.42, y: 0.62 }] },
] as const;
const SECTOR_LABEL_HALF_WIDTH = 0.085;
const SECTOR_LABEL_HALF_HEIGHT = 0.019;
const SECTOR_LABEL_TRACK_CLEARANCE = 0.015;
const OPPONENT_MARKER_RADIUS = 5.2;
const PLAYER_MARKER_RADIUS = 8.4;
const PLAYER_MARKER_CORE_RADIUS = 3.4;
const OPPONENT_LABEL_FONT_SIZE = 12;
const PLAYER_LABEL_FONT_SIZE = 15;
const MARKER_CORE_OPACITY = 1;
const DIAGNOSTICS_INTERVAL_MS = 180;

function closestTrackProgressInRange(
  target: { x: number; y: number },
  startProgress: number,
  endProgress: number,
): number {
  const startIndex = Math.max(0, Math.floor(startProgress * QUALIFYING_TRACK_SAMPLE_COUNT));
  const endIndex = Math.min(QUALIFYING_TRACK_SAMPLE_COUNT - 1, Math.ceil(endProgress * QUALIFYING_TRACK_SAMPLE_COUNT));
  let closestIndex = startIndex;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const deltaX = QUALIFYING_TRACK_SAMPLES[index * 2] - target.x;
    const deltaY = QUALIFYING_TRACK_SAMPLES[index * 2 + 1] - target.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared < closestDistance) {
      closestDistance = distanceSquared;
      closestIndex = index;
    }
  }

  return closestIndex / QUALIFYING_TRACK_SAMPLE_COUNT;
}

function labelSlotClearsCircuit(x: number, y: number): boolean {
  const clearsSamples = (samples: Float32Array) => {
    for (let index = 0; index < samples.length; index += 2) {
      if (
        Math.abs(samples[index] - x) <= SECTOR_LABEL_HALF_WIDTH + SECTOR_LABEL_TRACK_CLEARANCE
        && Math.abs(samples[index + 1] - y) <= SECTOR_LABEL_HALF_HEIGHT + SECTOR_LABEL_TRACK_CLEARANCE
      ) return false;
    }
    return true;
  };
  return clearsSamples(QUALIFYING_TRACK_SAMPLES) && clearsSamples(QUALIFYING_PIT_SAMPLES);
}

function labelEdgeToward(anchor: { x: number; y: number }, label: { x: number; y: number }) {
  const deltaX = anchor.x - label.x;
  const deltaY = anchor.y - label.y;
  const scale = Math.min(
    Math.abs(deltaX) > 0.0001 ? SECTOR_LABEL_HALF_WIDTH / Math.abs(deltaX) : Number.POSITIVE_INFINITY,
    Math.abs(deltaY) > 0.0001 ? SECTOR_LABEL_HALF_HEIGHT / Math.abs(deltaY) : Number.POSITIVE_INFINITY,
  );
  return { x: label.x + deltaX * scale, y: label.y + deltaY * scale };
}

function samplesToPath(samples: Float32Array, close: boolean): string {
  let path = "";
  for (let index = 0; index < samples.length; index += 2) {
    path += `${index === 0 ? "M" : "L"}${samples[index].toFixed(4)} ${samples[index + 1].toFixed(4)} `;
  }
  return close ? `${path}Z` : path;
}

function samplesToRangePath(startProgress: number, endProgress: number): string {
  const startIndex = Math.max(0, Math.floor(startProgress * QUALIFYING_TRACK_SAMPLE_COUNT));
  const endIndex = Math.min(QUALIFYING_TRACK_SAMPLE_COUNT - 1, Math.ceil(endProgress * QUALIFYING_TRACK_SAMPLE_COUNT));
  let path = "";
  for (let index = startIndex; index <= endIndex; index += 1) {
    path += `${index === startIndex ? "M" : "L"}${QUALIFYING_TRACK_SAMPLES[index * 2].toFixed(4)} ${QUALIFYING_TRACK_SAMPLES[index * 2 + 1].toFixed(4)} `;
  }
  if (endProgress >= 1) path += `L${QUALIFYING_TRACK_SAMPLES[0].toFixed(4)} ${QUALIFYING_TRACK_SAMPLES[1].toFixed(4)}`;
  return path;
}

function pitAnnotation(routeProgress: number, position: { x: number; y: number }) {
  const point = sampledPitPoint(routeProgress);
  return {
    point,
    x: position.x,
    y: position.y,
  };
}

function timingLine(progress: number, halfLength = 0.016) {
  const point = sampledTrackPoint(progress);
  const before = sampledTrackPoint(progress - 0.004);
  const after = sampledTrackPoint(progress + 0.004);
  const tangentX = after.x - before.x;
  const tangentY = after.y - before.y;
  const magnitude = Math.max(0.0001, Math.hypot(tangentX, tangentY));
  const normalX = -tangentY / magnitude;
  const normalY = tangentX / magnitude;
  return {
    x1: point.x - normalX * halfLength,
    y1: point.y - normalY * halfLength,
    x2: point.x + normalX * halfLength,
    y2: point.y + normalY * halfLength,
  };
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function markerColor(carId: string): string {
  const driver = DRIVER_BY_ID.get(carId);
  const team = driver ? TEAM_BY_ID.get(driver.teamId) : null;
  return `#${(team?.primaryColor ?? 0x20d7e7).toString(16).padStart(6, "0")}`;
}

function currentProgress(marker: AnimatedCar, now: number): number {
  if (marker.animationDurationMs <= 0) return marker.targetProgress;
  const amount = Math.min(1, Math.max(0, (now - marker.animationStartedAt) / marker.animationDurationMs));
  return interpolateTrackProgress(marker.fromProgress, marker.targetProgress, amount);
}

export function qualifyingSectorLabelLayouts() {
  return SECTOR_LABEL_CONFIGS.map((label) => {
    const anchor = sampledTrackPoint(label.progress);
    const position = label.candidates.find((candidate) => labelSlotClearsCircuit(candidate.x, candidate.y)) ?? label.candidates.at(-1)!;
    const exteriorDock = "exteriorDock" in label ? label.exteriorDock : null;
    const edge = exteriorDock === "RIGHT"
      ? { x: position.x + SECTOR_LABEL_HALF_WIDTH, y: position.y }
      : labelEdgeToward(anchor, position);
    const elbow = exteriorDock === "RIGHT"
      ? { x: edge.x, y: anchor.y }
      : { x: anchor.x + (edge.x - anchor.x) * 0.52, y: anchor.y };
    return { ...label, ...position, anchor, edge, elbow };
  });
}

function StaticCircuitBackdrop() {
  const pitBox = sampledPitPoint(QUALIFYING_PIT_BOX_PROGRESS);
  const sectorLabels = qualifyingSectorLabelLayouts();
  const boundaries = [timingLine(SECTOR_RATIOS[0]), timingLine(SECTOR_RATIOS[1])];
  const startFinishLine = timingLine(0, 0.021);
  const pitEntryLabel = pitAnnotation(0.07, { x: 0.1, y: 0.8 });
  const pitExitLabel = pitAnnotation(0.93, { x: 0.3, y: 0.44 });
  return <svg aria-hidden="true" className={styles.circuitBackdrop} preserveAspectRatio="xMidYMid meet" viewBox="0 0 1 1">
    <path className={styles.trackHalo} d={TRACK_PATH} />
    <path className={styles.trackLine} d={TRACK_PATH} />
    {SECTOR_PATHS.map((path, index) => <path className={styles.sectorPath} data-sector={`S${index + 1}`} d={path} key={`S${index + 1}`} />)}
    {boundaries.map((line, index) => <line className={styles.sectorBoundary} data-boundary={`S${index + 1}-S${index + 2}`} key={`boundary-${index}`} {...line} />)}
    <line className={styles.startFinishLine} data-start-finish="true" {...startFinishLine} />
    <path className={styles.pitLine} d={PIT_PATH} />
    <circle className={styles.pitBox} cx={pitBox.x} cy={pitBox.y} r=".008" />
    <g className={styles.sectorLabels} data-sector-labels="true">
      {sectorLabels.map((label, index) => <g className={styles.sectorLabel} data-sector={label.id} data-sector-label={label.id} key={label.id}>
        <polyline className={styles.sectorLabelLeader} points={`${label.anchor.x},${label.anchor.y} ${label.elbow.x},${label.elbow.y} ${label.edge.x},${label.edge.y}`} />
        <circle className={styles.sectorLabelAnchor} cx={label.anchor.x} cy={label.anchor.y} r=".0035" />
        <rect height=".038" rx=".009" width=".17" x={label.x - 0.085} y={label.y - 0.019} />
        <text x={label.x} y={label.y}>{`SECTOR ${String(index + 1).padStart(2, "0")}`}</text>
      </g>)}
    </g>
    <g className={styles.circuitLabels}>
      <line className={styles.pitLabelLeader} data-map-label="PIT_ENTRY_LEADER" x1={pitEntryLabel.point.x} x2={pitEntryLabel.x} y1={pitEntryLabel.point.y} y2={pitEntryLabel.y} />
      <line className={styles.pitLabelLeader} data-map-label="PIT_EXIT_LEADER" x1={pitExitLabel.point.x} x2={pitExitLabel.x} y1={pitExitLabel.point.y} y2={pitExitLabel.y} />
      <g className={styles.pitLabel} data-map-label="PIT_ENTRY">
        <rect height=".024" rx=".006" width=".105" x={pitEntryLabel.x - 0.0525} y={pitEntryLabel.y - 0.012} />
        <text x={pitEntryLabel.x} y={pitEntryLabel.y}>PIT ENTRY</text>
      </g>
      <g className={styles.pitLabel} data-map-label="PIT_EXIT">
        <rect height=".024" rx=".006" width=".09" x={pitExitLabel.x - 0.045} y={pitExitLabel.y - 0.012} />
        <text x={pitExitLabel.x} y={pitExitLabel.y}>PIT EXIT</text>
      </g>
    </g>
  </svg>;
}

const MemoStaticCircuitBackdrop = memo(StaticCircuitBackdrop);

interface PositionedMarker {
  marker: AnimatedCar;
  x: number;
  y: number;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right + 2 && a.right + 2 > b.left && a.top < b.bottom + 2 && a.bottom + 2 > b.top;
}

function phaseMarkerColor(marker: AnimatedCar): string {
  if (marker.phase === "ABORTED_LAP") return "#ff5269";
  if (marker.phase === "PUSH_LAP") return "#ff5269";
  if (marker.phase === "OUT_LAP") return "#7b858f";
  if (marker.phase === "IN_LAP" || marker.phase === "PIT_ENTRY") return "#82969d";
  return "#9aa9ae";
}

function drawCarGlyph(context: CanvasRenderingContext2D, marker: AnimatedCar, x: number, y: number, now: number) {
  const phaseColor = phaseMarkerColor(marker);
  if (marker.phase === "PUSH_LAP") {
    const pulse = 7 + (Math.sin(now / 155) + 1) * 2.6 + (marker.player ? 2.5 : 0);
    context.beginPath();
    context.arc(x, y, pulse, 0, Math.PI * 2);
    context.strokeStyle = phaseColor;
    context.lineWidth = 1.3;
    context.globalAlpha = 0.22 + (Math.sin(now / 155) + 1) * 0.12;
    context.stroke();
    context.globalAlpha = 1;
  }
  if (marker.phase === "ABORTED_LAP") {
    const ring = marker.player ? 11.5 : 9;
    context.beginPath();
    context.arc(x, y, ring, 0, Math.PI * 2);
    context.strokeStyle = "#ff5269";
    context.lineWidth = 1.7;
    context.stroke();
    context.beginPath();
    context.moveTo(x - ring * .55, y - ring * .55);
    context.lineTo(x + ring * .55, y + ring * .55);
    context.moveTo(x + ring * .55, y - ring * .55);
    context.lineTo(x - ring * .55, y + ring * .55);
    context.stroke();
  }
  if (marker.yielding) {
    const pulse = 8.5 + (Math.sin(now / 180) + 1) * 1.8 + (marker.player ? 2 : 0);
    context.beginPath();
    context.arc(x, y, pulse, 0, Math.PI * 2);
    context.strokeStyle = "#f2b84b";
    context.lineWidth = 1.5;
    context.globalAlpha = 0.62 + (Math.sin(now / 180) + 1) * 0.12;
    context.stroke();
    context.globalAlpha = 1;
  }
  context.beginPath();
  context.arc(x, y, marker.player ? PLAYER_MARKER_RADIUS : OPPONENT_MARKER_RADIUS, 0, Math.PI * 2);
  context.fillStyle = marker.player ? "#051016" : phaseColor;
  context.globalAlpha = MARKER_CORE_OPACITY;
  context.fill();
  context.globalAlpha = 1;
  if (marker.player) {
    context.lineWidth = 2.4;
    context.strokeStyle = marker.color;
    context.shadowColor = marker.color;
    context.shadowBlur = 11;
    context.stroke();
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(x, y, PLAYER_MARKER_CORE_RADIUS, 0, Math.PI * 2);
    context.fillStyle = phaseColor;
    context.globalAlpha = MARKER_CORE_OPACITY;
    context.fill();
    context.globalAlpha = 1;
  } else {
    context.lineWidth = 1.25;
    context.strokeStyle = "rgba(2, 8, 12, .96)";
    context.stroke();
  }
}

function labelBoxAt(x: number, y: number, offsetX: number, offsetY: number, textWidth: number, fontSize: number): LabelBox {
  const labelX = x + offsetX;
  const labelY = y + offsetY;
  return {
    left: offsetX < 0 ? labelX - textWidth : labelX,
    right: offsetX < 0 ? labelX : labelX + textWidth,
    top: labelY - fontSize,
    bottom: labelY + 2,
  };
}

function drawCarLabel(
  context: CanvasRenderingContext2D,
  positioned: PositionedMarker,
  occupied: LabelBox[],
  width: number,
  height: number,
  now: number,
) {
  const { marker, x, y } = positioned;
  const fontSize = marker.player ? PLAYER_LABEL_FONT_SIZE : OPPONENT_LABEL_FONT_SIZE;
  const fontWeight = marker.player ? 950 : 900;
  context.font = `${fontWeight} ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const textWidth = context.measureText(marker.code).width;
  const direction = marker.preferredLabelDirection;
  if (now >= marker.nextLabelCollisionAt) {
    marker.nextLabelCollisionAt = now + 220;
    const preferredReach = marker.player ? 18 : 12;
    const preferredY = marker.player ? -14 : -10;
    const preferredBox = labelBoxAt(x, y, direction * preferredReach, preferredY, textWidth, fontSize);
    const preferredFits = preferredBox.left >= 2 && preferredBox.right <= width - 2 && preferredBox.top >= 2 && preferredBox.bottom <= height - 2;
    if (preferredFits && !occupied.some((existing) => boxesOverlap(preferredBox, existing))) {
      marker.labelTargetX = direction * preferredReach;
      marker.labelTargetY = preferredY;
    } else {
    const reach = marker.player ? 18 : 12;
    const candidates: readonly (readonly [number, number])[] = marker.player
      ? [[direction * reach, -14], [direction * 23, 19], [direction * 28, -23], [-direction * reach, -14], [-direction * 25, 19]]
      : [[direction * reach, -10], [direction * 18, 15], [direction * 23, -19], [-direction * reach, -10], [-direction * 19, 15], [0, -20]];
    for (const [offsetX, offsetY] of candidates) {
      const box = labelBoxAt(x, y, offsetX, offsetY, textWidth, fontSize);
      if (box.left < 2 || box.right > width - 2 || box.top < 2 || box.bottom > height - 2) continue;
      if (!occupied.some((existing) => boxesOverlap(box, existing))) {
        marker.labelTargetX = offsetX;
        marker.labelTargetY = offsetY;
        break;
      }
    }
    }
  }
  marker.labelOffsetX += (marker.labelTargetX - marker.labelOffsetX) * 0.2;
  marker.labelOffsetY += (marker.labelTargetY - marker.labelOffsetY) * 0.2;
  const offsetX = marker.labelOffsetX;
  const offsetY = marker.labelOffsetY;
  const labelX = x + offsetX;
  const labelY = y + offsetY;
  const chosenBox = labelBoxAt(x, y, offsetX, offsetY, textWidth, fontSize);
  occupied.push(chosenBox);

  const preferredReach = marker.player ? 18 : 12;
  const adjusted = Math.abs(marker.labelTargetX - direction * preferredReach) > 1 || Math.abs(marker.labelTargetY - (marker.player ? -14 : -10)) > 1;
  marker.labelAdjusted = adjusted;
  if (adjusted) {
    context.beginPath();
    context.moveTo(x + Math.sign(offsetX) * (marker.player ? PLAYER_MARKER_RADIUS : OPPONENT_MARKER_RADIUS), y);
    context.lineTo(labelX - Math.sign(offsetX) * 2, labelY - fontSize * 0.42);
    context.strokeStyle = marker.player ? "rgba(230, 246, 248, .62)" : "rgba(139, 161, 169, .42)";
    context.lineWidth = 0.8;
    context.stroke();
  }
  context.textAlign = offsetX < 0 ? "right" : "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "rgba(3, 11, 16, .84)";
  context.fillRect(chosenBox.left - 3, chosenBox.top - 2, chosenBox.right - chosenBox.left + 6, chosenBox.bottom - chosenBox.top + 4);
  context.lineWidth = marker.player ? 4.4 : 3.6;
  context.strokeStyle = "rgba(3, 10, 15, .96)";
  context.strokeText(marker.code, labelX, labelY);
  context.fillStyle = "#f4f8f9";
  context.globalAlpha = 1;
  context.fillText(marker.code, labelX, labelY);
  context.globalAlpha = 1;
  const decisionLabel = marker.phase === "ABORTED_LAP" ? "ABORTED" : marker.yielding ? "YIELD" : marker.decisionState === "TRAFFIC" ? "TRAFFIC" : null;
  if (decisionLabel) {
    const yieldY = labelY + 9;
    context.font = "900 7.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = offsetX < 0 ? "right" : "left";
    context.lineWidth = 2.5;
    context.strokeStyle = "rgba(3, 10, 15, .98)";
    context.strokeText(decisionLabel, labelX, yieldY);
    context.fillStyle = marker.phase === "ABORTED_LAP" ? "#ff5269" : marker.yielding ? "#f2b84b" : "#f2b84b";
    context.fillText(decisionLabel, labelX, yieldY);
    if (marker.conflictGapSeconds !== null) {
      const gapY = yieldY + 8;
      const gapLabel = `GAP ${marker.conflictGapSeconds.toFixed(1)}s`;
      context.strokeText(gapLabel, labelX, gapY);
      context.fillText(gapLabel, labelX, gapY);
    }
  }
  return Math.abs(marker.labelOffsetX - marker.labelTargetX) > 0.25 || Math.abs(marker.labelOffsetY - marker.labelTargetY) > 0.25;
}

function canvasCircuitGeometry(progress: number, pitLane: boolean, width: number, height: number) {
  const point = pitLane ? sampledPitPoint(progress) : sampledTrackPoint(progress);
  const before = pitLane ? sampledPitPoint(Math.max(0, progress - 0.008)) : sampledTrackPoint(progress - 0.004);
  const after = pitLane ? sampledPitPoint(Math.min(1, progress + 0.008)) : sampledTrackPoint(progress + 0.004);
  const scale = Math.min(width, height);
  const offsetX = (width - scale) / 2;
  const offsetY = (height - scale) / 2;
  const tangentX = after.x - before.x;
  const tangentY = after.y - before.y;
  const magnitude = Math.max(0.0001, Math.hypot(tangentX, tangentY));
  return {
    x: offsetX + point.x * scale,
    y: offsetY + point.y * scale,
    normalX: -tangentY / magnitude,
    normalY: tangentX / magnitude,
  };
}

function syncAnimationTarget(
  marker: AnimatedCar | undefined,
  target: QualifyingTrafficTarget,
  now: number,
  durationMs: number,
  playerCars: ReadonlyMap<string, number>,
): AnimatedCar {
  const driver = DRIVER_BY_ID.get(target.carId);
  const existingProgress = marker ? currentProgress(marker, now) : target.progress;
  const playerIndex = playerCars.get(target.carId);
  const preferredLabelDirection = marker?.preferredLabelDirection ?? ((playerIndex === 0 || (playerIndex === undefined && stableHash(target.carId) % 2 === 0)) ? -1 : 1);
  const preferredX = preferredLabelDirection * (playerIndex === undefined ? 8 : 14);
  const preferredY = playerIndex === undefined ? -6 : -11;
  return {
    carId: target.carId,
    code: driver?.shortName ?? target.carId.slice(0, 3).toUpperCase(),
    color: markerColor(target.carId),
    phase: target.phase,
    recoveryLap: target.recoveryLap,
    player: playerIndex !== undefined,
    pitLane: target.pitLane,
    yielding: target.yielding,
    decisionState: target.decisionState,
    conflictCarId: target.conflictCarId,
    conflictGapSeconds: target.conflictGapSeconds,
    fromProgress: marker?.pitLane === target.pitLane ? existingProgress : target.progress,
    targetProgress: target.progress,
    currentProgress: existingProgress,
    animationStartedAt: now,
    animationDurationMs: durationMs,
    yieldOffset: marker?.yieldOffset ?? 0,
    yieldTargetOffset: target.yielding ? (stableHash(target.carId) % 2 === 0 ? -7 : 7) : 0,
    preferredLabelDirection,
    labelOffsetX: marker?.labelOffsetX ?? preferredX,
    labelOffsetY: marker?.labelOffsetY ?? preferredY,
    labelTargetX: marker?.labelTargetX ?? preferredX,
    labelTargetY: marker?.labelTargetY ?? preferredY,
    labelAdjusted: marker?.labelAdjusted ?? false,
    nextLabelCollisionAt: marker?.nextLabelCollisionAt ?? 0,
  };
}

export const QualifyingTrafficOverview = memo(function QualifyingTrafficOverview({ live, playerCars }: QualifyingTrafficOverviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef<Map<string, AnimatedCar>>(new Map());
  const frameRef = useRef(0);
  const drawRef = useRef<((now?: number) => void) | null>(null);
  const visibleRef = useRef(true);
  const pausedRef = useRef(live.paused);
  const playerKey = playerCars.join("|");
  const activeTargets = useMemo(() => activeQualifyingTrafficTargets(live.cars), [live.cars]);
  const counts = useMemo(() => ({
    track: activeTargets.filter((car) => !car.pitLane).length,
    pit: activeTargets.filter((car) => car.pitLane).length,
    flying: activeTargets.filter((car) => car.phase === "PUSH_LAP").length,
  }), [activeTargets]);
  const sectorHighlights = useMemo(() => live.timing.bestSectorTimes.map((time, index) => ({
    sector: index + 1,
    time,
    driver: live.timing.bestSectorDriverIds[index] ? DRIVER_BY_ID.get(live.timing.bestSectorDriverIds[index]!)?.shortName ?? "—" : "—",
  })), [live.timing.bestSectorDriverIds, live.timing.bestSectorTimes]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const animationMarkers = markersRef.current;

    let width = 1;
    let height = 1;
    let destroyed = false;
    let lastDiagnosticsAt = Number.NEGATIVE_INFINITY;
    canvas.dataset.renderMode = "CIRCUIT";

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, host!.clientWidth);
      height = Math.max(1, host!.clientHeight);
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (canvas!.width !== pixelWidth || canvas!.height !== pixelHeight) {
        canvas!.width = pixelWidth;
        canvas!.height = pixelHeight;
        canvas!.style.width = `${width}px`;
        canvas!.style.height = `${height}px`;
      }
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw(now = performance.now()) {
      if (destroyed) return;
      context!.clearRect(0, 0, width, height);
      const markers = [...animationMarkers.values()].sort((a, b) => Number(a.player) - Number(b.player));
      const positioned: PositionedMarker[] = [];
      let animating = false;
      for (const marker of markers) {
        marker.currentProgress = currentProgress(marker, now);
        if (now < marker.animationStartedAt + marker.animationDurationMs) animating = true;
        if (!pausedRef.current) marker.yieldOffset += (marker.yieldTargetOffset - marker.yieldOffset) * 0.16;
        if (!pausedRef.current && Math.abs(marker.yieldOffset - marker.yieldTargetOffset) > 0.1) animating = true;
        const point = canvasCircuitGeometry(marker.currentProgress, marker.pitLane, width, height);
        positioned.push({ marker, x: point.x + point.normalX * marker.yieldOffset, y: point.y + point.normalY * marker.yieldOffset });
      }
      const positionedById = new Map(positioned.map((item) => [item.marker.carId, item]));
      for (const item of positioned) {
        if (!item.marker.conflictCarId || (item.marker.decisionState !== "TRAFFIC" && item.marker.decisionState !== "ABORTED")) continue;
        const conflict = positionedById.get(item.marker.conflictCarId);
        if (!conflict) continue;
        context!.save();
        context!.beginPath();
        context!.setLineDash([4, 4]);
        context!.moveTo(item.x, item.y);
        context!.lineTo(conflict.x, conflict.y);
        context!.strokeStyle = item.marker.decisionState === "ABORTED" ? "rgba(255,82,105,.75)" : "rgba(244,211,94,.62)";
        context!.lineWidth = 1.2;
        context!.stroke();
        context!.restore();
      }
      for (const item of positioned) {
        drawCarGlyph(context!, item.marker, item.x, item.y, now);
        if ((item.marker.phase === "PUSH_LAP" || item.marker.yielding) && !pausedRef.current) animating = true;
      }
      const occupied: LabelBox[] = [];
      for (const item of [...positioned].sort((a, b) => Number(b.marker.player) - Number(a.marker.player) || a.marker.carId.localeCompare(b.marker.carId))) {
        if (drawCarLabel(context!, item, occupied, width, height, now) && !pausedRef.current) animating = true;
      }
      if (now - lastDiagnosticsAt >= DIAGNOSTICS_INTERVAL_MS) {
        lastDiagnosticsAt = now;
        let overlapPairs = 0;
        for (let first = 0; first < positioned.length; first += 1) {
          for (let second = first + 1; second < positioned.length; second += 1) {
            if (Math.hypot(positioned[first].x - positioned[second].x, positioned[first].y - positioned[second].y) < 5) overlapPairs += 1;
          }
        }
        const trackProgresses = markers.filter((marker) => !marker.pitLane).map((marker) => marker.currentProgress).sort((a, b) => a - b);
        let minimumProgressGap = 1;
        if (trackProgresses.length > 1) {
          for (let index = 0; index < trackProgresses.length; index += 1) {
            const next = trackProgresses[(index + 1) % trackProgresses.length] + (index === trackProgresses.length - 1 ? 1 : 0);
            minimumProgressGap = Math.min(minimumProgressGap, next - trackProgresses[index]);
          }
        }
        canvas!.dataset.activeCars = String(markers.length);
        canvas!.dataset.labelledCars = String(positioned.length);
        canvas!.dataset.adjustedLabels = String(markers.filter((marker) => marker.labelAdjusted).length);
        canvas!.dataset.flyingCars = String(markers.filter((marker) => marker.phase === "PUSH_LAP").length);
        canvas!.dataset.outLapCars = String(markers.filter((marker) => marker.phase === "OUT_LAP").length);
        canvas!.dataset.inLapCars = String(markers.filter((marker) => marker.phase === "IN_LAP").length);
        canvas!.dataset.pitEntryCars = String(markers.filter((marker) => marker.phase === "PIT_ENTRY").length);
        canvas!.dataset.recoveryLapCars = String(markers.filter((marker) => marker.phase === "IN_LAP" && marker.recoveryLap).length);
        canvas!.dataset.yieldingCars = String(markers.filter((marker) => marker.yielding).length);
        canvas!.dataset.abortedCars = String(markers.filter((marker) => marker.phase === "ABORTED_LAP").length);
        canvas!.dataset.trafficConflicts = String(markers.filter((marker) => marker.decisionState === "TRAFFIC").length);
        canvas!.dataset.markerOverlapPairs = String(overlapPairs);
        canvas!.dataset.minimumProgressGap = minimumProgressGap.toFixed(6);
      }
      frameRef.current = 0;
      if (animating && visibleRef.current && document.visibilityState === "visible") frameRef.current = window.requestAnimationFrame(draw);
    }

    function schedule(now?: number) {
      if (destroyed || frameRef.current || !visibleRef.current || document.visibilityState !== "visible") return;
      frameRef.current = window.requestAnimationFrame((time) => draw(now ?? time));
    }

    drawRef.current = schedule;
    resize();
    const resizeObserver = new ResizeObserver(() => {
      resize();
      schedule();
    });
    resizeObserver.observe(host);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry?.isIntersecting ?? true;
      if (visibleRef.current) schedule();
      else if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    });
    intersectionObserver.observe(host);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") schedule();
      else if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    schedule();

    return () => {
      destroyed = true;
      drawRef.current = null;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      animationMarkers.clear();
    };
  }, []);

  useEffect(() => {
    pausedRef.current = live.paused;
    const now = performance.now();
    const playerOrder = new Map(playerKey.split("|").filter(Boolean).map((carId, index) => [carId, index]));
    const durationMs = live.paused ? 0 : Math.max(65, 1_000 / Math.max(1, live.speed));
    const activeIds = new Set<string>();
    for (const target of activeTargets) {
      activeIds.add(target.carId);
      markersRef.current.set(
        target.carId,
        syncAnimationTarget(markersRef.current.get(target.carId), target, now, durationMs, playerOrder),
      );
    }
    for (const carId of markersRef.current.keys()) {
      if (!activeIds.has(carId)) markersRef.current.delete(carId);
    }
    drawRef.current?.();
  }, [activeTargets, live.paused, live.speed, playerKey]);

  return <section className={styles.panel} data-mode="CIRCUIT" data-paused={live.paused} data-traffic-overview="true">
    <header className={styles.header}>
      <span className={styles.title}><MapPinned aria-hidden="true" size={17} /><span><small>{live.session} LIVE TRAFFIC</small><strong>SILVERSTONE CIRCUIT</strong></span></span>
      <span className={styles.metrics}><span><small>TRACK</small><strong>{counts.track}</strong></span><span><small>PIT</small><strong>{counts.pit}</strong></span><span data-live={counts.flying > 0}><small>FLYING</small><strong>{counts.flying}</strong></span></span>
    </header>
    <div className={styles.visual} ref={hostRef}>
      <MemoStaticCircuitBackdrop />
      <canvas
        aria-label={`${counts.track} cars on track and ${counts.pit} cars moving in the pit lane`}
        className={styles.canvas}
        data-animation-state="REF_INTERPOLATION"
        data-coordinate-model="NORMALIZED_PROGRESS"
        data-label-anchoring="PERSISTENT_OFFSETS"
        data-ai-label-size={OPPONENT_LABEL_FONT_SIZE}
        data-ai-marker-radius={OPPONENT_MARKER_RADIUS}
        data-marker-core-opacity={MARKER_CORE_OPACITY}
        data-player-label-size={PLAYER_LABEL_FONT_SIZE}
        data-player-marker-radius={PLAYER_MARKER_RADIUS}
        data-label-treatment="WHITE_DARK_PLATE"
        data-marker-language="PHASE_CODED"
        data-renderer="SINGLE_CANVAS"
        data-track-samples={QUALIFYING_TRACK_SAMPLE_COUNT}
        ref={canvasRef}
        role="img"
      />
    </div>
    {/*
      * Sector timings and the marker legend sit in their own band below the
      * circuit. As overlays they covered the track surface, which is the one
      * region on this screen that has to stay fully readable.
      */}
    <footer className={styles.circuitFooter}>
      <div className={styles.sectorRibbon} aria-label="Session best sector times">
        <b>FASTEST SECTORS</b>
        {sectorHighlights.map((highlight) => <span data-set={highlight.time !== null} key={highlight.sector}><small>S{highlight.sector}</small><strong>{highlight.time === null ? "—.---" : highlight.time.toFixed(3)}</strong><em>{highlight.driver}</em></span>)}
      </div>
      <span className={styles.stateLegend} aria-label="Live circuit marker legend">
        <span><i data-phase="PUSH_LAP" />Flying Lap</span>
        <span><i data-phase="OUT_LAP" />Out Lap</span>
        <span><i data-phase="IN_LAP" />In Lap</span>
        <span><i data-phase="PIT_ENTRY" />Pit Entry</span>
        <span><i data-phase="YIELDING" />Yielding</span>
        <span><i data-phase="ABORTED_LAP" />Aborted</span>
        <span><i data-player="true" />Player Car</span>
      </span>
    </footer>
  </section>;
});
