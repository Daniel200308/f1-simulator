import { describe, expect, it } from "vitest";

import { createTrackViewport, distanceToCenterline, projectTrackPoint, toTrackWorld } from "@/components/race/track-viewport";
import { pointAtDistance, SILVERSTONE_CIRCUIT } from "@/simulation/track";

describe("track viewport", () => {
  it.each([
    [1_920, 1_080],
    [2_560, 1_440],
    [3_440, 1_440],
    [1_280, 1_024],
  ])("preserves the track aspect ratio at %d×%d", (width, height) => {
    const viewport = createTrackViewport(SILVERSTONE_CIRCUIT.points, width, height);
    const projected = SILVERSTONE_CIRCUIT.points.map((point) => projectTrackPoint(point, viewport));
    const world = SILVERSTONE_CIRCUIT.points.map(toTrackWorld);
    const boundsWidth = Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x));
    const boundsHeight = Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y));
    const worldWidth = Math.max(...world.map((point) => point.x)) - Math.min(...world.map((point) => point.x));
    const worldHeight = Math.max(...world.map((point) => point.y)) - Math.min(...world.map((point) => point.y));
    expect(boundsWidth / boundsHeight).toBeCloseTo(worldWidth / worldHeight, 10);
    expect(Math.min(...projected.map((point) => point.x))).toBeGreaterThanOrEqual(33.99);
    expect(Math.min(...projected.map((point) => point.y))).toBeGreaterThanOrEqual(33.99);
  });

  it("places every sampled car position exactly on the projected centreline", () => {
    const viewport = createTrackViewport(SILVERSTONE_CIRCUIT.points, 1_600, 900);
    const projectedCenterline = SILVERSTONE_CIRCUIT.points.map((point) => projectTrackPoint(point, viewport));
    for (let distance = 0; distance < SILVERSTONE_CIRCUIT.lengthMeters; distance += 73) {
      const carPoint = projectTrackPoint(pointAtDistance(distance), viewport);
      expect(distanceToCenterline(carPoint, projectedCenterline)).toBeLessThan(0.000001);
    }
  });
});
