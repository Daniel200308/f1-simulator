import type { TrackSurfaceZone, TyreCompound, WeatherState } from "@/domain/race";
import {
  SILVERSTONE_REFERENCE_LAP_SECONDS,
  telemetrySpeedAtDistance,
} from "@/simulation/silverstone-telemetry";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { effectiveWaterAtDistance, forecastAtMinutes } from "@/simulation/weather";

const ZONE_COUNT = 48;
const ALL_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

const STINT_DEGRADATION_SECONDS: Readonly<Record<TyreCompound, number>> = {
  SOFT: 0.085,
  MEDIUM: 0.048,
  HARD: 0.027,
  INTERMEDIATE: 0.058,
  WET: 0.043,
};

export interface TyreCrossoverInput {
  weather: WeatherState;
  currentCompound: TyreCompound;
  availableCompounds: readonly TyreCompound[];
  remainingLaps: number;
  pitLossSeconds?: number;
}

export interface TyreCompoundCrossoverEstimate {
  compound: TyreCompound;
  currentLapSeconds: number;
  projectedRaceSeconds: number;
  averageLapSeconds: number;
}

export interface TyreCrossoverEstimate {
  currentCompound: TyreCompound;
  bestCompound: TyreCompound;
  recommendedCompound: TyreCompound;
  shouldPit: boolean;
  currentLapSeconds: number;
  bestLapSeconds: number;
  gainRangePerLapSeconds: {
    low: number;
    high: number;
  };
  expectedWetLaps: number;
  grossRaceGainSeconds: number;
  netRaceGainSeconds: number;
  pitLossSeconds: number;
  confidence: number;
  reason: string;
  zonesEvaluated: number;
  compounds: readonly TyreCompoundCrossoverEstimate[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function smoothstep(value: number): number {
  const bounded = clamp01(value);
  return bounded * bounded * (3 - 2 * bounded);
}

function timeRatioFor(compound: TyreCompound, effectiveWater: number): number {
  const water = clamp01(effectiveWater);
  switch (compound) {
    case "SOFT":
      return 0.995 + water * 0.25 + water * water * 0.7;
    case "MEDIUM":
      return 1 + water * 0.23 + water * water * 0.74;
    case "HARD":
      return 1.004 + water * 0.21 + water * water * 0.8;
    case "INTERMEDIATE":
      return 1.022 + Math.pow(water - 0.32, 2) * 0.72;
    case "WET":
      return 1.085 + Math.pow(water - 0.72, 2) * 0.36;
  }
}

function surfaceZoneForSample(weather: WeatherState, index: number): TrackSurfaceZone | undefined {
  const zones = weather.surfaceZones;
  if (!zones || zones.length === 0) return undefined;
  return zones[Math.min(zones.length - 1, Math.floor(((index + 0.5) / ZONE_COUNT) * zones.length))];
}

function buildTelemetryZoneTimes(): readonly number[] {
  const zoneLength = SILVERSTONE_CIRCUIT.lengthMeters / ZONE_COUNT;
  const rawTimes = Array.from({ length: ZONE_COUNT }, (_, index) => {
    const start = index * zoneLength;
    const middle = start + zoneLength / 2;
    const end = start + zoneLength;
    const averageSpeedKph = (
      telemetrySpeedAtDistance(start)
      + telemetrySpeedAtDistance(middle) * 4
      + telemetrySpeedAtDistance(end)
    ) / 6;
    return zoneLength / (averageSpeedKph / 3.6);
  });
  const rawLapSeconds = rawTimes.reduce((total, seconds) => total + seconds, 0);
  const normalization = SILVERSTONE_REFERENCE_LAP_SECONDS / rawLapSeconds;
  return rawTimes.map((seconds) => seconds * normalization);
}

const TELEMETRY_ZONE_TIMES = buildTelemetryZoneTimes();

function currentZoneWater(weather: WeatherState): readonly number[] {
  const zoneLength = SILVERSTONE_CIRCUIT.lengthMeters / ZONE_COUNT;
  return Array.from({ length: ZONE_COUNT }, (_, index) =>
    effectiveWaterAtDistance(weather, (index + 0.5) * zoneLength, SILVERSTONE_CIRCUIT.lengthMeters),
  );
}

function projectedZoneWater(
  weather: WeatherState,
  waterNow: readonly number[],
  minutesAhead: number,
): readonly number[] {
  if (minutesAhead <= 0) return waterNow;
  const forecast = forecastAtMinutes(weather, minutesAhead);
  const rainTarget = clamp01(forecast.rainIntensity * (0.82 + forecast.rainProbability * 0.18));

  return waterNow.map((currentWater, index) => {
    const zone = surfaceZoneForSample(weather, index);
    const dryingLine = clamp01(zone?.dryingLine ?? 1 - weather.trackWetness);
    const drainage = clamp01(zone?.drainage ?? 0.6);
    const retentionMinutes = 3.6 + (1 - dryingLine) * 7.2 + (1 - drainage) * 3.2;
    const retainedWater = currentWater * Math.exp(-minutesAhead / retentionMinutes);
    const rainBuild = rainTarget * (1 - Math.exp(-minutesAhead / 2.4));
    return clamp01(retainedWater + rainBuild);
  });
}

function lapSeconds(compound: TyreCompound, waters: readonly number[], stintLap: number): number {
  const surfaceTime = TELEMETRY_ZONE_TIMES.reduce(
    (total, zoneSeconds, index) => total + zoneSeconds * timeRatioFor(compound, waters[index] ?? 0),
    0,
  );
  return surfaceTime + STINT_DEGRADATION_SECONDS[compound] * Math.max(0, stintLap);
}

function wetLapFraction(waters: readonly number[]): number {
  return waters.reduce((total, water) => total + smoothstep((water - 0.1) / 0.24), 0) / waters.length;
}

function orderedCompounds(current: TyreCompound, available: readonly TyreCompound[]): TyreCompound[] {
  const allowed = new Set<TyreCompound>([current, ...available.filter((compound) => ALL_COMPOUNDS.includes(compound))]);
  return ALL_COMPOUNDS.filter((compound) => allowed.has(compound));
}

function recommendationReason(
  bestCompound: TyreCompound,
  currentCompound: TyreCompound,
  shouldPit: boolean,
  expectedWetLaps: number,
  grossGain: number,
  pitLoss: number,
  waters: readonly number[],
): string {
  const averageWater = waters.reduce((total, water) => total + water, 0) / waters.length;
  if (!shouldPit && bestCompound !== currentCompound) {
    return `The weather window is too short or localised: ${grossGain.toFixed(1)}s gross gain does not recover the ${pitLoss.toFixed(1)}s pit loss.`;
  }
  if (!shouldPit) {
    return expectedWetLaps > 0.2
      ? `${currentCompound} remains the quickest race-time option through the mixed conditions.`
      : `${currentCompound} remains the quickest race-time option on the dry surface.`;
  }
  if (bestCompound === "WET") {
    return `Heavy standing water is sustained long enough for WET tyres to recover the ${pitLoss.toFixed(1)}s pit loss.`;
  }
  if (bestCompound === "INTERMEDIATE") {
    return `Moderate water is expected for ${expectedWetLaps.toFixed(1)} laps, putting INTERMEDIATE tyres beyond crossover.`;
  }
  if (currentCompound === "INTERMEDIATE" || currentCompound === "WET") {
    return `The drying line is established (${Math.round((1 - averageWater) * 100)}% dry), so ${bestCompound} is beyond crossover.`;
  }
  return `${bestCompound} has the lowest projected Silverstone race time after pit loss.`;
}

/**
 * Compares the fitted tyre with every available tyre over 48 Silverstone
 * telemetry zones and the supplied spatial-weather forecast. Positive gain
 * values mean the best tyre is faster than staying on the current compound.
 */
export function estimateTyreCrossover(input: TyreCrossoverInput): TyreCrossoverEstimate {
  const remainingLaps = Math.max(0, Math.floor(input.remainingLaps));
  const pitLossSeconds = Math.max(0, input.pitLossSeconds ?? 23);
  const compounds = orderedCompounds(input.currentCompound, input.availableCompounds);
  const waterNow = currentZoneWater(input.weather);
  const currentLapSeconds = lapSeconds(input.currentCompound, waterNow, 0);
  const representativeLaps = Math.max(1, remainingLaps);
  const projectedWaters = Array.from({ length: representativeLaps }, (_, lapIndex) => {
    const minutesAhead = remainingLaps === 0 ? 0 : ((lapIndex + 0.5) * currentLapSeconds) / 60;
    return projectedZoneWater(input.weather, waterNow, minutesAhead);
  });
  const expectedWetLaps = remainingLaps === 0
    ? 0
    : projectedWaters.reduce((total, waters) => total + wetLapFraction(waters), 0);

  const estimates = compounds.map((compound) => {
    const lapTimes = projectedWaters.map((waters, lapIndex) => lapSeconds(compound, waters, lapIndex));
    const projectedRaceSeconds = remainingLaps === 0
      ? 0
      : lapTimes.reduce((total, seconds) => total + seconds, 0);
    return {
      compound,
      currentLapSeconds: lapSeconds(compound, waterNow, 0),
      projectedRaceSeconds,
      averageLapSeconds: remainingLaps === 0 ? lapSeconds(compound, waterNow, 0) : projectedRaceSeconds / remainingLaps,
    } satisfies TyreCompoundCrossoverEstimate;
  }).sort((left, right) =>
    left.projectedRaceSeconds - right.projectedRaceSeconds
    || ALL_COMPOUNDS.indexOf(left.compound) - ALL_COMPOUNDS.indexOf(right.compound),
  );

  const currentEstimate = estimates.find((estimate) => estimate.compound === input.currentCompound)!;
  const bestEstimate = estimates[0];
  const bestCompound = bestEstimate.compound;
  const switchedCompound = bestCompound !== input.currentCompound;
  const grossRaceGainSeconds = Math.max(0, currentEstimate.projectedRaceSeconds - bestEstimate.projectedRaceSeconds);
  const netRaceGainSeconds = switchedCompound ? grossRaceGainSeconds - pitLossSeconds : 0;
  const shouldPit = remainingLaps > 0 && switchedCompound && netRaceGainSeconds > 0.75;
  const recommendedCompound = shouldPit ? bestCompound : input.currentCompound;
  const lapGains = projectedWaters.map((waters, lapIndex) =>
    lapSeconds(input.currentCompound, waters, lapIndex) - lapSeconds(bestCompound, waters, lapIndex),
  );
  const gainLow = switchedCompound ? Math.min(...lapGains) : 0;
  const gainHigh = switchedCompound ? Math.max(...lapGains) : 0;
  const secondBest = estimates[1];
  const rankingMargin = secondBest
    ? Math.abs(secondBest.projectedRaceSeconds - bestEstimate.projectedRaceSeconds) / representativeLaps
    : 0;
  const surfaceCoverage = Math.min(1, (input.weather.surfaceZones?.length ?? 0) / ZONE_COUNT);
  const forecastCoverage = input.weather.forecast && input.weather.forecast.length >= 3 ? 1 : input.weather.forecast?.length ? 0.65 : 0.25;
  const confidence = clamp01(0.38 + surfaceCoverage * 0.24 + forecastCoverage * 0.18 + Math.min(0.16, rankingMargin * 0.035));

  return {
    currentCompound: input.currentCompound,
    bestCompound,
    recommendedCompound,
    shouldPit,
    currentLapSeconds: round(currentLapSeconds),
    bestLapSeconds: round(bestEstimate.currentLapSeconds),
    gainRangePerLapSeconds: { low: round(gainLow), high: round(gainHigh) },
    expectedWetLaps: round(expectedWetLaps, 2),
    grossRaceGainSeconds: round(grossRaceGainSeconds),
    netRaceGainSeconds: round(netRaceGainSeconds),
    pitLossSeconds: round(pitLossSeconds),
    confidence: round(confidence),
    reason: recommendationReason(bestCompound, input.currentCompound, shouldPit, expectedWetLaps, grossRaceGainSeconds, pitLossSeconds, waterNow),
    zonesEvaluated: ZONE_COUNT,
    compounds: estimates.map((estimate) => ({
      ...estimate,
      currentLapSeconds: round(estimate.currentLapSeconds),
      projectedRaceSeconds: round(estimate.projectedRaceSeconds),
      averageLapSeconds: round(estimate.averageLapSeconds),
    })),
  };
}
