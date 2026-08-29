import { describe, expect, it } from "vitest";

import { createInitialSnapshot, stepSnapshot } from "@/simulation/engine";
import type { RaceSnapshot } from "@/domain/race";
import { CIRCUITS } from "@/simulation/track";

describe("multi-circuit race engine", () => {
  for (const circuit of CIRCUITS) {
    it(`advances deterministically at ${circuit.shortName}`, () => {
      let first: RaceSnapshot = createInitialSnapshot(81_300, "RUNNING", undefined, undefined, undefined, undefined, undefined, circuit.id);
      let second: RaceSnapshot = createInitialSnapshot(81_300, "RUNNING", undefined, undefined, undefined, undefined, undefined, circuit.id);
      for (let tick = 0; tick < 250; tick += 1) {
        first = stepSnapshot(first);
        second = stepSnapshot(second);
      }
      expect(first.circuitId).toBe(circuit.id);
      expect(first.checksum).toBe(second.checksum);
      expect(first.cars.every((car) => car.circuitId === circuit.id)).toBe(true);
      expect(first.cars.every((car) => car.currentLap <= circuit.totalLaps)).toBe(true);
      expect(first.cars.every((car) => car.lapDistance >= 0 && car.lapDistance < circuit.lengthMeters)).toBe(true);
    });
  }
});
