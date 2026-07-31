import { describe, expect, it } from "vitest";
import {
  SILVERSTONE_CIRCUIT,
  SILVERSTONE_CORNERS,
  SILVERSTONE_WING_ZONES,
  wingZoneAtDistance,
} from "@/simulation/track";

describe("Silverstone wing zones", () => {
  it("defines the Wellington and Hangar straights", () => {
    expect(SILVERSTONE_WING_ZONES.map((zone) => zone.id)).toEqual(["WELLINGTON", "HANGAR"]);
  });

  it("opens after Aintree and closes before Brooklands", () => {
    const [wellington] = SILVERSTONE_WING_ZONES;
    const aintree = SILVERSTONE_CORNERS[4];
    const brooklands = SILVERSTONE_CORNERS[5];

    expect(aintree.name).toBe("Aintree");
    expect(brooklands.name).toBe("Brooklands");
    expect(wellington.openAtMeters).toBeGreaterThan(aintree.distanceMeters);
    expect(wellington.closeAtMeters).toBeLessThan(brooklands.distanceMeters);
  });

  it("opens after Chapel and closes before Stowe", () => {
    const hangar = SILVERSTONE_WING_ZONES[1];
    const chapel = SILVERSTONE_CORNERS[13];
    const stowe = SILVERSTONE_CORNERS[14];

    expect(chapel.name).toBe("Chapel");
    expect(stowe.name).toBe("Stowe");
    expect(hangar.openAtMeters).toBeGreaterThan(chapel.distanceMeters);
    expect(hangar.closeAtMeters).toBeLessThan(stowe.distanceMeters);
  });

  it("reports a zone only between its open and close points", () => {
    for (const zone of SILVERSTONE_WING_ZONES) {
      const middle = (zone.openAtMeters + zone.closeAtMeters) / 2;
      expect(wingZoneAtDistance(middle)?.id).toBe(zone.id);
      expect(wingZoneAtDistance(zone.openAtMeters)?.id).toBe(zone.id);
      // The close point is the braking reference, so the flap is already shut.
      expect(wingZoneAtDistance(zone.closeAtMeters)?.id).not.toBe(zone.id);
      expect(wingZoneAtDistance(zone.openAtMeters - 1)?.id).not.toBe(zone.id);
    }
  });

  it("leaves the rest of the lap closed and never overlaps zones", () => {
    let openMetres = 0;
    for (let distance = 0; distance < SILVERSTONE_CIRCUIT.lengthMeters; distance += 5) {
      const matches = SILVERSTONE_WING_ZONES.filter((zone) => distance >= zone.openAtMeters && distance < zone.closeAtMeters);
      expect(matches.length).toBeLessThanOrEqual(1);
      if (matches.length === 1) openMetres += 5;
    }
    // Two straights out of a 5.9 km lap: a meaningful slice, but a minority.
    expect(openMetres).toBeGreaterThan(400);
    expect(openMetres).toBeLessThan(SILVERSTONE_CIRCUIT.lengthMeters * 0.4);
  });

  it("normalises distances beyond one lap", () => {
    const [wellington] = SILVERSTONE_WING_ZONES;
    const middle = (wellington.openAtMeters + wellington.closeAtMeters) / 2;
    expect(wingZoneAtDistance(middle + SILVERSTONE_CIRCUIT.lengthMeters * 3)?.id).toBe("WELLINGTON");
  });
});
