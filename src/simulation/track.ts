import type { CircuitDefinition, SegmentKind, TrackPoint, TrackSegment } from "@/domain/race";

// Silverstone Grand Prix circuit centreline derived from OpenStreetMap raceway ways
// (ODbL, © OpenStreetMap contributors), normalized for the game renderer on 2026-07-12.
const SILVERSTONE_ANCHORS: readonly TrackPoint[] = [
  { x: 0.0790, y: 0.6932 },
  { x: 0.3068, y: 0.5143 },
  { x: 0.3257, y: 0.5009 },
  { x: 0.3462, y: 0.4958 },
  { x: 0.3827, y: 0.4942 },
  { x: 0.4270, y: 0.4978 },
  { x: 0.4859, y: 0.5027 },
  { x: 0.5297, y: 0.4982 },
  { x: 0.5645, y: 0.4863 },
  { x: 0.6843, y: 0.4287 },
  { x: 0.6997, y: 0.4255 },
  { x: 0.7114, y: 0.4273 },
  { x: 0.7193, y: 0.4321 },
  { x: 0.7254, y: 0.4427 },
  { x: 0.7466, y: 0.4834 },
  { x: 0.7575, y: 0.4896 },
  { x: 0.7688, y: 0.4905 },
  { x: 0.7786, y: 0.4868 },
  { x: 0.7891, y: 0.4762 },
  { x: 0.8010, y: 0.4577 },
  { x: 0.8116, y: 0.4308 },
  { x: 0.8141, y: 0.4145 },
  { x: 0.8134, y: 0.4009 },
  { x: 0.8073, y: 0.3923 },
  { x: 0.7961, y: 0.3855 },
  { x: 0.4017, y: 0.1705 },
  { x: 0.3852, y: 0.1646 },
  { x: 0.3686, y: 0.1617 },
  { x: 0.3468, y: 0.1620 },
  { x: 0.3302, y: 0.1653 },
  { x: 0.3184, y: 0.1708 },
  { x: 0.3113, y: 0.1781 },
  { x: 0.3049, y: 0.2149 },
  { x: 0.3019, y: 0.2223 },
  { x: 0.2943, y: 0.2296 },
  { x: 0.2742, y: 0.2382 },
  { x: 0.2528, y: 0.2395 },
  { x: 0.2304, y: 0.2332 },
  { x: 0.2179, y: 0.2231 },
  { x: 0.2136, y: 0.2111 },
  { x: 0.2160, y: 0.2028 },
  { x: 0.2335, y: 0.1815 },
  { x: 0.2743, y: 0.1328 },
  { x: 0.3063, y: 0.1101 },
  { x: 0.3515, y: 0.0895 },
  { x: 0.3878, y: 0.0808 },
  { x: 0.4408, y: 0.0759 },
  { x: 0.7392, y: 0.0600 },
  { x: 0.7787, y: 0.0612 },
  { x: 0.8098, y: 0.0718 },
  { x: 0.8291, y: 0.0873 },
  { x: 0.8441, y: 0.1129 },
  { x: 0.8636, y: 0.1565 },
  { x: 0.8735, y: 0.1894 },
  { x: 0.8801, y: 0.2368 },
  { x: 0.8846, y: 0.2992 },
  { x: 0.8868, y: 0.3181 },
  { x: 0.8915, y: 0.3298 },
  { x: 0.9024, y: 0.3451 },
  { x: 0.9243, y: 0.3685 },
  { x: 0.9260, y: 0.3777 },
  { x: 0.9226, y: 0.3884 },
  { x: 0.9050, y: 0.4172 },
  { x: 0.8949, y: 0.4366 },
  { x: 0.8927, y: 0.4494 },
  { x: 0.8941, y: 0.4582 },
  { x: 0.9032, y: 0.4723 },
  { x: 0.9274, y: 0.4910 },
  { x: 0.9333, y: 0.4960 },
  { x: 0.9388, y: 0.5055 },
  { x: 0.9400, y: 0.5134 },
  { x: 0.9380, y: 0.5233 },
  { x: 0.9272, y: 0.5363 },
  { x: 0.9019, y: 0.5489 },
  { x: 0.8422, y: 0.5715 },
  { x: 0.8292, y: 0.5799 },
  { x: 0.8175, y: 0.5915 },
  { x: 0.5968, y: 0.8390 },
  { x: 0.5616, y: 0.8736 },
  { x: 0.5107, y: 0.9177 },
  { x: 0.4971, y: 0.9273 },
  { x: 0.4814, y: 0.9347 },
  { x: 0.4607, y: 0.9394 },
  { x: 0.4341, y: 0.9400 },
  { x: 0.4114, y: 0.9358 },
  { x: 0.3955, y: 0.9297 },
  { x: 0.3805, y: 0.9197 },
  { x: 0.3690, y: 0.9052 },
  { x: 0.3476, y: 0.8801 },
  { x: 0.3166, y: 0.8522 },
  { x: 0.1973, y: 0.7706 },
  { x: 0.1885, y: 0.7670 },
  { x: 0.1776, y: 0.7678 },
  { x: 0.1503, y: 0.7826 },
  { x: 0.1368, y: 0.7853 },
  { x: 0.1203, y: 0.7828 },
  { x: 0.0902, y: 0.7634 },
  { x: 0.0743, y: 0.7473 },
  { x: 0.0642, y: 0.7301 },
  { x: 0.0600, y: 0.7156 },
  { x: 0.0627, y: 0.7064 },
] as const;

