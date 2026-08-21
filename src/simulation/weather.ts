import type {
  TrackSurfaceZone,
  WeatherCondition,
  WeatherForecastPoint,
  WeatherRadarCell,
  WeatherSector,
  WeatherSectorState,
  WeatherState,
} from "@/domain/race";
import { hashNoise, signedNoise } from "@/simulation/random";

export const WEATHER_RADAR_CELL_COUNT = 24;
export const WEATHER_SURFACE_ZONE_COUNT = 48;
export const WEATHER_SECTOR_COUNT = 3;
export const DEFAULT_WEATHER_TRACK_LENGTH_METERS = 5_891;

const RADAR_ROWS = 4;
const RADAR_COLUMNS = 6;
const FORECAST_MINUTES = [0, 2, 5, 10, 15] as const;

export interface SpatialWeatherOptions {
  deltaSeconds?: number;
  trackLengthMeters?: number;
  trafficIntensity?: number | readonly number[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function smoothNoise(seed: number, stream: number, elapsedTime: number, intervalSeconds: number): number {
  const cursor = Math.max(0, elapsedTime) / intervalSeconds;
  const tick = Math.floor(cursor);
  const blend = smoothstep(cursor - tick);
  const current = signedNoise(seed, stream, tick);
  const next = signedNoise(seed, stream, tick + 1);
  return current + (next - current) * blend;
}

export type WeatherScenarioKind =
  | "CLEAR"
  | "DRIZZLE"
  | "PASSING_SHOWERS"
  | "BUILDING_RAIN"
  | "SUDDEN_DOWNPOUR"
  | "PATCHY_CELLS"
  | "TWO_WAVE"
  | "SUSTAINED_RAIN"
  | "HEAVY_SUSTAINED"
  | "SUNSHOWER"
  | "STOP_START_SHOWERS"
  | "LATE_STORM"
  | "CLEARING_RAIN";

export interface WeatherCellPlan {
  id: string;
  startSeconds: number;
  durationSeconds: number;
  peakIntensity: number;
  originX: number;
  originY: number;
  directionRadians: number;
  travelDistance: number;
  radius: number;
  buildFraction: number;
  buildExponent: number;
  decayExponent: number;
}

export interface WeatherScenario {
  kind: WeatherScenarioKind;
  cells: readonly WeatherCellPlan[];
}

const WEATHER_RAIN_SCENARIO_KINDS: readonly Exclude<WeatherScenarioKind, "CLEAR">[] = [
  "DRIZZLE",
  "PASSING_SHOWERS",
  "BUILDING_RAIN",
  "SUDDEN_DOWNPOUR",
  "PATCHY_CELLS",
  "TWO_WAVE",
  "SUSTAINED_RAIN",
  "HEAVY_SUSTAINED",
  "SUNSHOWER",
  "STOP_START_SHOWERS",
  "LATE_STORM",
  "CLEARING_RAIN",
];
/** Keeps a useful dry-race baseline while retaining varied wet scenarios. */
export const WEATHER_CLEAR_SCENARIO_SHARE = 0.14;
const weatherScenarioCache = new Map<number, WeatherScenario>();

interface WeatherScenarioProfile {
  cellCount: number;
  start: readonly [number, number];
  duration: readonly [number, number];
  peak: readonly [number, number];
  stagger: readonly [number, number];
  travel: readonly [number, number];
  radius: readonly [number, number];
  buildFraction: readonly [number, number];
  buildExponent: readonly [number, number];
  decayExponent: readonly [number, number];
}

const WEATHER_SCENARIO_PROFILES: Readonly<Record<Exclude<WeatherScenarioKind, "CLEAR">, WeatherScenarioProfile>> = {
  DRIZZLE: {
    cellCount: 1, start: [180, 3_100], duration: [1_200, 2_200], peak: [0.46, 0.68], stagger: [0, 0],
    travel: [1.15, 1.75], radius: [0.52, 0.76], buildFraction: [0.34, 0.62], buildExponent: [0.7, 1.25], decayExponent: [0.75, 1.3],
  },
  PASSING_SHOWERS: {
    cellCount: 2, start: [80, 2_850], duration: [700, 1_200], peak: [0.6, 0.84], stagger: [95, 360],
    travel: [1.35, 2.05], radius: [0.36, 0.54], buildFraction: [0.24, 0.48], buildExponent: [0.5, 1.05], decayExponent: [0.65, 1.25],
  },
  BUILDING_RAIN: {
    cellCount: 1, start: [120, 2_600], duration: [1_100, 2_000], peak: [0.66, 0.9], stagger: [0, 0],
    travel: [1.1, 1.65], radius: [0.44, 0.66], buildFraction: [0.46, 0.7], buildExponent: [0.75, 1.4], decayExponent: [0.62, 1.0],
  },
  SUDDEN_DOWNPOUR: {
    cellCount: 1, start: [110, 2_400], duration: [700, 1_100], peak: [0.82, 0.99], stagger: [0, 0],
    travel: [1.35, 2.05], radius: [0.5, 0.72], buildFraction: [0.08, 0.2], buildExponent: [0.16, 0.36], decayExponent: [0.8, 1.5],
  },
  PATCHY_CELLS: {
    cellCount: 3, start: [80, 2_850], duration: [650, 1_100], peak: [0.6, 0.86], stagger: [75, 260],
    travel: [1.3, 2.0], radius: [0.32, 0.48], buildFraction: [0.24, 0.52], buildExponent: [0.5, 1.1], decayExponent: [0.7, 1.45],
  },
  TWO_WAVE: {
    cellCount: 2, start: [90, 2_400], duration: [800, 1_350], peak: [0.62, 0.88], stagger: [620, 1_180],
    travel: [1.2, 1.9], radius: [0.34, 0.54], buildFraction: [0.24, 0.5], buildExponent: [0.52, 1.05], decayExponent: [0.7, 1.3],
  },
  SUSTAINED_RAIN: {
    cellCount: 1, start: [90, 1_750], duration: [2_400, 4_000], peak: [0.58, 0.86], stagger: [0, 0],
    travel: [0.72, 1.2], radius: [0.6, 0.84], buildFraction: [0.18, 0.34], buildExponent: [0.48, 0.9], decayExponent: [0.25, 0.58],
  },
  HEAVY_SUSTAINED: {
    cellCount: 1, start: [80, 1_900], duration: [1_900, 3_200], peak: [0.82, 0.99], stagger: [0, 0],
    travel: [0.68, 1.1], radius: [0.58, 0.82], buildFraction: [0.12, 0.26], buildExponent: [0.3, 0.72], decayExponent: [0.22, 0.5],
  },
  SUNSHOWER: {
    cellCount: 2, start: [140, 3_300], duration: [520, 850], peak: [0.56, 0.78], stagger: [120, 480],
    travel: [1.5, 2.25], radius: [0.3, 0.46], buildFraction: [0.16, 0.38], buildExponent: [0.4, 0.9], decayExponent: [0.7, 1.4],
  },
  STOP_START_SHOWERS: {
    cellCount: 3, start: [100, 2_200], duration: [620, 1_050], peak: [0.6, 0.86], stagger: [360, 760],
    travel: [1.2, 1.95], radius: [0.32, 0.5], buildFraction: [0.18, 0.42], buildExponent: [0.42, 0.95], decayExponent: [0.62, 1.25],
  },
  LATE_STORM: {
    cellCount: 2, start: [2_300, 4_000], duration: [900, 1_650], peak: [0.7, 0.99], stagger: [60, 260],
    travel: [1.0, 1.7], radius: [0.46, 0.72], buildFraction: [0.1, 0.28], buildExponent: [0.22, 0.6], decayExponent: [0.45, 0.9],
  },
  CLEARING_RAIN: {
    cellCount: 1, start: [-620, -80], duration: [1_700, 2_800], peak: [0.6, 0.86], stagger: [0, 0],
    travel: [0.8, 1.35], radius: [0.52, 0.76], buildFraction: [0.14, 0.3], buildExponent: [0.34, 0.75], decayExponent: [0.42, 0.82],
  },
};

function range(seed: number, stream: number, minimum: number, maximum: number): number {
  return minimum + hashNoise(seed, stream, 0) * (maximum - minimum);
}

/** A seed creates one to three independent cells with varied timing and direction. */
export function createWeatherScenario(seed: number): WeatherScenario {
  const cached = weatherScenarioCache.get(seed);
  if (cached) return cached;
  const scenarioRoll = hashNoise(seed, 9_000, 0);
  if (scenarioRoll < WEATHER_CLEAR_SCENARIO_SHARE) {
    const clearScenario = { kind: "CLEAR" as const, cells: [] };
    weatherScenarioCache.set(seed, clearScenario);
    return clearScenario;
  }
  const rainRoll = (scenarioRoll - WEATHER_CLEAR_SCENARIO_SHARE) / (1 - WEATHER_CLEAR_SCENARIO_SHARE);
  const kind = WEATHER_RAIN_SCENARIO_KINDS[Math.min(
    WEATHER_RAIN_SCENARIO_KINDS.length - 1,
    Math.floor(rainRoll * WEATHER_RAIN_SCENARIO_KINDS.length),
  )];
  const profile = WEATHER_SCENARIO_PROFILES[kind];
  const baseStart = range(seed, 9_010, profile.start[0], profile.start[1]);
  const cells = Array.from({ length: profile.cellCount }, (_, index): WeatherCellPlan => {
    const stream = 9_100 + index * 20;
    const directionRadians = range(seed, stream, 0, Math.PI * 2);
    const perpendicularOffset = range(seed, stream + 1, -0.3, 0.3);
    const directionX = Math.cos(directionRadians);
    const directionY = Math.sin(directionRadians);
    const durationSeconds = range(seed, stream + 2, profile.duration[0], profile.duration[1]);
    const peakIntensity = range(seed, stream + 3, profile.peak[0], profile.peak[1]);
    const stagger = index === 0 ? 0 : index * range(seed, stream + 4, profile.stagger[0], profile.stagger[1]);
    const originX = 0.5 - directionX * range(seed, stream + 5, 0.72, 1.05) - directionY * perpendicularOffset;
    const originY = 0.5 - directionY * range(seed, stream + 6, 0.72, 1.05) + directionX * perpendicularOffset;
    return {
      id: `weather-cell-${index + 1}`,
      startSeconds: baseStart + stagger,
      durationSeconds,
      peakIntensity,
      originX,
      originY,
      directionRadians,
      travelDistance: range(seed, stream + 7, profile.travel[0], profile.travel[1]),
      radius: range(seed, stream + 8, profile.radius[0], profile.radius[1]),
      buildFraction: range(seed, stream + 9, profile.buildFraction[0], profile.buildFraction[1]),
      buildExponent: range(seed, stream + 10, profile.buildExponent[0], profile.buildExponent[1]),
      decayExponent: range(seed, stream + 11, profile.decayExponent[0], profile.decayExponent[1]),
    };
  });
  const scenario = { kind, cells } satisfies WeatherScenario;
  weatherScenarioCache.set(seed, scenario);
  return scenario;
}

function weatherCellEnvelope(cell: WeatherCellPlan, elapsedTime: number): number {
  const progress = (elapsedTime - cell.startSeconds) / cell.durationSeconds;
  if (progress <= 0 || progress >= 1) return 0;
  if (progress < cell.buildFraction) return Math.pow(progress / cell.buildFraction, cell.buildExponent);
  return Math.pow((1 - progress) / (1 - cell.buildFraction), cell.decayExponent);
}

function weatherCellIntensity(cell: WeatherCellPlan, elapsedTime: number, x: number, y: number): number {
  const envelope = weatherCellEnvelope(cell, elapsedTime);
  if (envelope === 0) return 0;
  const progress = clamp01((elapsedTime - cell.startSeconds) / cell.durationSeconds);
  const centreX = cell.originX + Math.cos(cell.directionRadians) * cell.travelDistance * progress;
  const centreY = cell.originY + Math.sin(cell.directionRadians) * cell.travelDistance * progress;
  const distance = Math.hypot(x - centreX, y - centreY);
  const spatialIntensity = Math.exp(-Math.pow(distance / cell.radius, 2));
  return clamp01(cell.peakIntensity * envelope * spatialIntensity);
}

function radarIntensityAt(seed: number, elapsedTime: number, x: number, y: number): number {
  const scenario = createWeatherScenario(seed);
  const combined = scenario.cells.reduce((remainingDry, cell) => (
    remainingDry * (1 - weatherCellIntensity(cell, elapsedTime, x, y))
  ), 1);
  const cellStream = 7_200 + Math.round(x * (RADAR_COLUMNS - 1)) + Math.round(y * (RADAR_ROWS - 1)) * RADAR_COLUMNS;
  const localVariation = 0.92 + smoothNoise(seed, cellStream, elapsedTime, 27) * 0.08;
  const pulse = 0.94 + smoothNoise(seed, 7_500, elapsedTime, 18) * 0.06;
  return clamp01((1 - combined) * localVariation * pulse);
}

function radarProbabilityAt(seed: number, elapsedTime: number, x: number, y: number): number {
  const now = radarIntensityAt(seed, elapsedTime, x, y);
  const approaching = Math.max(
    radarIntensityAt(seed, elapsedTime + 60, x, y),
    radarIntensityAt(seed, elapsedTime + 180, x, y),
    radarIntensityAt(seed, elapsedTime + 300, x, y),
  );
  return clamp01(now * 0.9 + approaching * 0.78);
}

function rainEtaSeconds(seed: number, elapsedTime: number, x: number, y: number): number | null {
  if (radarIntensityAt(seed, elapsedTime, x, y) >= 0.08) return 0;
  for (let offset = 30; offset <= 900; offset += 30) {
    if (radarIntensityAt(seed, elapsedTime + offset, x, y) >= 0.08) return offset;
  }
  return null;
}

function buildRadar(seed: number, elapsedTime: number): WeatherRadarCell[] {
  return Array.from({ length: WEATHER_RADAR_CELL_COUNT }, (_, index) => {
    const row = Math.floor(index / RADAR_COLUMNS);
    const column = index % RADAR_COLUMNS;
    const x = column / (RADAR_COLUMNS - 1);
    const y = row / (RADAR_ROWS - 1);
    return {
      id: `radar-${index + 1}`,
      row,
      column,
      x,
      y,
      rainIntensity: radarIntensityAt(seed, elapsedTime, x, y),
      rainProbability: radarProbabilityAt(seed, elapsedTime, x, y),
      etaSeconds: rainEtaSeconds(seed, elapsedTime, x, y),
    };
  });
}

function zoneRadarPosition(index: number): { x: number; y: number } {
  const ratio = (index + 0.5) / WEATHER_SURFACE_ZONE_COUNT;
  const angle = ratio * Math.PI * 2;
  return {
    x: clamp01(0.5 + Math.cos(angle) * 0.41 + Math.cos(angle * 3 + 0.4) * 0.07),
    y: clamp01(0.5 + Math.sin(angle) * 0.33 - Math.sin(angle * 2 - 0.25) * 0.08),
  };
}

function sectorForZone(index: number): WeatherSector {
  return (Math.floor(index / (WEATHER_SURFACE_ZONE_COUNT / WEATHER_SECTOR_COUNT)) + 1) as WeatherSector;
}

function trafficForZone(traffic: SpatialWeatherOptions["trafficIntensity"], index: number): number {
  if (typeof traffic === "number") return clamp01(traffic);
  if (traffic) return clamp01(traffic[index] ?? 0.55);
  return 0.55;
}

function createSurfaceZones(seed: number, trackLengthMeters: number, traffic: SpatialWeatherOptions["trafficIntensity"]): TrackSurfaceZone[] {
  const zoneLength = trackLengthMeters / WEATHER_SURFACE_ZONE_COUNT;
  return Array.from({ length: WEATHER_SURFACE_ZONE_COUNT }, (_, index) => ({
    id: `surface-${index + 1}`,
    index,
    startDistance: index * zoneLength,
    endDistance: (index + 1) * zoneLength,
    sector: sectorForZone(index),
    rainIntensity: 0,
    wetness: 0,
    standingWater: 0,
    dryingLine: 1,
    drainage: clamp01(0.48 + (signedNoise(seed, 8_100 + index, 0) + 1) * 0.24),
    traffic: trafficForZone(traffic, index),
  }));
}

function advanceSurfaceZones(
  previousZones: readonly TrackSurfaceZone[],
  elapsedTime: number,
  seed: number,
  deltaSeconds: number,
  traffic: SpatialWeatherOptions["trafficIntensity"],
): TrackSurfaceZone[] {
  return previousZones.map((zone, index) => {
    const radarPosition = zoneRadarPosition(index);
    const microVariation = 0.94 + smoothNoise(seed, 8_500 + index, elapsedTime, 31) * 0.09;
    const rainIntensity = clamp01(radarIntensityAt(seed, elapsedTime, radarPosition.x, radarPosition.y) * microVariation);
    const zoneTraffic = trafficForZone(traffic, index);
    const rainGain = rainIntensity * 0.0092 * (0.58 + (1 - zone.wetness) * 0.42);
    const thermalDrying = (0.00028 + zone.drainage * 0.00068) * (1 - rainIntensity * 0.72);
    const trafficDrying = zoneTraffic * (0.00018 + (1 - rainIntensity) * 0.00082) * Math.min(1, zone.wetness * 3);
    const wetness = clamp01(zone.wetness + (rainGain - thermalDrying - trafficDrying) * deltaSeconds);

    const pooling = Math.max(0, rainIntensity - 0.36) * 0.0042 + Math.max(0, wetness - 0.72) * 0.0014;
    const drainage = (0.00042 + zone.drainage * 0.00115) * (1 - rainIntensity * 0.5);
    const trafficDisplacement = zoneTraffic * 0.00034;
    const standingWater = clamp01(zone.standingWater + (pooling - drainage - trafficDisplacement) * deltaSeconds);

    const dryingLineTarget = wetness < 0.02
      ? 1
      : clamp01((1 - wetness) * 0.52 + zoneTraffic * (1 - rainIntensity) * 0.48 - standingWater * 0.38);
    const dryingLineBlend = 1 - Math.exp(-0.045 * deltaSeconds);
    const dryingLine = clamp01(zone.dryingLine + (dryingLineTarget - zone.dryingLine) * dryingLineBlend);

    return {
      ...zone,
      rainIntensity,
      wetness,
      standingWater,
      dryingLine,
      traffic: zoneTraffic,
    };
  });
}

function conditionFor(rainIntensity: number, rainProbability: number, wetness = 0): WeatherCondition {
  if (rainIntensity > 0.56) return "HEAVY_RAIN";
  if (rainIntensity > 0.06) return "LIGHT_RAIN";
  if (rainProbability > 0.2 || wetness > 0.08) return "CLOUDY";
  return "DRY";
}

function buildForecast(seed: number, elapsedTime: number): WeatherForecastPoint[] {
  return FORECAST_MINUTES.map((minutesAhead) => {
    const forecastTime = elapsedTime + minutesAhead * 60;
    const samples = Array.from({ length: WEATHER_RADAR_CELL_COUNT }, (_, index) => {
      const row = Math.floor(index / RADAR_COLUMNS);
      const column = index % RADAR_COLUMNS;
      const x = column / (RADAR_COLUMNS - 1);
      const y = row / (RADAR_ROWS - 1);
      return {
        intensity: radarIntensityAt(seed, forecastTime, x, y),
        probability: radarProbabilityAt(seed, forecastTime, x, y),
      };
    });
    const rainIntensity = average(samples.map((sample) => sample.intensity));
    const rainProbability = clamp01(average(samples.map((sample) => sample.probability)));
    return {
      minutesAhead,
      condition: conditionFor(rainIntensity, rainProbability),
      rainProbability,
      rainIntensity,
    };
  });
}

function aggregateSectors(zones: readonly TrackSurfaceZone[]): WeatherSectorState[] {
  return ([1, 2, 3] as const).map((sector) => {
    const sectorZones = zones.filter((zone) => zone.sector === sector);
    const rainIntensity = average(sectorZones.map((zone) => zone.rainIntensity));
    const wetness = average(sectorZones.map((zone) => zone.wetness));
    const standingWater = average(sectorZones.map((zone) => zone.standingWater));
    const dryingLine = average(sectorZones.map((zone) => zone.dryingLine));
    return {
      sector,
      rainIntensity,
      wetness,
      standingWater,
      dryingLine,
      condition: conditionFor(rainIntensity, rainIntensity, wetness),
    };
  });
}

/** Base surface temperature before the session has laid any rubber. */
const TRACK_TEMPERATURE_BASE_C = 28;
/** Total warming a fully rubbered-in track gains over a session. */
const TRACK_TEMPERATURE_EVOLUTION_C = 5.5;
/** Time to reach most of that evolution, roughly a full race distance. */
const TRACK_EVOLUTION_TIME_CONSTANT_SECONDS = 1_800;
/** Small solar/sky oscillation keeps the live readout moving between rain cells. */
const TRACK_TEMPERATURE_SOLAR_SWING_C = 0.55;
const AIR_TEMPERATURE_BASE_C = 22;
const AIR_TEMPERATURE_SWING_C = 0.65;

function weatherCycle(elapsedTime: number, periodSeconds: number, phase = 0): number {
  return Math.sin((Math.max(0, elapsedTime) / periodSeconds) * Math.PI * 2 + phase);
}

/**
 * Surface temperature follows track evolution and the weather together.
 *
 * Running rubbers the surface in and warms it, approaching a plateau rather than
 * climbing without limit. Rain undoes that quickly: falling rain cools the
 * surface directly and standing water keeps it cool afterwards, which is why a
 * wet track stays cold even once the shower has passed.
 */
export function trackTemperatureFor(
  elapsedTime: number,
  rainIntensity: number,
  trackWetness: number,
  rainProbability = rainIntensity,
): number {
  const evolution = 1 - Math.exp(-Math.max(0, elapsedTime) / TRACK_EVOLUTION_TIME_CONSTANT_SECONDS);
  const forecastCloud = clamp01(rainProbability * 0.78 + trackWetness * 0.24);
  // Rain suppresses the rubbering-in benefit as well as cooling the surface.
  const evolutionGain = TRACK_TEMPERATURE_EVOLUTION_C * evolution * (1 - Math.min(1, trackWetness * 1.15));
  const solarSwing = weatherCycle(elapsedTime, 3_600, 0.25)
    * TRACK_TEMPERATURE_SOLAR_SWING_C
    * (1 - forecastCloud);
  const rainCooling = rainIntensity * 9 + rainProbability * 1.2;
  const wetCooling = trackWetness * 4.5;
  return Math.max(12, Math.min(40, TRACK_TEMPERATURE_BASE_C + evolutionGain + solarSwing - rainCooling - wetCooling));
}

function airTemperatureFor(elapsedTime: number, rainIntensity: number, rainProbability: number): number {
  const atmosphericSwing = weatherCycle(elapsedTime, 4_800, -0.35) * AIR_TEMPERATURE_SWING_C;
  const rainCooling = rainIntensity * 3.5 + rainProbability * 0.8;
  return Math.max(12, Math.min(29, AIR_TEMPERATURE_BASE_C + atmosphericSwing - rainCooling));
}

function assembleWeather(seed: number, elapsedTime: number, zones: readonly TrackSurfaceZone[]): WeatherState {
  const radarCells = buildRadar(seed, elapsedTime);
  const sectors = aggregateSectors(zones);
  const forecast = buildForecast(seed, elapsedTime);
  const rainIntensity = average(zones.map((zone) => zone.rainIntensity));
  const trackWetness = average(zones.map((zone) => zone.wetness));
  const rainProbability = average(radarCells.map((cell) => cell.rainProbability));
  const radarEta = radarCells.reduce<number | null>((soonest, cell) => {
    if (cell.etaSeconds === null) return soonest;
    return soonest === null ? cell.etaSeconds : Math.min(soonest, cell.etaSeconds);
  }, null);
  const nextRain = rainIntensity > 0.04
    ? 0
    : radarEta !== null
      ? Math.ceil(radarEta / 60)
      : forecast.find((point) => point.rainIntensity > 0.04 || point.rainProbability > 0.3)?.minutesAhead ?? null;
  return {
    condition: conditionFor(rainIntensity, rainProbability, trackWetness),
    rainIntensity,
    trackWetness,
    airTemperature: airTemperatureFor(elapsedTime, rainIntensity, rainProbability),
    trackTemperature: trackTemperatureFor(elapsedTime, rainIntensity, trackWetness, rainProbability),
    forecastRainInMinutes: nextRain,
    radarCells,
    surfaceZones: zones,
    sectors,
    forecast,
  };
}

export function createSpatialWeather(seed: number, elapsedTime = 0, options: SpatialWeatherOptions = {}): WeatherState {
  const targetTime = Math.max(0, elapsedTime);
  const trackLengthMeters = options.trackLengthMeters ?? DEFAULT_WEATHER_TRACK_LENGTH_METERS;
  let zones = createSurfaceZones(seed, trackLengthMeters, options.trafficIntensity);
  let cursor = 0;
  while (cursor < targetTime) {
    const deltaSeconds = Math.min(1, targetTime - cursor);
    cursor += deltaSeconds;
    zones = advanceSurfaceZones(zones, cursor, seed, deltaSeconds, options.trafficIntensity);
  }
  return assembleWeather(seed, targetTime, zones);
}

export function updateSpatialWeather(
  previous: WeatherState,
  elapsedTime: number,
  seed: number,
  options: SpatialWeatherOptions = {},
): WeatherState {
  const trackLengthMeters = options.trackLengthMeters ?? DEFAULT_WEATHER_TRACK_LENGTH_METERS;
  const previousZones = previous.surfaceZones?.length === WEATHER_SURFACE_ZONE_COUNT
    ? previous.surfaceZones
    : createSurfaceZones(seed, trackLengthMeters, options.trafficIntensity);
  const deltaSeconds = Math.max(0, Math.min(5, options.deltaSeconds ?? 1));
  const zones = advanceSurfaceZones(previousZones, Math.max(0, elapsedTime), seed, deltaSeconds, options.trafficIntensity);
  return assembleWeather(seed, Math.max(0, elapsedTime), zones);
}

function effectiveWaterForZone(zone: TrackSurfaceZone): number {
  return clamp01(zone.wetness * (1 - zone.dryingLine * 0.35) + zone.standingWater * 0.5 + zone.rainIntensity * 0.04);
}

export function effectiveWaterAtDistance(
  weather: WeatherState,
  lapDistance: number,
  trackLengthMeters = DEFAULT_WEATHER_TRACK_LENGTH_METERS,
): number {
  const zones = weather.surfaceZones;
  if (!zones || zones.length === 0 || trackLengthMeters <= 0) return clamp01(weather.trackWetness);
  const normalizedDistance = ((lapDistance % trackLengthMeters) + trackLengthMeters) % trackLengthMeters;
  const zoneCursor = (normalizedDistance / trackLengthMeters) * zones.length;
  const currentIndex = Math.floor(zoneCursor) % zones.length;
  const nextIndex = (currentIndex + 1) % zones.length;
  const blend = zoneCursor - Math.floor(zoneCursor);
  const currentWater = effectiveWaterForZone(zones[currentIndex]);
  const nextWater = effectiveWaterForZone(zones[nextIndex]);
  return clamp01(currentWater + (nextWater - currentWater) * blend);
}

export function summarizeWeatherSectors(weather: WeatherState): readonly WeatherSectorState[] {
  if (weather.surfaceZones && weather.surfaceZones.length > 0) return aggregateSectors(weather.surfaceZones);
  if (weather.sectors && weather.sectors.length === WEATHER_SECTOR_COUNT) return weather.sectors;
  return ([1, 2, 3] as const).map((sector) => ({
    sector,
    rainIntensity: clamp01(weather.rainIntensity),
    wetness: clamp01(weather.trackWetness),
    standingWater: 0,
    dryingLine: clamp01(1 - weather.trackWetness),
    condition: weather.condition,
  }));
}

export function forecastAtMinutes(weather: WeatherState, minutesAhead: number): WeatherForecastPoint {
  const target = Math.max(0, minutesAhead);
  const forecast = weather.forecast;
  if (!forecast || forecast.length === 0) {
    return {
      minutesAhead: target,
      condition: weather.condition,
      rainProbability: weather.rainIntensity > 0.04 ? 1 : 0,
      rainIntensity: clamp01(weather.rainIntensity),
    };
  }
  const upperIndex = forecast.findIndex((point) => point.minutesAhead >= target);
  if (upperIndex === -1) return { ...forecast[forecast.length - 1], minutesAhead: target };
  if (upperIndex === 0) return { ...forecast[0], minutesAhead: target };
  const lower = forecast[upperIndex - 1];
  const upper = forecast[upperIndex];
  const span = Math.max(0.001, upper.minutesAhead - lower.minutesAhead);
  const blend = clamp01((target - lower.minutesAhead) / span);
  const rainIntensity = lower.rainIntensity + (upper.rainIntensity - lower.rainIntensity) * blend;
  const rainProbability = lower.rainProbability + (upper.rainProbability - lower.rainProbability) * blend;
  return {
    minutesAhead: target,
    condition: conditionFor(rainIntensity, rainProbability),
    rainProbability: clamp01(rainProbability),
    rainIntensity: clamp01(rainIntensity),
  };
}
