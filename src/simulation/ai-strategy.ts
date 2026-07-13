import type { RaceCarState, RaceControlStatus, StrategyIntent, TyreCompound, WeatherState } from "@/domain/race";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { estimateTyreCrossover } from "@/simulation/tyre-crossover";

const DRY_COMPOUNDS: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD"];

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

function availableCompounds(car: RaceCarState): TyreCompound[] {
  return [...new Set(car.tyreSets.filter((set) => set.status === "AVAILABLE").map((set) => set.compound))];
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
  const remainingLaps = car.finished ? 0 : Math.max(0, SILVERSTONE_CIRCUIT.totalLaps - car.currentLap + 1);
  const compounds = availableCompounds(car);
  const teammate = context.cars.find((candidate) => candidate.carId !== car.carId && candidate.teamId === car.teamId);
  const doubleStackRisk = Boolean(teammate?.scheduledPitCompound || teammate?.pitStatus === "PIT_LANE" || teammate?.pitStatus === "PIT_STOP");
  const cheapStop = context.raceControl === "SAFETY_CAR" || context.raceControl === "VSC";
  const undercut = car.gapToCarAhead > 0.3 && car.gapToCarAhead < 2.4;
  const crossover = context.weather ? estimateTyreCrossover({
    weather: context.weather,
    currentCompound: car.tyreCompound,
    availableCompounds: compounds,
    remainingLaps,
    pitLossSeconds: context.raceControl === "SAFETY_CAR" ? 11.8 : context.raceControl === "VSC" ? 15.6 : 23,
  }) : null;
  const wetTarget: TyreCompound | null = crossover
    ? crossover.shouldPit ? crossover.recommendedCompound : null
    : context.trackWetness >= 0.58
      ? "WET"
      : context.trackWetness >= 0.16
        ? "INTERMEDIATE"
        : car.tyreCompound === "WET" || car.tyreCompound === "INTERMEDIATE" ? "MEDIUM" : null;
  const weatherMismatch = wetTarget !== null && wetTarget !== car.tyreCompound;
  const weatherTransition = weatherMismatch && (
    wetTarget === "INTERMEDIATE"
      || wetTarget === "WET"
      || car.tyreCompound === "INTERMEDIATE"
      || car.tyreCompound === "WET"
  );
  const threshold = 43 + aggression * 4 + (undercut ? 8 : 0) + (cheapStop ? 20 : 0) - (doubleStackRisk ? 9 : 0);
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
    && (weatherTransition || tyreCritical || car.tyreLife <= threshold);

  const ranked = compounds
    .map((compound) => {
      const freshest = Math.max(...car.tyreSets.filter((set) => set.status === "AVAILABLE" && set.compound === compound).map((set) => set.condition));
      const switchingBonus = wetTarget === compound ? (crossover ? 90 : 18) : 0;
      const repeatPenalty = compound === car.tyreCompound && car.tyreLife > 45 ? 3 : 0;
      return { compound, score: compoundScore(compound, remainingLaps, context.trackWetness, aggression) + freshest * 0.08 + switchingBonus - repeatPenalty };
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
          : car.tyreLife > threshold + 12 ? "EXTEND" : "HOLD";
  const margin = best && ranked[1] ? best.score - ranked[1].score : best ? 12 : 0;
  const modelConfidence = crossover && weatherTransition ? crossover.confidence : 0;
  const confidence = Math.max(0.35, Math.min(0.96, 0.52 + margin * 0.018 + (weatherTransition ? 0.16 : 0) + modelConfidence * 0.08 - (doubleStackRisk ? 0.12 : 0)));
  return { pitNow: shouldPit && Boolean(best), compound: shouldPit ? best?.compound ?? null : null, intent, confidence, score: best?.score ?? 0 };
}
