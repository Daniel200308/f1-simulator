import { describe, expect, it } from "vitest";

import type { TrackSurfaceZone, WeatherState } from "@/domain/race";
import {
  createSpatialWeather,
  effectiveWaterAtDistance,
  forecastAtMinutes,
  summarizeWeatherSectors,
  updateSpatialWeather,
  WEATHER_RADAR_CELL_COUNT,
  WEATHER_SECTOR_COUNT,
  WEATHER_SURFACE_ZONE_COUNT,
} from "@/simulation/weather";

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function expectUnitInterval(value: number): void {
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
}

describe("spatial weather", () => {
  it("creates bounded radar, surface, sector, and forecast data", () => {
    const weather = createSpatialWeather(20_260_712);

    expect(weather.radarCells).toHaveLength(WEATHER_RADAR_CELL_COUNT);
    expect(weather.surfaceZones).toHaveLength(WEATHER_SURFACE_ZONE_COUNT);
    expect(weather.sectors).toHaveLength(WEATHER_SECTOR_COUNT);
    expect(weather.forecast).toHaveLength(5);
    expect(weather.condition).toBe("DRY");
    expect(weather.forecastRainInMinutes).toBeGreaterThanOrEqual(4);
    expect(weather.forecastRainInMinutes).toBeLessThanOrEqual(6);

    weather.radarCells?.forEach((cell) => {
      expectUnitInterval(cell.x);
      expectUnitInterval(cell.y);
      expectUnitInterval(cell.rainIntensity);
      expectUnitInterval(cell.rainProbability);
      expect(cell.etaSeconds === null || cell.etaSeconds >= 0).toBe(true);
    });
    weather.surfaceZones?.forEach((zone) => {
      expectUnitInterval(zone.rainIntensity);
      expectUnitInterval(zone.wetness);
      expectUnitInterval(zone.standingWater);
      expectUnitInterval(zone.dryingLine);
      expectUnitInterval(zone.drainage);
      expectUnitInterval(zone.traffic);
    });
    weather.sectors?.forEach((sector) => {
      expectUnitInterval(sector.rainIntensity);
      expectUnitInterval(sector.wetness);
      expectUnitInterval(sector.standingWater);
      expectUnitInterval(sector.dryingLine);
    });
  });

  it("is deterministic for the same seed, time, and inputs", () => {
    const first = createSpatialWeather(7_777, 438, { trafficIntensity: 0.62 });
    const second = createSpatialWeather(7_777, 438, { trafficIntensity: 0.62 });
    expect(first).toEqual(second);

    const firstUpdate = updateSpatialWeather(first, 439, 7_777, { deltaSeconds: 1, trafficIntensity: 0.62 });
    const secondUpdate = updateSpatialWeather(second, 439, 7_777, { deltaSeconds: 1, trafficIntensity: 0.62 });
    expect(firstUpdate).toEqual(secondUpdate);
  });

  it("moves a rain band across the circuit instead of wetting every zone equally", () => {
    const weather = createSpatialWeather(20_260_712, 460);
    const localRain = weather.surfaceZones?.map((zone) => zone.rainIntensity) ?? [];
    const localWater = weather.surfaceZones?.map((zone) => zone.wetness) ?? [];

    expect(Math.max(...localRain) - Math.min(...localRain)).toBeGreaterThan(0.12);
    expect(Math.max(...localWater) - Math.min(...localWater)).toBeGreaterThan(0.08);
    expect(effectiveWaterAtDistance(weather, 250)).not.toBe(effectiveWaterAtDistance(weather, 3_200));
  });

  it("dries in clear weather, with drainage and traffic accelerating water removal", () => {
    const dryWeather = createSpatialWeather(91, 1_600);
    const saturatedZones = dryWeather.surfaceZones?.map((zone, index) => ({
      ...zone,
      wetness: 0.82,
      standingWater: 0.32,
      dryingLine: 0.08,
      drainage: index % 2 === 0 ? 0.2 : 0.9,
    } satisfies TrackSurfaceZone)) ?? [];
    const saturated: WeatherState = {
      ...dryWeather,
      rainIntensity: 0,
      trackWetness: 0.82,
      surfaceZones: saturatedZones,
    };

    const noTraffic = updateSpatialWeather(saturated, 1_601, 91, { deltaSeconds: 1, trafficIntensity: 0 });
    const fullTraffic = updateSpatialWeather(saturated, 1_601, 91, { deltaSeconds: 1, trafficIntensity: 1 });
    const noTrafficZones = noTraffic.surfaceZones ?? [];
    const fullTrafficZones = fullTraffic.surfaceZones ?? [];

    expect(mean(fullTrafficZones.map((zone) => zone.wetness))).toBeLessThan(mean(noTrafficZones.map((zone) => zone.wetness)));
    expect(mean(fullTrafficZones.map((zone) => zone.standingWater))).toBeLessThan(mean(noTrafficZones.map((zone) => zone.standingWater)));
    expect(mean(fullTrafficZones.map((zone) => zone.dryingLine))).toBeGreaterThan(mean(noTrafficZones.map((zone) => zone.dryingLine)));
    expect(noTrafficZones[1].wetness).toBeLessThan(noTrafficZones[0].wetness);
    expect(noTrafficZones[1].standingWater).toBeLessThan(noTrafficZones[0].standingWater);

    let drying = saturated;
    for (let second = 1; second <= 60; second += 1) {
      drying = updateSpatialWeather(drying, 1_600 + second, 91, { deltaSeconds: 1, trafficIntensity: 0.55 });
    }
    expect(drying.trackWetness).toBeLessThan(saturated.trackWetness);
    expect(mean((drying.surfaceZones ?? []).map((zone) => zone.standingWater))).toBeLessThan(0.32);
  });

  it("provides stable sector summaries and interpolated forecasts", () => {
    const weather = createSpatialWeather(5_678, 360);
    const sectors = summarizeWeatherSectors(weather);
    const forecast = forecastAtMinutes(weather, 3.5);

    expect(sectors).toHaveLength(WEATHER_SECTOR_COUNT);
    expect(sectors.map((sector) => sector.sector)).toEqual([1, 2, 3]);
    expect(forecast.minutesAhead).toBe(3.5);
    expectUnitInterval(forecast.rainIntensity);
    expectUnitInterval(forecast.rainProbability);
    expectUnitInterval(effectiveWaterAtDistance(weather, -100));
  });
});
