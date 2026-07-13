import type { TrackPoint } from "@/domain/race";

// Silverstone's OSM bounding box is roughly 1.33 km × 2.16 km.
// Rotate it for a desktop landscape map while preserving that physical ratio.
const SOURCE_WIDTH_TO_HEIGHT = 1.33 / 2.16;

export interface TrackViewport {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  minWorldX: number;
  minWorldY: number;
}

export function toTrackWorld(point: TrackPoint): TrackPoint {
  return {
    x: point.y,
    y: (1 - point.x) * SOURCE_WIDTH_TO_HEIGHT,
  };
}

export function createTrackViewport(
  points: readonly TrackPoint[],
  width: number,
  height: number,
  padding = 34,
): TrackViewport {
  const worldPoints = points.map(toTrackWorld);
  const minWorldX = Math.min(...worldPoints.map((point) => point.x));
  const maxWorldX = Math.max(...worldPoints.map((point) => point.x));
  const minWorldY = Math.min(...worldPoints.map((point) => point.y));
  const maxWorldY = Math.max(...worldPoints.map((point) => point.y));
  const worldWidth = Math.max(0.000001, maxWorldX - minWorldX);
  const worldHeight = Math.max(0.000001, maxWorldY - minWorldY);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight);
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;

  return {
    width,
    height,
    scale,
    offsetX: (width - drawnWidth) / 2,
    offsetY: (height - drawnHeight) / 2,
    minWorldX,
    minWorldY,
  };
}

export function projectTrackPoint(point: TrackPoint, viewport: TrackViewport): TrackPoint {
  const world = toTrackWorld(point);
  return {
    x: viewport.offsetX + (world.x - viewport.minWorldX) * viewport.scale,
    y: viewport.offsetY + (world.y - viewport.minWorldY) * viewport.scale,
  };
}

function pointToSegmentDistance(point: TrackPoint, start: TrackPoint, end: TrackPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function distanceToCenterline(point: TrackPoint, projectedCenterline: readonly TrackPoint[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < projectedCenterline.length; index += 1) {
    const start = projectedCenterline[index];
    const end = projectedCenterline[(index + 1) % projectedCenterline.length];
    nearest = Math.min(nearest, pointToSegmentDistance(point, start, end));
  }
  return nearest;
}
