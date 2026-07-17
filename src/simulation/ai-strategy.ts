import type { RaceCarState, RaceControlStatus, StrategyIntent, TyreCompound, WeatherState } from "@/domain/race";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { estimateTyreCrossover } from "@/simulation/tyre-crossover";

const DRY_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD"];

interface WeatherSurfaceSignal {
  strategicWetness: number;
  wetCoverage: number;
  heavyCoverage: number;
  standingWater: number;
  dryingLine: number;
  sustainedForecastRain: boolean;
}

export interface AiStrategyContext {
  trackWetness: number;
  weather?: WeatherState;
  raceControl: RaceControlStatus;
  pitLaneOpen: boolean;
  cars: readonly RaceCarState[];
}

export interface AiStrategyDecision {
  pitNow: boolean;
  compound: TyreCompound | null;
  intent: StrategyIntent;
  confidence: number;
  score: number;
}

function teamAggression(teamId: string): number {
  let hash = 0;
  for (const character of teamId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % 5 - 2) / 2;
}

type StrategyArchetype = "AGGRESSIVE" | "BALANCED" | "EXTENDER" | "OPPORTUNIST";

interface StrategyPersonality {
  archetype: StrategyArchetype;
  tyreTriggerOffset: number;
  undercutBias: number;
  overcutBias: number;
  compoundBias: Readonly<Record<"SOFT" | "MEDIUM" | "HARD", number>>;
}

