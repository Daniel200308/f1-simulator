import type {
  CoolingMode,
  IncidentStatus,
  PitStatus,
  RaceControlStatus,
  RaceEvent,
  RaceSnapshot,
  RaceStatus,
  RadioMessage,
  TyreCompound,
  WeatherCondition,
} from "@/domain/race";
import { DRIVER_BY_ID } from "@/fixtures/grid";
import { assessVehicleThermals } from "@/simulation/thermal-management";

/**
 * A deliberately compact car state used by the replay UI. The full simulation
 * snapshot includes tyre inventories, weather radar cells and other data that
 * does not need to be duplicated hundreds of times for playback.
 */
export interface ReplayCarFrame {
  carId: string;
  racePosition: number;
  currentLap: number;
  lapDistance: number;
  totalDistance: number;
  speedKph: number;
  gapToLeader: number;
  tyreCompound: TyreCompound;
  tyreLife: number;
  tyreTemperatures: readonly [number, number, number, number];
  brakeTemperatures: readonly [number, number, number, number];
  brakeTemperature: number;
  powerUnitTemperature: number;
  gearboxTemperature: number;
  energyStoreTemperature: number;
  batteryPercent: number;
  coolingMode: CoolingMode;
  thermalDeratePercent: number;
  thermalRiskPercent: number;
  pitStatus: PitStatus;
  incidentStatus: IncidentStatus;
  damageLevel: number;
}

export interface ReplayFrame {
  tick: number;
  elapsedTime: number;
  status: RaceStatus;
  raceControl: RaceControlStatus;
  weatherCondition: WeatherCondition;
  rainIntensity: number;
  trackWetness: number;
  cars: readonly ReplayCarFrame[];
}

export type ReplayEventKind = RaceEvent["type"] | "RADIO" | "PIT_STOP" | "OVERTAKE" | "THERMAL_WARNING" | "STRATEGY";
export type ReplayEventSeverity = "INFO" | "WARNING" | "CRITICAL";
export type ReplayThermalSystem = "TYRES" | "BRAKES" | "POWER_UNIT" | "GEARBOX" | "ENERGY_STORE";
export type ReplayEventValue = string | number | boolean | null;

export interface ReplayKeyEvent {
  id: string;
  elapsedTime: number;
  kind: ReplayEventKind;
  message: string;
  carId: string | null;
  severity: ReplayEventSeverity;
  data?: Readonly<Record<string, ReplayEventValue>>;
}

export interface ReplayAnnotation {
  id?: string;
  elapsedTime?: number;
  kind: ReplayEventKind;
  message: string;
  carId?: string | null;
  severity?: ReplayEventSeverity;
  data?: Readonly<Record<string, ReplayEventValue>>;
}

export interface RaceReplayRecording {
  version: 1;
  seed: number | null;
  startedAt: number;
  endedAt: number;
  captureIntervalSeconds: number;
  droppedFrameCount: number;
  frames: readonly ReplayFrame[];
  events: readonly ReplayKeyEvent[];
}

export interface RaceReplayRecorderOptions {
  /** Base capture cadence. It grows automatically when old frames are compacted. */
  captureIntervalSeconds?: number;
  /** Hard upper bound. A full recording is temporally compacted instead of growing forever. */
  maxFrames?: number;
  /** Hard upper bound for key events. The oldest low-volume event data is discarded first. */
  maxEvents?: number;
  /** Cars for which thermal state transitions should become replay/report events. */
  watchedCarIds?: readonly string[];
}

export interface ReplaySeekResult {
  elapsedTime: number;
  progress: number;
  frameIndex: number;
  nextFrameIndex: number;
  frame: ReplayFrame | null;
  nextFrame: ReplayFrame | null;
  interpolation: number;
  nearbyEvents: readonly ReplayKeyEvent[];
}

export interface ReplayPlaybackStep {
  elapsedTime: number;
  ended: boolean;
  looped: boolean;
  seek: ReplaySeekResult;
}

export interface ReplayMetadata {
  durationSeconds: number;
  frameCount: number;
  eventCount: number;
  firstTick: number | null;
  lastTick: number | null;
  seekable: boolean;
  effectiveCaptureIntervalSeconds: number;
  droppedFrameCount: number;
}

const DEFAULT_CAPTURE_INTERVAL_SECONDS = 1;
const DEFAULT_MAX_FRAMES = 1_200;
const DEFAULT_MAX_EVENTS = 1_000;
const MIN_FRAME_LIMIT = 8;
const MIN_EVENT_LIMIT = 16;
const EPSILON = 1e-6;

