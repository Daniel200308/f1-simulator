import type { RaceControlStatus, TyreCompound, TyreSetState, WeatherState } from "@/domain/race";

export type RaceStrategyPlanId = "A" | "B" | "C";
export type RaceStrategyPlanRisk = "LOW" | "MEDIUM" | "HIGH";

export interface RaceStrategyPlanStint {
  startLap: number;
  endLap: number;
  compound: TyreCompound;
  pitAtEnd: boolean;
  projectedLifeAtEnd: number;
}

export interface RaceStrategyPlan {
  id: RaceStrategyPlanId;
  name: string;
  stopCount: number;
  stints: readonly RaceStrategyPlanStint[];
  projectedDeltaSeconds: number;
  risk: RaceStrategyPlanRisk;
  rationale: string;
  recommended: boolean;
}

export interface RaceStrategyPlanContext {
  currentLap: number;
  totalLaps: number;
  tyreCompound: TyreCompound;
  tyreLife: number;
  tyreAgeLaps: number;
  tyreSets: readonly TyreSetState[];
  weather: WeatherState;
  raceControl: RaceControlStatus;
}

interface PlannedStop {
  lap: number;
  compound: TyreCompound;
}

interface CandidatePlan {
  name: string;
  stops: readonly PlannedStop[];
  rationale: string;
}

const WEAR_PER_LAP: Readonly<Record<TyreCompound, number>> = {
  SOFT: 4.15,
  MEDIUM: 3.1,
  HARD: 2.35,
  INTERMEDIATE: 3.35,
  WET: 2.85,
};

