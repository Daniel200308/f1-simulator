import { describe, expect, it } from "vitest";

import type { IncidentStatus, RaceControlStatus, RaceSnapshot } from "@/domain/race";
import {
  createInitialSnapshot,
  INCIDENT_DRIVER_COOLDOWN_SECONDS,
  INCIDENT_FIELD_COOLDOWN_SECONDS,
  stepSnapshot,
} from "@/simulation/engine";

// Opt-in because this intentionally simulates eight complete Grands Prix.
const sampleEnabled = process.env.INCIDENT_FREQUENCY_QA === "1";

interface RaceIncidentSample {
  seed: number;
  raceSeconds: number;
  incidents: number;
  spins: number;
  damaged: number;
  retired: number;
  yellows: number;
  vsc: number;
  safetyCars: number;
  uniqueDrivers: number;
  penalisedDrivers: number;
  unsafeReleases: number;
  vscDeltaPenalties: number;
  penaltiesByInfringement: Readonly<Record<string, number>>;
}

describe.skipIf(!sampleEnabled)("seeded incident-frequency QA sample", () => {
  it("keeps incidents uncommon, spaced and distributed across the field", () => {
    const seeds = [20_250_701, 20_250_702, 20_250_703, 20_250_704, 20_250_705, 20_250_706, 20_250_707, 20_250_708];
    const allDrivers = new Set<string>();
    const samples: RaceIncidentSample[] = [];

    for (const seed of seeds) {
      let state: RaceSnapshot = { ...createInitialSnapshot(seed), status: "RUNNING" };
      let priorControl: RaceControlStatus = state.raceControl;
      const latestIncidentByCar = new Map<string, number>();
      const incidentTimesByCar = new Map<string, number[]>();
      const incidentTimes: number[] = [];
      const counts: Record<Exclude<IncidentStatus, "RUNNING">, number> = { SPUN: 0, DAMAGED: 0, RETIRED: 0 };
      let yellows = 0;
      let vsc = 0;
      let safetyCars = 0;

      for (let tick = 0; tick < 80_000 && state.status !== "FINISHED"; tick += 1) {
        state = stepSnapshot(state);
        for (const car of state.cars) {
          const incidentAt = car.lastIncidentAt;
          if (incidentAt == null || incidentAt <= (latestIncidentByCar.get(car.carId) ?? Number.NEGATIVE_INFINITY)) continue;
          latestIncidentByCar.set(car.carId, incidentAt);
          incidentTimes.push(incidentAt);
          incidentTimesByCar.set(car.carId, [...(incidentTimesByCar.get(car.carId) ?? []), incidentAt]);
          if (car.incidentStatus !== "RUNNING") counts[car.incidentStatus] += 1;
          allDrivers.add(car.carId);
        }
        if (state.raceControl !== priorControl) {
          if (state.raceControl === "YELLOW") yellows += 1;
          if (state.raceControl === "VSC") vsc += 1;
          if (state.raceControl === "SAFETY_CAR") safetyCars += 1;
          priorControl = state.raceControl;
        }
      }

      const orderedTimes = [...incidentTimes].sort((a, b) => a - b);
      for (let index = 1; index < orderedTimes.length; index += 1) {
        expect(orderedTimes[index] - orderedTimes[index - 1]).toBeGreaterThanOrEqual(INCIDENT_FIELD_COOLDOWN_SECONDS - 0.11);
      }
      for (const occurrences of incidentTimesByCar.values()) {
        for (let index = 1; index < occurrences.length; index += 1) {
          expect(occurrences[index] - occurrences[index - 1]).toBeGreaterThanOrEqual(INCIDENT_DRIVER_COOLDOWN_SECONDS - 0.11);
        }
      }
      const incidents = counts.SPUN + counts.DAMAGED + counts.RETIRED;
      const penalisedDrivers = new Set(state.penalties.map((penalty) => penalty.carId));
      const unsafeReleases = state.penalties.filter((penalty) => penalty.infringement === "UNSAFE_RELEASE").length;
      const vscDeltaPenalties = state.penalties.filter((penalty) => penalty.infringement === "SC_VSC_DELTA").length;
      const penaltiesByInfringement = state.penalties.reduce<Record<string, number>>((countsByType, penalty) => ({
        ...countsByType,
        [penalty.infringement]: (countsByType[penalty.infringement] ?? 0) + 1,
      }), {});
      samples.push({
        seed,
        raceSeconds: Number(state.elapsedTime.toFixed(1)),
        incidents,
        spins: counts.SPUN,
        damaged: counts.DAMAGED,
        retired: counts.RETIRED,
        yellows,
        vsc,
        safetyCars,
        uniqueDrivers: latestIncidentByCar.size,
        penalisedDrivers: penalisedDrivers.size,
        unsafeReleases,
        vscDeltaPenalties,
        penaltiesByInfringement,
      });
      expect(state.status).toBe("FINISHED");
      expect(incidents).toBeLessThanOrEqual(10);
      expect(safetyCars).toBe(1);
      expect(state.safetyCarDeployments).toBe(1);
      console.info(`PENALTY_FREQUENCY_SAMPLE=${JSON.stringify({ seed, penalisedDrivers: penalisedDrivers.size, penaltiesByInfringement })}`);
      expect(penalisedDrivers.size).toBeLessThan(state.cars.length / 2);
      expect(unsafeReleases).toBeLessThanOrEqual(1);
      expect(vscDeltaPenalties).toBeLessThanOrEqual(1);
    }

    const totals = samples.reduce((sum, sample) => ({
      incidents: sum.incidents + sample.incidents,
      spins: sum.spins + sample.spins,
      damaged: sum.damaged + sample.damaged,
      retired: sum.retired + sample.retired,
      yellows: sum.yellows + sample.yellows,
      vsc: sum.vsc + sample.vsc,
      safetyCars: sum.safetyCars + sample.safetyCars,
    }), { incidents: 0, spins: 0, damaged: 0, retired: 0, yellows: 0, vsc: 0, safetyCars: 0 });
    const report = {
      races: samples.length,
      meanIncidentsPerRace: Number((totals.incidents / samples.length).toFixed(2)),
      meanSafetyCarsPerRace: Number((totals.safetyCars / samples.length).toFixed(2)),
      uniqueIncidentDrivers: allDrivers.size,
      totals,
      samples,
    };
    console.info(`INCIDENT_FREQUENCY_REPORT=${JSON.stringify(report)}`);
    expect(report.meanIncidentsPerRace).toBeGreaterThanOrEqual(0.25);
    expect(report.meanIncidentsPerRace).toBeLessThanOrEqual(6);
    expect(report.meanSafetyCarsPerRace).toBe(1);
  }, 120_000);
});