const SILVERSTONE_CORNER_ANCHORS = [
  { number: 1, name: "Abbey", anchorIndex: 2 },
  { number: 2, name: "Farm", anchorIndex: 7 },
  { number: 3, name: "Village", anchorIndex: 12 },
  { number: 4, name: "The Loop", anchorIndex: 16 },
  { number: 5, name: "Aintree", anchorIndex: 22 },
  { number: 6, name: "Brooklands", anchorIndex: 31 },
  { number: 7, name: "Luffield", anchorIndex: 39 },
  { number: 8, name: "Woodcote", anchorIndex: 44 },
  { number: 9, name: "Copse", anchorIndex: 50 },
  { number: 10, name: "Maggotts", anchorIndex: 57 },
  { number: 11, name: "Maggotts", anchorIndex: 60 },
  { number: 12, name: "Becketts", anchorIndex: 64 },
  { number: 13, name: "Becketts", anchorIndex: 67 },
  { number: 14, name: "Chapel", anchorIndex: 71 },
  { number: 15, name: "Stowe", anchorIndex: 83 },
  { number: 16, name: "Vale", anchorIndex: 92 },
  { number: 17, name: "Club", anchorIndex: 95 },
  { number: 18, name: "Club", anchorIndex: 100 },
] as const;

const CURVE_SUBDIVISIONS = 6;
// The source centreline begins at the Club exit. The official start line sits
// farther along Hamilton Straight, with a 239 m run to Abbey. Rotating the
// sampled loop here gives negative starting-grid distances enough straight-line
// room instead of wrapping the back rows around Turn 18.
const SILVERSTONE_START_POINT_INDEX = 3;

const SPEED_BY_KIND: Record<SegmentKind, number> = {
  STRAIGHT: 325,
  FAST: 255,
  MEDIUM: 185,
  SLOW: 112,
};

const ACTIVE_AERO_RANGES = [
  [0.00, 0.10],
  [0.24, 0.32],
  [0.40, 0.50],
  [0.73, 0.83],
] as const;

function distance(a: TrackPoint, b: TrackPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function interpolateByTime(a: TrackPoint, b: TrackPoint, timeA: number, timeB: number, time: number): TrackPoint {
  const span = Math.max(0.000001, timeB - timeA);
  const progress = (time - timeA) / span;
  return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
}

// Centripetal Catmull–Rom avoids the loops and pointed overshoot that uniform
// splines create where a long Silverstone straight meets tightly packed corner points.
function catmullRom(p0: TrackPoint, p1: TrackPoint, p2: TrackPoint, p3: TrackPoint, progress: number): TrackPoint {
  const alpha = 0.5;
  const t0 = 0;
  const t1 = t0 + Math.pow(Math.max(distance(p0, p1), 0.000001), alpha);
  const t2 = t1 + Math.pow(Math.max(distance(p1, p2), 0.000001), alpha);
  const t3 = t2 + Math.pow(Math.max(distance(p2, p3), 0.000001), alpha);
  const t = t1 + (t2 - t1) * progress;
  const a1 = interpolateByTime(p0, p1, t0, t1, t);
  const a2 = interpolateByTime(p1, p2, t1, t2, t);
  const a3 = interpolateByTime(p2, p3, t2, t3, t);
  const b1 = interpolateByTime(a1, a2, t0, t2, t);
  const b2 = interpolateByTime(a2, a3, t1, t3, t);
  return interpolateByTime(b1, b2, t1, t2, t);
}

function smoothClosedCurve(anchors: readonly TrackPoint[], subdivisions = CURVE_SUBDIVISIONS): TrackPoint[] {
  const points: TrackPoint[] = [];
  const count = anchors.length;
  for (let index = 0; index < count; index += 1) {
    const p0 = anchors[(index - 1 + count) % count];
    const p1 = anchors[index];
    const p2 = anchors[(index + 1) % count];
    const p3 = anchors[(index + 2) % count];
    for (let step = 0; step < subdivisions; step += 1) {
      points.push(catmullRom(p0, p1, p2, p3, step / subdivisions));
    }
  }
  return points;
}

function rotateClosedCurve(points: readonly TrackPoint[], startIndex: number): TrackPoint[] {
  const normalizedIndex = ((startIndex % points.length) + points.length) % points.length;
  return [...points.slice(normalizedIndex), ...points.slice(0, normalizedIndex)];
}

function segmentKind(points: readonly TrackPoint[], index: number): SegmentKind {
  const count = points.length;
  const lookAhead = 4;
  const previous = points[(index - lookAhead + count) % count];
  const current = points[index];
  const next = points[(index + lookAhead) % count];
  const ax = current.x - previous.x;
  const ay = current.y - previous.y;
  const bx = next.x - current.x;
  const by = next.y - current.y;
  const denominator = Math.max(0.000001, Math.hypot(ax, ay) * Math.hypot(bx, by));
  const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator)));
  if (turn < 0.028) return "STRAIGHT";
  if (turn < 0.105) return "FAST";
  if (turn < 0.24) return "MEDIUM";
  return "SLOW";
}

