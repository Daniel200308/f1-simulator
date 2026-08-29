import { describe, expect, it } from "vitest";
import { normalizeTrackProgress, qualifyingTrafficTarget } from "@/simulation/qualifying-traffic";
import {
  createWeekendState,
  runWeekendSession,
  startLiveQualifying,
  tickLiveQualifying,
} from "@/simulation/weekend";

describe("qualifying markers never travel backwards", () => {
  it("keeps every car's track progress moving forward within a phase", () => {
    let weekend = createWeekendState(20_260_820, "ferrari");
    weekend = runWeekendSession(runWeekendSession(runWeekendSession(weekend)));
    weekend = startLiveQualifying(weekend);

    const previous = new Map<string, { progress: number; phase: string; pitLane: boolean }>();
    const regressions: string[] = [];

    for (let second = 0; second < 1_100 && weekend.currentSession === "Q1"; second += 1) {
      weekend = tickLiveQualifying(weekend, 1);
      const live = weekend.qualifyingLive;
      if (!live || live.session !== "Q1") break;

      for (const car of Object.values(live.cars)) {
        const target = qualifyingTrafficTarget(car);
        if (!target) {
          previous.delete(car.carId);
          continue;
        }
        const last = previous.get(car.carId);
        previous.set(car.carId, { progress: target.progress, phase: car.phase, pitLane: target.pitLane });
        /*
         * Compare only inside one phase and one route. The pit lane uses its own
         * coordinate space, so leaving it for the track is a legitimate jump
         * rather than the marker sliding backwards.
         */
        if (!last || last.phase !== car.phase || last.pitLane !== target.pitLane) continue;

        // Inside one phase the marker may only advance. A lap wrap is still a
        // forward move, so compare along the shorter forward arc.
        const forward = normalizeTrackProgress(target.progress - last.progress);
        /*
         * `forward` near 1 means the marker moved a hair backwards; near 0 means
         * it stood still or wrapped the start line. Only a substantial backwards
         * move is a fault, which keeps the check clear of both wrap-around and
         * sub-millimetre float noise.
         */
        const movedBackwards = forward > 0.5 && forward < 0.9999;
        if (movedBackwards && regressions.length < 8) {
          regressions.push(`t=${second} ${car.carId} ${car.phase} ${last.progress.toFixed(4)} -> ${target.progress.toFixed(4)}`);
        }
      }
    }

    expect(regressions).toEqual([]);
  }, 30_000);
});