function strategyPersonality(car: RaceCarState): StrategyPersonality {
  let hash = 2_166_136_261;
  for (const character of `${car.teamId}:${car.driverId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  const archetypes: readonly StrategyArchetype[] = ["AGGRESSIVE", "BALANCED", "EXTENDER", "OPPORTUNIST"];
  const archetype = archetypes[(hash >>> 0) % archetypes.length];
  const driverStagger = ((hash >>> 5) % 7) - 3;
  if (archetype === "AGGRESSIVE") return { archetype, tyreTriggerOffset: 9 + driverStagger, undercutBias: 8, overcutBias: -3, compoundBias: { SOFT: 8, MEDIUM: 3, HARD: -3 } };
  if (archetype === "EXTENDER") return { archetype, tyreTriggerOffset: -8 + driverStagger, undercutBias: -4, overcutBias: 8, compoundBias: { SOFT: -7, MEDIUM: 2, HARD: 9 } };
  if (archetype === "OPPORTUNIST") return { archetype, tyreTriggerOffset: driverStagger, undercutBias: 5, overcutBias: 4, compoundBias: { SOFT: 2, MEDIUM: 7, HARD: 1 } };
  return { archetype, tyreTriggerOffset: 2 + driverStagger, undercutBias: 2, overcutBias: 1, compoundBias: { SOFT: 1, MEDIUM: 5, HARD: 3 } };
}

function availableCompounds(car: RaceCarState): TyreCompound[] {
  return [...new Set(car.tyreSets.filter((set) => set.status === "AVAILABLE").map((set) => set.compound))];
}

function weatherSurfaceSignal(context: AiStrategyContext): WeatherSurfaceSignal {
  const zones = context.weather?.surfaceZones ?? [];
  const forecastWindow = context.weather?.forecast?.filter((point) => point.minutesAhead <= 5) ?? [];
  const sustainedForecastRain = forecastWindow.length >= 2
    && forecastWindow.reduce((total, point) => total + point.rainIntensity * point.rainProbability, 0) / forecastWindow.length >= 0.2;
  if (zones.length === 0) {
    return {
      strategicWetness: context.trackWetness,
      wetCoverage: context.trackWetness >= 0.12 ? 1 : 0,
      heavyCoverage: context.trackWetness >= 0.55 ? 1 : 0,
      standingWater: 0,
      dryingLine: Math.max(0, 1 - context.trackWetness),
      sustainedForecastRain,
    };
  }

  const water = zones.map((zone) => Math.max(0, Math.min(1,
    zone.wetness * (1 - zone.dryingLine * 0.28) + zone.standingWater * 0.55 + zone.rainIntensity * 0.08,
  )));
  const average = water.reduce((total, value) => total + value, 0) / water.length;
  return {
    strategicWetness: Math.max(context.trackWetness * 0.35 + average * 0.65, average),
    wetCoverage: water.filter((value) => value >= 0.12).length / water.length,
    heavyCoverage: water.filter((value) => value >= 0.52).length / water.length,
    standingWater: zones.reduce((total, zone) => total + zone.standingWater, 0) / zones.length,
    dryingLine: zones.reduce((total, zone) => total + zone.dryingLine, 0) / zones.length,
    sustainedForecastRain,
  };
}

function compoundScore(compound: TyreCompound, remainingLaps: number, wetness: number, aggression: number): number {
  if (wetness >= 0.58) return compound === "WET" ? 40 : compound === "INTERMEDIATE" ? 12 : -45;
  if (wetness >= 0.16) return compound === "INTERMEDIATE" ? 38 : compound === "WET" ? 18 : -32;
  if (!DRY_COMPOUNDS.includes(compound)) return -40;
  if (compound === "SOFT") return (remainingLaps <= 16 ? 24 : remainingLaps <= 23 ? 10 : -8) + aggression * 5;
  if (compound === "MEDIUM") return (remainingLaps <= 30 ? 22 : 10) + aggression;
  return (remainingLaps > 24 ? 24 : 13) - aggression * 3;
}

export function buildAiStrategyDecision(context: AiStrategyContext, car: RaceCarState): AiStrategyDecision {
  const aggression = teamAggression(car.teamId);
  const personality = strategyPersonality(car);
  const remainingLaps = car.finished ? 0 : Math.max(0, SILVERSTONE_CIRCUIT.totalLaps - car.currentLap + 1);
  const compounds = availableCompounds(car);
  const teammate = context.cars.find((candidate) => candidate.carId !== car.carId && candidate.teamId === car.teamId);
  const doubleStackRisk = Boolean(teammate?.scheduledPitCompound || teammate?.pitStatus === "PIT_LANE" || teammate?.pitStatus === "PIT_STOP");
  const cheapStop = context.raceControl === "SAFETY_CAR" || context.raceControl === "VSC";
  const undercut = car.gapToCarAhead > 0.3 && car.gapToCarAhead < 2.4;
  const overcutWindow = car.gapToCarAhead > 0.4 && car.gapToCarAhead < 3.2 && car.tyreLife > 45;
  const surface = weatherSurfaceSignal(context);
  const wetTyreFitted = car.tyreCompound === "INTERMEDIATE" || car.tyreCompound === "WET";
  const crossover = context.weather ? estimateTyreCrossover({
    weather: context.weather,
    currentCompound: car.tyreCompound,
    availableCompounds: compounds,
    remainingLaps,
    pitLossSeconds: context.raceControl === "SAFETY_CAR" ? 11.8 : context.raceControl === "VSC" ? 15.6 : 23,
  }) : null;
  const stableDrySurface = surface.strategicWetness <= 0.075
    && surface.wetCoverage < 0.16
    && surface.dryingLine >= 0.68
    && !surface.sustainedForecastRain
    && (context.weather?.rainIntensity ?? 0) < 0.035;
  const reactiveWetTarget: TyreCompound | null = surface.heavyCoverage >= 0.38
      && (surface.strategicWetness >= 0.46 || surface.standingWater >= 0.16)
    ? "WET"
    : surface.wetCoverage >= 0.4
        && (surface.strategicWetness >= 0.12 || surface.sustainedForecastRain)
      ? "INTERMEDIATE"
      : wetTyreFitted && stableDrySurface
        ? "MEDIUM"
        : null;
  const crossoverTarget = crossover?.shouldPit ? crossover.recommendedCompound : null;
  const crossoverIsSafe = crossoverTarget === null || !DRY_COMPOUNDS.includes(crossoverTarget) || stableDrySurface;
  const wetTarget: TyreCompound | null = reactiveWetTarget ?? (crossoverIsSafe ? crossoverTarget : null);
  const weatherMismatch = wetTarget !== null && wetTarget !== car.tyreCompound;
  const weatherTransition = weatherMismatch && (
    wetTarget === "INTERMEDIATE"
      || wetTarget === "WET"
      || car.tyreCompound === "INTERMEDIATE"
      || car.tyreCompound === "WET"
  );
  const weatherEmergency = !wetTyreFitted
    && (surface.heavyCoverage >= 0.48 || surface.wetCoverage >= 0.72)
    && surface.strategicWetness >= 0.24;
  const weatherTransitionReady = weatherTransition
    && (weatherEmergency || car.pitStops === 0 || car.tyreAgeLaps >= 1.5);
  const threshold = 43
    + personality.tyreTriggerOffset
    + aggression * 3
    + (undercut ? personality.undercutBias : 0)
    + (cheapStop ? 20 : 0)
    - (doubleStackRisk ? personality.archetype === "OPPORTUNIST" ? 5 : 11 : 0);
  const tyreCritical = car.tyreLife <= 35;
  const prematureDryStop = context.trackWetness < 0.16
    && car.currentLap <= 3
    && car.tyreAgeLaps < 3
    && car.tyreLife > 80
    && !cheapStop
    && !weatherTransition;
  const shouldPit = context.pitLaneOpen
    && car.pitStatus === "TRACK"
    && compounds.length > 0
    && car.currentLap < SILVERSTONE_CIRCUIT.totalLaps
    && !prematureDryStop
    && (weatherTransitionReady || !weatherTransition && (tyreCritical || car.tyreLife <= threshold));

  const ranked = compounds
    .map((compound) => {
      const freshest = Math.max(...car.tyreSets.filter((set) => set.status === "AVAILABLE" && set.compound === compound).map((set) => set.condition));
      const switchingBonus = wetTarget === compound ? (crossover ? 90 : 18) : 0;
      const repeatPenalty = compound === car.tyreCompound && car.tyreLife > 35 ? 16 : 0;
      const dryPersonalityBias = DRY_COMPOUNDS.includes(compound) ? personality.compoundBias[compound as "SOFT" | "MEDIUM" | "HARD"] : 0;
      return { compound, score: compoundScore(compound, remainingLaps, surface.strategicWetness, aggression) + freshest * 0.08 + switchingBonus + dryPersonalityBias - repeatPenalty };
    })
    .sort((a, b) => b.score - a.score || a.compound.localeCompare(b.compound));
  const best = ranked[0] ?? null;
  const intent: StrategyIntent = weatherTransition
    ? "WEATHER"
    : cheapStop && shouldPit
      ? "CHEAP_STOP"
      : tyreCritical
        ? "TYRE_LIMIT"
        : undercut && shouldPit
          ? "UNDERCUT"
          : personality.overcutBias > personality.undercutBias && overcutWindow && car.tyreLife > threshold + 5
            ? "OVERCUT"
            : car.tyreLife > threshold + 12 ? "EXTEND" : "HOLD";
  const margin = best && ranked[1] ? best.score - ranked[1].score : best ? 12 : 0;
  const modelConfidence = crossover && weatherTransition ? crossover.confidence : 0;
  const confidence = Math.max(0.35, Math.min(0.96, 0.52 + margin * 0.018 + (weatherTransition ? 0.16 : 0) + modelConfidence * 0.08 - (doubleStackRisk ? 0.12 : 0)));
  const pitNow = shouldPit && Boolean(best) && (best?.compound !== car.tyreCompound || tyreCritical);
  return { pitNow, compound: pitNow ? best?.compound ?? null : null, intent, confidence, score: best?.score ?? 0 };
}
