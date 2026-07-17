import { describe, expect, it } from "vitest";

import { normalizeLapDistance, pointAtDistance, segmentIndexAtDistance, SILVERSTONE_CIRCUIT, SILVERSTONE_CORNERS, SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE, SILVERSTONE_OVERTAKE_DETECTION_DISTANCE } from "@/simulation/track";

describe("track geometry", () => {
  it("uses the current Silverstone Grand Prix dimensions", () => {
    expect(SILVERSTONE_CIRCUIT.name).toBe("Silverstone Circuit");
    expect(SILVERSTONE_CIRCUIT.lengthMeters).toBe(5_891);
    expect(SILVERSTONE_CIRCUIT.totalLaps).toBe(52);
    expect(SILVERSTONE_CIRCUIT.points.length).toBeGreaterThan(400);
  });

  it("wraps distance at the timing line", () => {
    expect(normalizeLapDistance(SILVERSTONE_CIRCUIT.lengthMeters + 25)).toBeCloseTo(25);
    expect(normalizeLapDistance(-25)).toBeCloseTo(SILVERSTONE_CIRCUIT.lengthMeters - 25);
  });

  it("maps a full lap back to the start point", () => {
    expect(pointAtDistance(0)).toEqual(pointAtDistance(SILVERSTONE_CIRCUIT.lengthMeters));
  });

  it("always resolves a segment", () => {
    expect(segmentIndexAtDistance(SILVERSTONE_CIRCUIT.lengthMeters - 0.001)).toBe(SILVERSTONE_CIRCUIT.segments.length - 1);
  });

  it("defines all 18 Silverstone corners in lap order", () => {
    expect(SILVERSTONE_CORNERS).toHaveLength(18);
    expect(SILVERSTONE_CORNERS.map((corner) => corner.number)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    expect(SILVERSTONE_CORNERS.map((corner) => corner.distanceMeters)).toEqual(
      [...SILVERSTONE_CORNERS].map((corner) => corner.distanceMeters).sort((a, b) => a - b),
    );
    expect(SILVERSTONE_CORNERS[0].name).toBe("Abbey");
    expect(SILVERSTONE_CORNERS[17].name).toBe("Club");
    expect(SILVERSTONE_CORNERS[0].distanceMeters).toBeGreaterThan(190);
    expect(SILVERSTONE_CORNERS[0].distanceMeters).toBeLessThan(280);
  });

  it("places the 2026 overtake detection after T17 and activation before T18", () => {
    expect(SILVERSTONE_OVERTAKE_DETECTION_DISTANCE).toBeGreaterThan(SILVERSTONE_CORNERS[16].distanceMeters);
    expect(SILVERSTONE_OVERTAKE_DETECTION_DISTANCE).toBeLessThan(SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE);
    expect(SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE).toBeLessThan(SILVERSTONE_CORNERS[17].distanceMeters);
  });
});
