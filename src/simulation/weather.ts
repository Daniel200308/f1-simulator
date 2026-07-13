import type {
  TrackSurfaceZone,
  WeatherCondition,
  WeatherForecastPoint,
  WeatherRadarCell,
  WeatherSector,
  WeatherSectorState,
  WeatherState,
} from "@/domain/race";
import { signedNoise } from "@/simulation/random";

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

function rainWindow(seed: number): { start: number; end: number } {
  const start = 180 + Math.abs(seed % 180);
  return { start, end: start + 620 };
}

function rainEnvelope(seed: number, elapsedTime: number): number {
  const { start, end } = rainWindow(seed);
  if (elapsedTime <= start || elapsedTime >= end) return 0;
  const progress = (elapsedTime - start) / (end - start);
  return Math.pow(Math.sin(progress * Math.PI), 0.72);
}

function radarIntensityAt(seed: number, elapsedTime: number, x: number, y: number): number {
  const { start, end } = rainWindow(seed);
  const envelope = rainEnvelope(seed, elapsedTime);
  if (envelope === 0) return 0;

  const progress = (elapsedTime - start) / (end - start);
  const slope = signedNoise(seed, 7_100, 0) * 0.38;
  const front = -0.24 + progress * 1.48;
  const projectedX = x + (y - 0.5) * slope;
  const distanceToFront = projectedX - front;
  const mainBand = Math.exp(-Math.pow(distanceToFront / 0.24, 2));
  const trailingBand = Math.exp(-Math.pow((distanceToFront + 0.31) / 0.19, 2)) * 0.42;
  const cellStream = 7_200 + Math.round(x * (RADAR_COLUMNS - 1)) + Math.round(y * (RADAR_ROWS - 1)) * RADAR_COLUMNS;
  const localVariation = 0.9 + smoothNoise(seed, cellStream, elapsedTime, 38) * 0.14;
  const rainPulse = 0.91 + smoothNoise(seed, 7_500, elapsedTime, 24) * 0.09;
  return clamp01(envelope * (0.1 + mainBand * 0.91 + trailingBand) * localVariation * rainPulse);
}

function radarProbabilityAt(seed: number, elapsedTime: number, x: number, y: number): number {
  const { start, end } = rainWindow(seed);
  const envelope = rainEnvelope(seed, elapsedTime);
  if (elapsedTime > end || elapsedTime + 900 < start) return 0;
  if (elapsedTime < start) {
    const approach = clamp01(1 - (start - elapsedTime) / 300);
    return approach * (0.32 + (1 - x) * 0.18);
  }
  const progress = (elapsedTime - start) / (end - start);
  const slope = signedNoise(seed, 7_100, 0) * 0.38;
  const front = -0.24 + progress * 1.48;
  const distanceToFront = x + (y - 0.5) * slope - front;
  const broadBand = Math.exp(-Math.pow(distanceToFront / 0.38, 2));
  return clamp01(envelope * (0.2 + broadBand * 0.82) + radarIntensityAt(seed, elapsedTime, x, y) * 0.22);
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
    airTemperature: 22 - rainIntensity * 3.5,
    trackTemperature: 31 - rainIntensity * 9 - trackWetness * 4,
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