function isActiveAeroDistance(ratio: number): boolean {
  return ACTIVE_AERO_RANGES.some(([start, end]) => ratio >= start && ratio <= end);
}

function buildCircuit(): CircuitDefinition {
  const points = rotateClosedCurve(smoothClosedCurve(SILVERSTONE_ANCHORS), SILVERSTONE_START_POINT_INDEX);
  const normalizedLengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]));
  const totalNormalized = normalizedLengths.reduce((sum, length) => sum + length, 0);
  const lengthMeters = 5_891;
  const cumulativeDistances: number[] = [0];
  const segments: TrackSegment[] = [];
  let cursor = 0;

  points.forEach((point, index) => {
    const segmentLength = (normalizedLengths[index] / totalNormalized) * lengthMeters;
    const kind = segmentKind(points, index);
    const nextPoint = points[(index + 1) % points.length];
    segments.push({
      id: `silverstone-${index + 1}`,
      startDistance: cursor,
      endDistance: cursor + segmentLength,
      length: segmentLength,
      kind,
      speedLimitKph: SPEED_BY_KIND[kind],
      activeAeroAllowed: isActiveAeroDistance(cursor / lengthMeters),
      p1: point,
      p2: nextPoint,
    });
    cursor += segmentLength;
    cumulativeDistances.push(cursor);
  });

  return {
    id: "silverstone-grand-prix-circuit",
    name: "Silverstone Circuit",
    country: "United Kingdom",
    lengthMeters,
    totalLaps: 52,
    points,
    segments,
    cumulativeDistances,
  };
}

export const SILVERSTONE_CIRCUIT = buildCircuit();

export const SILVERSTONE_CORNERS = SILVERSTONE_CORNER_ANCHORS.map(({ number, name, anchorIndex }) => ({
  number,
  name,
  distanceMeters: SILVERSTONE_CIRCUIT.cumulativeDistances[
    (anchorIndex * CURVE_SUBDIVISIONS - SILVERSTONE_START_POINT_INDEX + SILVERSTONE_CIRCUIT.points.length)
      % SILVERSTONE_CIRCUIT.points.length
  ],
}));

export const SILVERSTONE_SECTOR_ENDS = [
  SILVERSTONE_CORNERS[4].distanceMeters + 30,
  SILVERSTONE_CORNERS[10].distanceMeters,
] as const;

export function sectorAtDistance(distanceMeters: number): 1 | 2 | 3 {
  const lapDistance = normalizeLapDistance(distanceMeters);
  if (lapDistance < SILVERSTONE_SECTOR_ENDS[0]) return 1;
  if (lapDistance < SILVERSTONE_SECTOR_ENDS[1]) return 2;
  return 3;
}

export function upcomingCornerAtDistance(distanceMeters: number) {
  const lapDistance = normalizeLapDistance(distanceMeters);
  return SILVERSTONE_CORNERS.find((corner) => corner.distanceMeters >= lapDistance) ?? SILVERSTONE_CORNERS[0];
}

export function normalizeLapDistance(distanceMeters: number, trackLength = SILVERSTONE_CIRCUIT.lengthMeters): number {
  return ((distanceMeters % trackLength) + trackLength) % trackLength;
}

export function segmentIndexAtDistance(distanceMeters: number, circuit = SILVERSTONE_CIRCUIT): number {
  const lapDistance = normalizeLapDistance(distanceMeters, circuit.lengthMeters);
  const index = circuit.segments.findIndex((segment) => lapDistance < segment.endDistance);
  return index === -1 ? circuit.segments.length - 1 : index;
}

export function pointAtDistance(distanceMeters: number, circuit = SILVERSTONE_CIRCUIT): TrackPoint {
  const lapDistance = normalizeLapDistance(distanceMeters, circuit.lengthMeters);
  const index = segmentIndexAtDistance(lapDistance, circuit);
  const segment = circuit.segments[index];
  const progress = Math.max(0, Math.min(1, (lapDistance - segment.startDistance) / segment.length));
  return {
    x: segment.p1.x + (segment.p2.x - segment.p1.x) * progress,
    y: segment.p1.y + (segment.p2.y - segment.p1.y) * progress,
  };
}
