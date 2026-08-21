import { describe, expect, it } from "vitest";

import { qualifyingSectorLabelLayouts } from "@/components/race/qualifying-traffic-overview";
import { QUALIFYING_PIT_SAMPLES, QUALIFYING_TRACK_SAMPLES } from "@/simulation/qualifying-traffic";

interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= Number.EPSILON) return distance(point, start);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return distance(point, { x: start.x + deltaX * projection, y: start.y + deltaY * projection });
}

function sampledPoints(samples: Float32Array): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < samples.length; index += 2) points.push({ x: samples[index], y: samples[index + 1] });
  return points;
}

describe("qualifying circuit sector labels", () => {
  it("keeps every tag off the circuit and routes its leader through clear space", () => {
    const circuitPoints = [...sampledPoints(QUALIFYING_TRACK_SAMPLES), ...sampledPoints(QUALIFYING_PIT_SAMPLES)];

    for (const label of qualifyingSectorLabelLayouts()) {
      const tagOverlapsCircuit = circuitPoints.some((point) => (
        Math.abs(point.x - label.x) <= 0.085
        && Math.abs(point.y - label.y) <= 0.019
      ));
      expect(tagOverlapsCircuit, `${label.id} tag overlaps the racing or pit line`).toBe(false);

      const segments = [[label.anchor, label.elbow], [label.elbow, label.edge]] as const;
      const leaderCrossesCircuit = circuitPoints.some((point) => {
        // The callout intentionally starts on its sector. Once clear of that
        // anchor, neither segment may touch another part of the circuit.
        if (distance(point, label.anchor) < 0.018) return false;
        return segments.some(([start, end]) => distanceToSegment(point, start, end) < 0.008);
      });
      expect(leaderCrossesCircuit, `${label.id} leader crosses the racing or pit line`).toBe(false);
    }
  });

  it("docks Sector 2 in the exterior left margin instead of spanning the circuit", () => {
    const sectorTwo = qualifyingSectorLabelLayouts().find((label) => label.id === "S2");
    expect(sectorTwo).toBeDefined();
    expect(sectorTwo!.x).toBeLessThan(sectorTwo!.anchor.x);
    expect(sectorTwo!.edge.x).toBeLessThan(sectorTwo!.anchor.x);
    expect(sectorTwo!.elbow.x).toBe(sectorTwo!.edge.x);
  });
});