type ThermalLevel = "NOMINAL" | "WARNING" | "CRITICAL";

interface ThermalReading {
  system: ReplayThermalSystem;
  value: number;
  level: ThermalLevel;
  action: string | null;
}

function finiteOr(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compactCar(car: RaceSnapshot["cars"][number]): ReplayCarFrame {
  return {
    carId: car.carId,
    racePosition: car.racePosition,
    currentLap: car.currentLap,
    lapDistance: finiteOr(car.lapDistance),
    totalDistance: finiteOr(car.totalDistance),
    speedKph: finiteOr(car.currentSpeed),
    gapToLeader: finiteOr(car.gapToLeader),
    tyreCompound: car.tyreCompound,
    tyreLife: finiteOr(car.tyreLife),
    tyreTemperatures: [
      finiteOr(car.tyreTemperatures.frontLeft),
      finiteOr(car.tyreTemperatures.frontRight),
      finiteOr(car.tyreTemperatures.rearLeft),
      finiteOr(car.tyreTemperatures.rearRight),
    ],
    brakeTemperatures: [
      finiteOr(car.brakeTemperatures.frontLeft),
      finiteOr(car.brakeTemperatures.frontRight),
      finiteOr(car.brakeTemperatures.rearLeft),
      finiteOr(car.brakeTemperatures.rearRight),
    ],
    brakeTemperature: finiteOr(car.brakeTemperature),
    powerUnitTemperature: finiteOr(car.powerUnitTemperature),
    gearboxTemperature: finiteOr(car.gearboxTemperature),
    energyStoreTemperature: finiteOr(car.energyStoreTemperature),
    batteryPercent: finiteOr(car.batteryPercent),
    coolingMode: car.coolingMode,
    thermalDeratePercent: finiteOr(car.thermalDeratePercent),
    thermalRiskPercent: finiteOr(car.thermalRiskPercent),
    pitStatus: car.pitStatus,
    incidentStatus: car.incidentStatus,
    damageLevel: finiteOr(car.damageLevel),
  };
}

function compactSnapshot(snapshot: RaceSnapshot): ReplayFrame {
  return {
    tick: snapshot.tick,
    elapsedTime: finiteOr(snapshot.elapsedTime),
    status: snapshot.status,
    raceControl: snapshot.raceControl,
    weatherCondition: snapshot.weather.condition,
    rainIntensity: finiteOr(snapshot.weather.rainIntensity),
    trackWetness: finiteOr(snapshot.weather.trackWetness),
    cars: snapshot.cars.map(compactCar),
  };
}

function eventSeverity(event: RaceEvent): ReplayEventSeverity {
  if (event.type === "INCIDENT") return "CRITICAL";
  if (event.type === "RACE_CONTROL" || event.type === "PIT" || event.type === "THERMAL" || event.type === "PENALTY") return "WARNING";
  return "INFO";
}

function radioSeverity(message: RadioMessage): ReplayEventSeverity {
  return message.priority === "URGENT" ? "CRITICAL" : message.priority === "WARNING" ? "WARNING" : "INFO";
}

function thermalReadings(car: RaceSnapshot["cars"][number]): readonly ThermalReading[] {
  const alerts = assessVehicleThermals(car).alerts;
  const reading = (system: ReplayThermalSystem, value: number): ThermalReading => {
    const alert = alerts.find((candidate) => candidate.system === system);
    return { system, value, level: alert?.severity ?? "NOMINAL", action: alert?.action ?? null };
  };
  return [
    reading("TYRES", Math.max(...Object.values(car.tyreTemperatures))),
    reading("BRAKES", Math.max(...Object.values(car.brakeTemperatures))),
    reading("POWER_UNIT", car.powerUnitTemperature),
    reading("GEARBOX", car.gearboxTemperature),
    reading("ENERGY_STORE", car.energyStoreTemperature),
  ];
}

function compareThermalLevels(left: ThermalLevel, right: ThermalLevel): number {
  const rank: Record<ThermalLevel, number> = { NOMINAL: 0, WARNING: 1, CRITICAL: 2 };
  return rank[left] - rank[right];
}

function sortEvents(events: readonly ReplayKeyEvent[]): ReplayKeyEvent[] {
  return [...events].sort((left, right) => left.elapsedTime - right.elapsedTime || left.id.localeCompare(right.id));
}

function eventCarId(snapshot: RaceSnapshot, event: RaceEvent): string | null {
  if (event.carId !== undefined) return event.carId;
  if (event.type === "INCIDENT") return snapshot.activeIncident?.carId ?? null;
  if (event.type !== "THERMAL") return null;
  return snapshot.cars.find((car) => {
    const shortName = DRIVER_BY_ID.get(car.driverId)?.shortName;
    return shortName !== undefined && event.message.startsWith(`${shortName} `);
  })?.carId ?? null;
}

/**
 * Captures a replay in a bounded amount of memory. When the frame ceiling is
 * reached, older samples are decimated and the capture interval doubles. Key
 * events are retained separately, so a pit stop or incident remains seekable
 * even after long-race compaction.
 */
export class RaceReplayRecorder {
  private readonly maxFrames: number;
  private readonly maxEvents: number;
  private readonly watchedCarIds: ReadonlySet<string>;
  private frames: ReplayFrame[] = [];
  private events: ReplayKeyEvent[] = [];
  private knownEventIds = new Set<string>();
  private previousCars = new Map<string, RaceSnapshot["cars"][number]>();
  private previousThermalLevels = new Map<string, ThermalLevel>();
  private intervalSeconds: number;
  private lastCaptureElapsedTime = Number.NEGATIVE_INFINITY;
  private droppedFrameCount = 0;
  private seed: number | null = null;
  private annotationCounter = 0;

  constructor(options: RaceReplayRecorderOptions = {}) {
    this.intervalSeconds = Math.max(0.1, finiteOr(options.captureIntervalSeconds ?? DEFAULT_CAPTURE_INTERVAL_SECONDS, DEFAULT_CAPTURE_INTERVAL_SECONDS));
    this.maxFrames = Math.max(MIN_FRAME_LIMIT, Math.floor(finiteOr(options.maxFrames ?? DEFAULT_MAX_FRAMES, DEFAULT_MAX_FRAMES)));
    this.maxEvents = Math.max(MIN_EVENT_LIMIT, Math.floor(finiteOr(options.maxEvents ?? DEFAULT_MAX_EVENTS, DEFAULT_MAX_EVENTS)));
    this.watchedCarIds = new Set(options.watchedCarIds ?? []);
  }

  record(snapshot: RaceSnapshot, annotations: readonly ReplayAnnotation[] = []): RaceReplayRecording {
    if (this.seed === null) this.seed = snapshot.seed;
    if (snapshot.seed !== this.seed) {
      throw new Error(`Replay recorder seed changed from ${this.seed} to ${snapshot.seed}. Create a new recorder for a new race.`);
    }

    const previousFrame = this.frames.at(-1);
    const eventCountBefore = this.events.length;
    this.captureSnapshotEvents(snapshot);
    this.captureCarTransitions(snapshot);
    annotations.forEach((annotation) => this.addAnnotation(annotation, snapshot.elapsedTime));

    const stateChanged = previousFrame !== undefined
      && (previousFrame.status !== snapshot.status || previousFrame.raceControl !== snapshot.raceControl);
    const eventAdded = this.events.length > eventCountBefore;
    const captureDue = snapshot.elapsedTime - this.lastCaptureElapsedTime + EPSILON >= this.intervalSeconds;
    const duplicateTerminalFrame = snapshot.status === "FINISHED"
      && previousFrame?.status === "FINISHED"
      && previousFrame.tick === snapshot.tick
      && Math.abs(previousFrame.elapsedTime - snapshot.elapsedTime) <= EPSILON;
    if (!duplicateTerminalFrame && (this.frames.length === 0 || captureDue || stateChanged || eventAdded || snapshot.status === "FINISHED")) {
      this.frames.push(compactSnapshot(snapshot));
      this.lastCaptureElapsedTime = snapshot.elapsedTime;
      if (this.frames.length > this.maxFrames) this.compactFrames();
    }

    this.previousCars = new Map(snapshot.cars.map((car) => [car.carId, car]));
    return this.toRecording();
  }

  annotate(annotation: ReplayAnnotation, fallbackElapsedTime?: number): RaceReplayRecording {
    this.addAnnotation(annotation, fallbackElapsedTime ?? this.frames.at(-1)?.elapsedTime ?? 0);
    return this.toRecording();
  }

  toRecording(): RaceReplayRecording {
    const startedAt = this.frames[0]?.elapsedTime ?? 0;
    const endedAt = this.frames.at(-1)?.elapsedTime ?? startedAt;
    return {
      version: 1,
      seed: this.seed,
      startedAt,
      endedAt,
      captureIntervalSeconds: this.intervalSeconds,
      droppedFrameCount: this.droppedFrameCount,
      frames: [...this.frames],
      events: sortEvents(this.events),
    };
  }

  reset(): void {
    this.frames = [];
    this.events = [];
    this.knownEventIds.clear();
    this.previousCars.clear();
    this.previousThermalLevels.clear();
    this.lastCaptureElapsedTime = Number.NEGATIVE_INFINITY;
    this.droppedFrameCount = 0;
    this.seed = null;
    this.annotationCounter = 0;
  }

  private captureSnapshotEvents(snapshot: RaceSnapshot): void {
    snapshot.events.forEach((event) => this.addEvent({
      id: `race:${event.id}`,
      elapsedTime: event.elapsedTime,
      kind: event.type,
      message: event.message,
      carId: eventCarId(snapshot, event),
      severity: eventSeverity(event),
    }));
    snapshot.radioMessages.forEach((message) => this.addEvent({
      id: `radio:${message.id}`,
      elapsedTime: message.elapsedTime,
      kind: "RADIO",
      message: `${message.source}: ${message.message}`,
      carId: message.carId,
      severity: radioSeverity(message),
      data: { source: message.source },
    }));
  }

  private captureCarTransitions(snapshot: RaceSnapshot): void {
    for (const car of snapshot.cars) {
      const previous = this.previousCars.get(car.carId);
      if (previous && car.pitStops > previous.pitStops) {
        this.addEvent({
          id: `pit-stop:${car.carId}:${car.pitStops}`,
          elapsedTime: snapshot.elapsedTime,
          kind: "PIT_STOP",
          message: `${car.carId} completed pit stop ${car.pitStops}`,
          carId: car.carId,
          severity: car.pitStopIssue === "NONE" ? "INFO" : "WARNING",
          data: {
            stopNumber: car.pitStops,
            durationSeconds: car.lastPitStopTime,
            compound: car.tyreCompound,
            issue: car.pitStopIssue,
          },
        });
      }
      if (previous && car.overtakes > previous.overtakes) {
        this.addEvent({
          id: `overtake:${car.carId}:${car.overtakes}`,
          elapsedTime: snapshot.elapsedTime,
          kind: "OVERTAKE",
          message: `${car.carId} completed an overtake`,
          carId: car.carId,
          severity: "INFO",
          data: { overtakeNumber: car.overtakes, racePosition: car.racePosition },
        });
      }
      if (previous && car.incidentStatus !== previous.incidentStatus && car.incidentStatus !== "RUNNING") {
        const nativeIncident = snapshot.events.some((event) => event.type === "INCIDENT"
          && eventCarId(snapshot, event) === car.carId
          && Math.abs(event.elapsedTime - snapshot.elapsedTime) <= 0.5);
        if (!nativeIncident) {
          this.addEvent({
            id: `incident-state:${car.carId}:${car.incidentStatus}:${snapshot.tick}`,
            elapsedTime: snapshot.elapsedTime,
            kind: "INCIDENT",
            message: `${car.carId} ${car.incidentStatus.toLowerCase().replace("_", " ")}`,
            carId: car.carId,
            severity: car.incidentStatus === "RETIRED" ? "CRITICAL" : "WARNING",
            data: { incidentStatus: car.incidentStatus, damageLevel: car.damageLevel },
          });
        }
      }
      if (this.watchedCarIds.has(car.carId)) this.captureThermalTransitions(snapshot, car);
    }
  }

  private captureThermalTransitions(snapshot: RaceSnapshot, car: RaceSnapshot["cars"][number]): void {
    for (const reading of thermalReadings(car)) {
      const key = `${car.carId}:${reading.system}`;
      const nextLevel = reading.level;
      const previousLevel = this.previousThermalLevels.get(key) ?? "NOMINAL";
      this.previousThermalLevels.set(key, nextLevel);
      if (nextLevel === "NOMINAL" || compareThermalLevels(nextLevel, previousLevel) <= 0) continue;
      this.addEvent({
        id: `thermal:${key}:${nextLevel}:${snapshot.tick}`,
        elapsedTime: snapshot.elapsedTime,
        kind: "THERMAL_WARNING",
        message: `${car.carId} ${reading.system.replace("_", " ")} ${nextLevel.toLowerCase()}`,
        carId: car.carId,
        severity: nextLevel,
        data: { system: reading.system, temperatureCelsius: reading.value, level: nextLevel, action: reading.action },
      });
    }
  }

  private addAnnotation(annotation: ReplayAnnotation, fallbackElapsedTime: number): void {
    const elapsedTime = finiteOr(annotation.elapsedTime ?? fallbackElapsedTime);
    this.annotationCounter += 1;
    this.addEvent({
      id: annotation.id ?? `annotation:${this.annotationCounter}:${elapsedTime.toFixed(3)}`,
      elapsedTime,
      kind: annotation.kind,
      message: annotation.message,
      carId: annotation.carId ?? null,
      severity: annotation.severity ?? "INFO",
      data: annotation.data,
    });
  }

  private addEvent(event: ReplayKeyEvent): void {
    if (this.knownEventIds.has(event.id)) return;
    this.knownEventIds.add(event.id);
    this.events.push(event);
    if (this.events.length <= this.maxEvents) return;
    const excess = this.events.length - this.maxEvents;
    const removed = this.events.splice(0, excess);
    removed.forEach((item) => this.knownEventIds.delete(item.id));
  }

  private compactFrames(): void {
    const original = this.frames;
    const compacted = original.filter((_, index) => index === 0 || index === original.length - 1 || index % 2 === 0);
    this.frames = compacted;
    this.droppedFrameCount += original.length - compacted.length;
    this.intervalSeconds *= 2;
    this.lastCaptureElapsedTime = compacted.at(-1)?.elapsedTime ?? Number.NEGATIVE_INFINITY;
  }
}

export function replayMetadata(recording: RaceReplayRecording): ReplayMetadata {
  const first = recording.frames[0];
  const last = recording.frames.at(-1);
  return {
    durationSeconds: Math.max(0, recording.endedAt - recording.startedAt),
    frameCount: recording.frames.length,
    eventCount: recording.events.length,
    firstTick: first?.tick ?? null,
    lastTick: last?.tick ?? null,
    seekable: recording.frames.length > 0,
    effectiveCaptureIntervalSeconds: recording.captureIntervalSeconds,
    droppedFrameCount: recording.droppedFrameCount,
  };
}

export function seekReplay(recording: RaceReplayRecording, requestedElapsedTime: number): ReplaySeekResult {
  const frames = recording.frames;
  if (frames.length === 0) {
    return {
      elapsedTime: 0,
      progress: 0,
      frameIndex: -1,
      nextFrameIndex: -1,
      frame: null,
      nextFrame: null,
      interpolation: 0,
      nearbyEvents: [],
    };
  }

  const firstTime = frames[0].elapsedTime;
  const lastTime = frames.at(-1)!.elapsedTime;
  const elapsedTime = clamp(finiteOr(requestedElapsedTime, firstTime), firstTime, lastTime);
  let low = 0;
  let high = frames.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].elapsedTime <= elapsedTime) low = middle + 1;
    else high = middle - 1;
  }
  const frameIndex = Math.max(0, high);
  const nextFrameIndex = Math.min(frames.length - 1, frameIndex + 1);
  const frame = frames[frameIndex];
  const nextFrame = frames[nextFrameIndex];
  const frameSpan = nextFrame.elapsedTime - frame.elapsedTime;
  const interpolation = frameSpan <= EPSILON ? 0 : clamp((elapsedTime - frame.elapsedTime) / frameSpan, 0, 1);
  const duration = lastTime - firstTime;
  const nearbyEvents = recording.events.filter((event) => Math.abs(event.elapsedTime - elapsedTime) <= 5);

  return {
    elapsedTime,
    progress: duration <= EPSILON ? 1 : (elapsedTime - firstTime) / duration,
    frameIndex,
    nextFrameIndex,
    frame,
    nextFrame,
    interpolation,
    nearbyEvents,
  };
}

export function advanceReplay(
  recording: RaceReplayRecording,
  currentElapsedTime: number,
  realDeltaSeconds: number,
  playbackRate = 1,
  loop = false,
): ReplayPlaybackStep {
  const start = recording.frames[0]?.elapsedTime ?? 0;
  const end = recording.frames.at(-1)?.elapsedTime ?? start;
  const delta = Math.max(0, finiteOr(realDeltaSeconds)) * Math.max(0, finiteOr(playbackRate, 1));
  let elapsedTime = finiteOr(currentElapsedTime, start) + delta;
  let looped = false;
  if (elapsedTime > end && loop && end > start) {
    elapsedTime = start + ((elapsedTime - start) % (end - start));
    looped = true;
  } else {
    elapsedTime = clamp(elapsedTime, start, end);
  }
  return {
    elapsedTime,
    ended: !loop && elapsedTime >= end,
    looped,
    seek: seekReplay(recording, elapsedTime),
  };
}
