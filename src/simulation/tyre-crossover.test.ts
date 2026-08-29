import { describe, expect, it } from "vitest";

import type { TrackSurfaceZone, WeatherForecastPoint, WeatherState } from "@/domain/race";
import { estimateTyreCrossover } from "@/simulation/tyre-crossover";

function weatherFixture(
  wetness: number,
  standingWater: number,
  rainIntensity: number,
  forecast: readonly WeatherForecastPoint[],
  wetZoneCount = 48,
): WeatherState {
  const zoneLength = 5_891 / 48;
  const zones: TrackSurfaceZone[] = Array.from({ length: 48 }, (_, index) => {
    const isWet = index < wetZoneCount;
    return {
      id: `zone-${index + 1}`,
      index,
      startDistance: index * zoneLength,
      endDistance: (index + 1) * zoneLength,
      sector: (Math.floor(index / 16) + 1) as 1 | 2 | 3,
      rainIntensity: isWet ? rainIntensity : 0,
      wetness: isWet ? wetness : 0,
      standingWater: isWet ? standingWater : 0,
      dryingLine: isWet ? 0.12 : 1,
      drainage: 0.6,
      traffic: 0.65,
    };
  });
  return {
    condition: rainIntensity > 0.55 ? "HEAVY_RAIN" : rainIntensity > 0.05 ? "LIGHT_RAIN" : "DRY",
    rainIntensity,
    trackWetness: wetness * wetZoneCount / 48,
    airTemperature: 20,
    trackTemperature: 27,
    forecastRainInMinutes: rainIntensity > 0 ? 0 : null,
    surfaceZones: zones,
    forecast,
  };
}

const dryForecast: readonly WeatherForecastPoint[] = [0, 2, 5, 10, 15].map((minutesAhead) => ({
  minutesAhead,
  condition: "DRY" as const,
  rainProbability: 0,
  rainIntensity: 0,
}));

describe("tyre crossover model", () => {
  it("keeps the comparison on dry compounds on a dry Silverstone", () => {
    const result = estimateTyreCrossover({
      weather: weatherFixture(0, 0, 0, dryForecast, 0),
      currentCompound: "MEDIUM",
      availableCompounds: ["SOFT", "HARD", "INTERMEDIATE", "WET"],
      remainingLaps: 12,
      pitLossSeconds: 23,
    });

    expect(["SOFT", "MEDIUM", "HARD"]).toContain(result.bestCompound);
    expect(result.recommendedCompound).toBe("MEDIUM");
    expect(result.shouldPit).toBe(false);
    expect(result.currentLapSeconds).toBeGreaterThan(88);
    expect(result.zonesEvaluated).toBe(48);
  });

  it("selects intermediates for sustained moderate wetness", () => {
    const forecast: readonly WeatherForecastPoint[] = [0, 2, 5, 10, 15].map((minutesAhead) => ({
      minutesAhead,
      condition: "LIGHT_RAIN" as const,
      rainProbability: 0.92,
      rainIntensity: 0.34,
    }));
    const result = estimateTyreCrossover({
      weather: weatherFixture(0.35, 0.05, 0.34, forecast),
      currentCompound: "MEDIUM",
      availableCompounds: ["INTERMEDIATE", "WET"],
      remainingLaps: 14,
      pitLossSeconds: 23,
    });

    expect(result.bestCompound).toBe("INTERMEDIATE");
    expect(result.recommendedCompound).toBe("INTERMEDIATE");
    expect(result.shouldPit).toBe(true);
    expect(result.expectedWetLaps).toBeGreaterThan(8);
    expect(result.netRaceGainSeconds).toBeGreaterThan(0);
    expect(result.reason).toContain("INTERMEDIATE");
  });

  it("selects full wets for heavy standing water", () => {
    const forecast: readonly WeatherForecastPoint[] = [0, 2, 5, 10, 15].map((minutesAhead) => ({
      minutesAhead,
      condition: "HEAVY_RAIN" as const,
      rainProbability: 1,
      rainIntensity: 0.82,
    }));
    const result = estimateTyreCrossover({
      weather: weatherFixture(0.82, 0.58, 0.82, forecast),
      currentCompound: "INTERMEDIATE",
      availableCompounds: ["WET"],
      remainingLaps: 10,
      pitLossSeconds: 23,
    });

    expect(result.bestCompound).toBe("WET");
    expect(result.shouldPit).toBe(true);
    expect(result.bestLapSeconds).toBeLessThan(result.currentLapSeconds);
    expect(result.reason).toContain("standing water");
  });

  it("stays out when a narrow shower cannot repay the pit loss", () => {
    const showerForecast: readonly WeatherForecastPoint[] = [
      { minutesAhead: 0, condition: "LIGHT_RAIN", rainProbability: 0.55, rainIntensity: 0.18 },
      { minutesAhead: 2, condition: "CLOUDY", rainProbability: 0.18, rainIntensity: 0.03 },
      { minutesAhead: 5, condition: "DRY", rainProbability: 0, rainIntensity: 0 },
      { minutesAhead: 10, condition: "DRY", rainProbability: 0, rainIntensity: 0 },
      { minutesAhead: 15, condition: "DRY", rainProbability: 0, rainIntensity: 0 },
    ];
    const input = {
      weather: weatherFixture(0.32, 0.04, 0.18, showerForecast, 5),
      currentCompound: "MEDIUM" as const,
      availableCompounds: ["INTERMEDIATE" as const, "WET" as const],
      remainingLaps: 16,
      pitLossSeconds: 23,
    };
    const first = estimateTyreCrossover(input);
    const second = estimateTyreCrossover(input);

    expect(first).toEqual(second);
    expect(first.recommendedCompound).toBe("MEDIUM");
    expect(first.shouldPit).toBe(false);
    expect(first.expectedWetLaps).toBeLessThan(2);
    expect(first.netRaceGainSeconds).toBeLessThanOrEqual(0);
  });
});