const DRY_PACE_DELTA: Readonly<Record<TyreCompound, number>> = {
  SOFT: -0.13,
  MEDIUM: 0,
  HARD: 0.16,
  INTERMEDIATE: 2.8,
  WET: 4.6,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function wetCompound(weather: WeatherState): TyreCompound | null {
  const standingWater = Math.max(0, ...(weather.surfaceZones?.map((zone) => zone.standingWater) ?? [0]));
  if (weather.trackWetness >= 0.66 || standingWater >= 0.16 || weather.condition === "HEAVY_RAIN") return "WET";
  if (weather.trackWetness >= 0.17 || weather.rainIntensity >= 0.14 || weather.condition === "LIGHT_RAIN") return "INTERMEDIATE";
  return null;
}

function setAvailable(sets: readonly TyreSetState[], compound: TyreCompound): boolean {
  return sets.some((set) => set.compound === compound && (set.status === "AVAILABLE" || set.status === "USED" || set.status === "RESERVED" || set.status === "FITTED"));
}

function availableCompound(sets: readonly TyreSetState[], preferred: TyreCompound, fallbacks: readonly TyreCompound[]): TyreCompound {
  return [preferred, ...fallbacks].find((compound) => setAvailable(sets, compound)) ?? preferred;
}

function availableDifferentDryCompound(sets: readonly TyreSetState[], preferred: TyreCompound, excluded: TyreCompound): TyreCompound {
  const dryCompounds: readonly TyreCompound[] = [preferred, "SOFT", "MEDIUM", "HARD"];
  return dryCompounds.find((compound) => compound !== excluded && setAvailable(sets, compound))
    ?? dryCompounds.find((compound) => compound !== excluded)
    ?? preferred;
}

function usableLaps(compound: TyreCompound, life = 100): number {
  return Math.max(1, Math.floor((life - 18) / WEAR_PER_LAP[compound]));
}

function normaliseStops(context: RaceStrategyPlanContext, stops: readonly PlannedStop[]): readonly PlannedStop[] {
  if (context.currentLap >= context.totalLaps) return [];
  const used = new Set<number>();
  return [...stops]
    .map((stop) => ({ ...stop, lap: Math.round(clamp(stop.lap, context.currentLap, context.totalLaps - 1)) }))
    .sort((left, right) => left.lap - right.lap)
    .filter((stop) => {
      if (used.has(stop.lap)) return false;
      used.add(stop.lap);
      return true;
    });
}

function stintsFor(context: RaceStrategyPlanContext, candidate: CandidatePlan): readonly RaceStrategyPlanStint[] {
  const stops = normaliseStops(context, candidate.stops);
  const stints: RaceStrategyPlanStint[] = [];
  let startLap = context.currentLap;
  let compound = context.tyreCompound;
  let life = context.tyreLife;

  for (const stop of stops) {
    const endLap = Math.max(startLap, stop.lap);
    const laps = endLap - startLap + 1;
    stints.push({
      startLap,
      endLap,
      compound,
      pitAtEnd: true,
      projectedLifeAtEnd: round(clamp(life - laps * WEAR_PER_LAP[compound], 0, 100), 0),
    });
    startLap = endLap + 1;
    compound = stop.compound;
    life = 100;
  }

  if (startLap <= context.totalLaps) {
    const laps = context.totalLaps - startLap + 1;
    stints.push({
      startLap,
      endLap: context.totalLaps,
      compound,
      pitAtEnd: false,
      projectedLifeAtEnd: round(clamp(life - laps * WEAR_PER_LAP[compound], 0, 100), 0),
    });
  }
  return stints;
}

function scorePlan(context: RaceStrategyPlanContext, stints: readonly RaceStrategyPlanStint[]): { score: number; risk: RaceStrategyPlanRisk } {
  const wet = wetCompound(context.weather);
  const pitLoss = context.raceControl === "SAFETY_CAR" ? 9.6 : context.raceControl === "VSC" ? 13.4 : 20.6;
  let score = Math.max(0, stints.length - 1) * pitLoss;
  let maximumWearOverflow = 0;

  stints.forEach((stint, index) => {
    const laps = stint.endLap - stint.startLap + 1;
    const startingLife = index === 0 ? context.tyreLife : 100;
    const capacity = usableLaps(stint.compound, startingLife);
    const overflow = Math.max(0, laps - capacity);
    maximumWearOverflow = Math.max(maximumWearOverflow, overflow);
    score += overflow * overflow * 1.45;
    if (wet) {
      score += stint.compound === wet ? 0 : laps * (stint.compound === "INTERMEDIATE" || stint.compound === "WET" ? 0.65 : 3.2);
    } else {
      score += laps * DRY_PACE_DELTA[stint.compound];
    }
  });

  if (context.raceControl === "SAFETY_CAR" && stints[0]?.pitAtEnd) score -= 4.8;
  if (context.raceControl === "VSC" && stints[0]?.pitAtEnd) score -= 2.6;
  const lowestLife = Math.min(...stints.map((stint) => stint.projectedLifeAtEnd));
  if (lowestLife <= 5) score += 18;
  else if (lowestLife <= 12) score += 7;
  const risk: RaceStrategyPlanRisk = maximumWearOverflow >= 5 || lowestLife <= 5
    ? "HIGH"
    : maximumWearOverflow >= 1 || lowestLife <= 20 ? "MEDIUM" : "LOW";
  return { score: round(score, 3), risk };
}

function candidatesFor(context: RaceStrategyPlanContext): readonly CandidatePlan[] {
  const remainingLaps = Math.max(1, context.totalLaps - context.currentLap + 1);
  const wet = wetCompound(context.weather);
  const currentCapacity = usableLaps(context.tyreCompound, context.tyreLife);
  const naturalStop = clamp(context.currentLap + Math.max(1, currentCapacity - 1), context.currentLap, context.totalLaps - 1);
  const immediateStop = Math.min(context.totalLaps - 1, context.currentLap + (context.raceControl === "GREEN" ? 1 : 0));

  if (wet) {
    const wetTarget = availableCompound(context.tyreSets, wet, ["INTERMEDIATE", "WET"]);
    const forecastDry = context.weather.forecast?.slice(-2).some((point) => point.rainProbability < 0.25 && point.condition !== "LIGHT_RAIN" && point.condition !== "HEAVY_RAIN") ?? false;
    const dryTarget = availableCompound(context.tyreSets, "MEDIUM", ["HARD", "SOFT"]);
    const crossoverBackLap = Math.min(context.totalLaps - 1, context.currentLap + Math.max(7, Math.round(remainingLaps * 0.42)));
    return [
      {
        name: forecastDry ? "CROSSOVER CONTROL" : "RAIN CONTROL",
        stops: [{ lap: immediateStop, compound: wetTarget }, ...(forecastDry ? [{ lap: crossoverBackLap, compound: dryTarget }] : [])],
        rationale: forecastDry ? "Cover the wet crossover now, then return to slicks when the drying trend is established." : "Take the weather tyre at the first safe window and protect the car to the flag.",
      },
      {
        name: "EARLY WEATHER COVER",
        stops: [{ lap: context.currentLap, compound: wetTarget }, ...(remainingLaps > 20 ? [{ lap: Math.min(context.totalLaps - 1, context.currentLap + Math.round(remainingLaps * 0.55)), compound: wetTarget }] : [])],
        rationale: "Prioritise grip immediately and retain a second weather stop if degradation or rain intensity changes.",
      },
      {
        name: "DELAYED CROSSOVER",
        stops: [{ lap: Math.min(context.totalLaps - 1, immediateStop + 2), compound: wetTarget }],
        rationale: "Hold track position briefly and switch only after the wet line and radar confirm the crossover.",
      },
    ];
  }

  if (remainingLaps <= currentCapacity) {
    const lateSoft = availableCompound(context.tyreSets, "SOFT", ["MEDIUM", "HARD"]);
    return [
      { name: "NO-STOP CONTROL", stops: [], rationale: "The fitted tyre can reach the flag inside the projected life margin." },
      { name: "LATE ATTACK", stops: [{ lap: Math.max(context.currentLap, context.totalLaps - 10), compound: lateSoft }], rationale: "Trade one stop for a short final stint with maximum lap-time potential." },
      { name: "SAFETY WINDOW", stops: [{ lap: Math.max(context.currentLap, context.totalLaps - 15), compound: availableCompound(context.tyreSets, "MEDIUM", ["HARD", "SOFT"]) }], rationale: "Keep a conservative fallback if tyre life or Race Control changes before the flag." },
    ];
  }

  const finishLaps = context.totalLaps - naturalStop;
  const finishCompound = availableDifferentDryCompound(
    context.tyreSets,
    finishLaps > 23 ? "HARD" : finishLaps > 12 ? "MEDIUM" : "SOFT",
    context.tyreCompound,
  );
  const secondStopNeeded = finishLaps > usableLaps(finishCompound);
  const secondStopLap = Math.min(context.totalLaps - 1, naturalStop + Math.max(8, usableLaps(finishCompound) - 2));
  const finalSprint = availableCompound(context.tyreSets, context.totalLaps - secondStopLap <= 12 ? "SOFT" : "MEDIUM", ["MEDIUM", "HARD", "SOFT"]);
  const aggressiveFirstLap = Math.min(context.totalLaps - 2, context.currentLap + Math.max(3, Math.round(remainingLaps * 0.28)));
  const aggressiveSecondLap = Math.min(context.totalLaps - 1, context.currentLap + Math.max(9, Math.round(remainingLaps * 0.66)));
  const aggressiveMiddle = availableDifferentDryCompound(
    context.tyreSets,
    context.tyreCompound === "HARD" ? "MEDIUM" : "HARD",
    context.tyreCompound,
  );
  const aggressiveFinish = availableDifferentDryCompound(
    context.tyreSets,
    context.totalLaps - aggressiveSecondLap <= 13 ? "SOFT" : "MEDIUM",
    aggressiveMiddle,
  );
  const extendLap = Math.min(context.totalLaps - 1, naturalStop + Math.min(5, Math.max(2, Math.round(remainingLaps * 0.08))));

  return [
    {
      name: secondStopNeeded ? "BALANCED TWO-STOP" : "BALANCED ONE-STOP",
      stops: [{ lap: naturalStop, compound: finishCompound }, ...(secondStopNeeded ? [{ lap: secondStopLap, compound: finalSprint }] : [])],
      rationale: "Use the measured tyre-life window and minimise time spent below the performance threshold.",
    },
    {
      name: "ATTACK TWO-STOP",
      stops: [{ lap: aggressiveFirstLap, compound: aggressiveMiddle }, { lap: aggressiveSecondLap, compound: aggressiveFinish }],
      rationale: "Create two shorter stints for undercut potential and a faster final compound.",
    },
    {
      name: "LONG-STINT ONE-STOP",
      stops: [{ lap: extendLap, compound: availableDifferentDryCompound(context.tyreSets, "HARD", context.tyreCompound) }],
      rationale: "Extend the opening stint to protect track position, then use the most durable available set.",
    },
  ];
}

/** Builds three deterministic, live full-race tyre plans and ranks the quickest as Plan A. */
export function buildRaceStrategyPlans(context: RaceStrategyPlanContext): readonly RaceStrategyPlan[] {
  const scored = candidatesFor(context).map((candidate) => {
    const stints = stintsFor(context, candidate);
    const assessment = scorePlan(context, stints);
    return { candidate, stints, ...assessment };
  }).sort((left, right) => left.score - right.score || left.candidate.name.localeCompare(right.candidate.name));
  const bestScore = scored[0]?.score ?? 0;
  const ids: readonly RaceStrategyPlanId[] = ["A", "B", "C"];
  return scored.map((entry, index) => ({
    id: ids[index],
    name: entry.candidate.name,
    stopCount: Math.max(0, entry.stints.length - 1),
    stints: entry.stints,
    projectedDeltaSeconds: round(entry.score - bestScore),
    risk: entry.risk,
    rationale: entry.candidate.rationale,
    recommended: index === 0,
  }));
}
