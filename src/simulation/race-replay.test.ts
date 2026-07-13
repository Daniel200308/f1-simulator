import { describe, expect, it } from "vitest";

import type { RaceSnapshot } from "@/domain/race";
import { createInitialSnapshot } from "@/simulation/engine";
import { advanceReplay, RaceReplayRecorder, replayMetadata, seekReplay } from "@/simulation/race-replay";

function atTime(snapshot: RaceSnapshot, elapsedTime: number, tick = Math.round(elapsedTime * 10)): RaceSnapshot {
  return { ...snapshot, elapsedTime, tick };
}

describe("RaceReplayRecorder", () => {
  it("stores compact frames at a configured cadence", () => {
    const initial = createInitialSnapshot(120);
    const recorder = new RaceReplayRecorder({ captureIntervalSeconds: 1, maxFrames: 20 });
    recorder.record(atTime(initial, 0));
    recorder.record(atTime(initial, 0.4));
    recorder.record(atTime(initial, 1));

    const recording = recorder.toRecording();
    expect(recording.frames).toHaveLength(2);
    expect(recording.frames.map((frame) => frame.elapsedTime)).toEqual([0, 1]);
    expect(recording.frames[0].cars[0]).toMatchObject({
      carId: initial.cars[0].carId,
      tyreTemperatures: expect.any(Array),
      powerUnitTemperature: initial.cars[0].powerUnitTemperature,
    });
    expect("tyreSets" in recording.frames[0].cars[0]).toBe(false);
  });

  it("compacts long recordings while retaining first and latest frames", () => {
    const initial = createInitialSnapshot(121);
    const recorder = new RaceReplayRecorder({ captureIntervalSeconds: 0.1, maxFrames: 8 });
    for (let index = 0; index < 40; index += 1) recorder.record(atTime(initial, index * 0.1, index));

    const recording = recorder.toRecording();
    expect(recording.frames.length).toBeLessThanOrEqual(8);
    expect(recording.frames[0].elapsedTime).toBe(0);
    expect(recording.frames.at(-1)!.elapsedTime).toBeGreaterThan(2);
    expect(recording.captureIntervalSeconds).toBeGreaterThan(0.1);
    expect(recording.droppedFrameCount).toBeGreaterThan(0);
  });

  it("keeps key events independently of sampling and de-duplicates snapshot event ids", () => {
    const initial = createInitialSnapshot(122);
    const withEvent: RaceSnapshot = {
      ...atTime(initial, 0.2),
      events: [{ id: "yellow-1", elapsedTime: 0.2, type: "RACE_CONTROL", message: "YELLOW FLAG" }],
    };
    const recorder = new RaceReplayRecorder({ captureIntervalSeconds: 5 });
    recorder.record(initial);
    recorder.record(withEvent, [{ kind: "STRATEGY", message: "BOX NOW", carId: initial.cars[0].carId }]);
    recorder.record(atTime(withEvent, 0.3));

    expect(new Set(recorder.toRecording().events.map((event) => event.kind))).toEqual(new Set(["RACE_CONTROL", "STRATEGY"]));
  });

  it("records pit, overtake and watched thermal transitions", () => {
    const initial = createInitialSnapshot(123);
    const carId = initial.cars[0].carId;
    const recorder = new RaceReplayRecorder({ watchedCarIds: [carId] });
    recorder.record(initial);
    recorder.record({
      ...atTime(initial, 1),
      cars: initial.cars.map((car) => car.carId === carId ? {
        ...car,
        pitStops: 1,
        lastPitStopTime: 3.2,
        pitStopIssue: "WHEEL_GUN" as const,
        overtakes: 1,
        powerUnitTemperature: 126,
      } : car),
    });

    const events = recorder.toRecording().events;
    expect(events.some((event) => event.kind === "PIT_STOP" && event.data?.issue === "WHEEL_GUN")).toBe(true);
    expect(events.some((event) => event.kind === "OVERTAKE")).toBe(true);
    expect(events.some((event) => event.kind === "THERMAL_WARNING" && event.data?.system === "POWER_UNIT" && event.severity === "CRITICAL")).toBe(true);
  });

  it("does not duplicate a native incident with its matching car-state transition", () => {
    const initial = createInitialSnapshot(127);
    const car = initial.cars[0];
    const recorder = new RaceReplayRecorder();
    recorder.record(initial);
    recorder.record({
      ...atTime(initial, 1),
      activeIncident: {
        carId: initial.cars[1].carId,
        distanceMeters: initial.cars[1].lapDistance,
        cornerNumber: 1,
        cornerName: "Abbey",
        sector: 1,
        status: "SPUN",
      },
      events: [{ id: "incident-1", elapsedTime: 1, type: "INCIDENT", message: `${car.carId} spun`, carId: car.carId }],
      cars: initial.cars.map((candidate) => candidate.carId === car.carId
        ? { ...candidate, incidentStatus: "SPUN" as const }
        : candidate),
    });

    const incidents = recorder.toRecording().events.filter((event) => event.kind === "INCIDENT");
    expect(incidents).toHaveLength(1);
    expect(incidents[0].carId).toBe(car.carId);
  });

  it("rejects mixing snapshots from two race seeds", () => {
    const recorder = new RaceReplayRecorder();
    recorder.record(createInitialSnapshot(1));
    expect(() => recorder.record(createInitialSnapshot(2))).toThrow(/seed changed/);
  });

  it("stores an unchanged terminal snapshot only once", () => {
    const initial = createInitialSnapshot(126);
    const recorder = new RaceReplayRecorder({ captureIntervalSeconds: 1 });
    const finished = { ...atTime(initial, 90), status: "FINISHED" as const };

    recorder.record(finished);
    recorder.record(finished);
    recorder.record(finished);

    expect(recorder.toRecording().frames).toHaveLength(1);
  });
});

describe("replay playback helpers", () => {
  it("seeks by time with interpolation metadata and nearby events", () => {
    const initial = createInitialSnapshot(124);
    const recorder = new RaceReplayRecorder({ captureIntervalSeconds: 2 });
    recorder.record(atTime(initial, 0));
    recorder.record(atTime(initial, 2), [{ kind: "STRATEGY", message: "Undercut window", elapsedTime: 1.4 }]);
    recorder.record(atTime(initial, 4));
    const recording = recorder.toRecording();
    const seek = seekReplay(recording, 3);

    expect(seek.frame?.elapsedTime).toBe(2);
    expect(seek.nextFrame?.elapsedTime).toBe(4);
    expect(seek.interpolation).toBeCloseTo(0.5);
    expect(seek.progress).toBeCloseTo(0.75);
    expect(seek.nearbyEvents).toHaveLength(1);
    expect(replayMetadata(recording)).toMatchObject({ frameCount: 3, eventCount: 1, durationSeconds: 4, seekable: true });
  });

  it("advances, clamps, and loops a playhead", () => {
    const initial = createInitialSnapshot(125);
    const recorder = new RaceReplayRecorder({ captureIntervalSeconds: 1 });
    recorder.record(atTime(initial, 10));
    recorder.record(atTime(initial, 12));
    const recording = recorder.toRecording();

    expect(advanceReplay(recording, 11, 2, 1, false)).toMatchObject({ elapsedTime: 12, ended: true, looped: false });
    expect(advanceReplay(recording, 11.5, 1, 1, true)).toMatchObject({ elapsedTime: 10.5, ended: false, looped: true });
  });
});
