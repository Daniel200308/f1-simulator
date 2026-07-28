import type { TyreCompound, WeatherState, WeekendTyreUsage } from "@/domain/race";
import { DRIVER_BY_ID } from "@/fixtures/grid";
import { FIA_2026_STANDARD_TYRE_ALLOCATION, remainingWeekendTyreUses } from "@/simulation/tyre-allocation";

export type RaceStartDoctrine = "ATTACK" | "BALANCED" | "LONG_STINT" | "SPLIT_COVERAGE";

export interface RaceStartingTyreDecision {
  carId: string;
  compound: TyreCompound;
  doctrine: RaceStartDoctrine;
  projectedStintLaps: readonly [number, number];
  rationale: string;
}

export interface RaceStartingTyrePlanInput {
  seed: number;
  gridOrder: readonly string[];
  tyreUsage?: WeekendTyreUsage;
  weather: WeatherState;
  playerOverrides?: Readonly<Record<string, TyreCompound | undefined>>;
}

type DryCompound = "SOFT" | "MEDIUM" | "HARD";
const DRY_COMPOUNDS: readonly DryCompound[] = ["SOFT", "MEDIUM", "HARD"];

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return hash >>> 0;
}

function noise(seed: number, key: string): number {
  let value = (seed ^ hashText(key)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) / 0xffff_ffff) * 2 - 1;
}

function doctrineFor(seed: number, teamId: string): RaceStartDoctrine {
  const doctrines: readonly RaceStartDoctrine[] = ["ATTACK", "BALANCED", "LONG_STINT", "SPLIT_COVERAGE"];
  return doctrines[(hashText(teamId) + (seed >>> 5)) % doctrines.length];
}

function hasFreshSet(carId: string, compound: TyreCompound, tyreUsage?: WeekendTyreUsage): boolean {
  return remainingWeekendTyreUses(carId, compound, tyreUsage) > 0;
}

function rainSoon(weather: WeatherState): boolean {
  return (weather.forecastRainInMinutes !== null && weather.forecastRainInMinutes <= 12)
    || (weather.forecast?.some((point) => point.minutesAhead <= 10 && point.rainProbability * point.rainIntensity >= 0.22) ?? false);
}

function wetStartCompound(weather: WeatherState): TyreCompound | null {
  const standingWater = weather.surfaceZones?.reduce((total, zone) => total + zone.standingWater, 0) ?? 0;
  const averageStandingWater = standingWater / Math.max(1, weather.surfaceZones?.length ?? 0);
  if (weather.trackWetness >= 0.58 || weather.rainIntensity >= 0.68 || averageStandingWater >= 0.2) return "WET";
  if (weather.trackWetness >= 0.13 || weather.rainIntensity >= 0.12 || averageStandingWater >= 0.035) return "INTERMEDIATE";
  return null;
}

function projectedStint(compound: TyreCompound, doctrine: RaceStartDoctrine): readonly [number, number] {
  const doctrineOffset = doctrine === "LONG_STINT" ? 3 : doctrine === "ATTACK" ? -2 : 0;
  if (compound === "SOFT") return [Math.max(9, 13 + doctrineOffset), Math.max(14, 18 + doctrineOffset)];
  if (compound === "MEDIUM") return [19 + doctrineOffset, 27 + doctrineOffset];
  if (compound === "HARD") return [27 + doctrineOffset, 38 + doctrineOffset];
  if (compound === "INTERMEDIATE") return [10, 24];
  return [12, 28];
}

function rationaleFor(compound: TyreCompound, doctrine: RaceStartDoctrine, position: number, imminentRain: boolean): string {
  if (compound === "WET") return "Standing water start · full-wet evacuation window";
  if (compound === "INTERMEDIATE") return "Wet crossover start · protect the opening laps";
  if (imminentRain) return `${compound === "SOFT" ? "Short" : "Flexible"} bridge stint before the rain window`;
  if (doctrine === "ATTACK") return position <= 10 ? "Track-position attack from the start" : "Early undercut pressure from the midfield";
  if (doctrine === "LONG_STINT") return "Extend the first stint and open the pit window";
  if (doctrine === "SPLIT_COVERAGE") return "Split the team strategy across the opening stint";
  return "Balanced degradation and pit-window coverage";
}

function selectDryCompound(input: RaceStartingTyrePlanInput, carId: string, position: number, doctrine: RaceStartDoctrine, teamSlot: number): TyreCompound {
  const imminentRain = rainSoon(input.weather);
  const scores: Record<"SOFT" | "MEDIUM" | "HARD", number> = {
    SOFT: position <= 6 ? 3.1 : position <= 15 ? 1.1 : -0.8,
    MEDIUM: 4.8,
    HARD: position <= 6 ? 0.7 : position <= 15 ? 3.1 : 4.4,
  };

  if (doctrine === "ATTACK") { scores.SOFT += 4.2; scores.MEDIUM += 1; scores.HARD -= 1.8; }
  if (doctrine === "BALANCED") { scores.MEDIUM += 4.5; scores.HARD += 1; }
  if (doctrine === "LONG_STINT") { scores.HARD += 4.8; scores.MEDIUM += 1.8; scores.SOFT -= 2.2; }
  if (doctrine === "SPLIT_COVERAGE") {
    if (teamSlot === 0) { scores.MEDIUM += 6.5; scores.HARD -= 1; scores.SOFT += position <= 10 ? 1.2 : 0; }
    else { scores.HARD += 7.2; scores.MEDIUM -= 1; scores.SOFT += position >= 16 ? 1.1 : 0; }
  }
  if (imminentRain) { scores.SOFT += 3.1; scores.MEDIUM += 1.5; scores.HARD -= 5; }

  DRY_COMPOUNDS.forEach((compound) => {
    scores[compound] += noise(input.seed, `${carId}:${compound}:start`) * 0.7;
    // A scrubbed qualifying set remains legal for the race. The AI prefers a
    // fresh set, but it never removes a compound merely because every set has run.
    if (!hasFreshSet(carId, compound, input.tyreUsage)) scores[compound] -= 1.4;
  });

  return [...DRY_COMPOUNDS].sort((a, b) => scores[b] - scores[a] || DRY_COMPOUNDS.indexOf(a) - DRY_COMPOUNDS.indexOf(b))[0];
}

export function buildRaceStartingTyrePlan(input: RaceStartingTyrePlanInput): Readonly<Record<string, RaceStartingTyreDecision>> {
  const teamCars = new Map<string, string[]>();
  input.gridOrder.forEach((carId) => {
    const teamId = DRIVER_BY_ID.get(carId)?.teamId;
    if (!teamId) return;
    teamCars.set(teamId, [...(teamCars.get(teamId) ?? []), carId]);
  });
  const wetTarget = wetStartCompound(input.weather);

  return Object.fromEntries(input.gridOrder.map((carId, index) => {
    const driver = DRIVER_BY_ID.get(carId);
    if (!driver) throw new RangeError(`Unknown starting-grid car: ${carId}`);
    const position = index + 1;
    const doctrine = doctrineFor(input.seed, driver.teamId);
    const teamSlot = Math.max(0, (teamCars.get(driver.teamId) ?? []).indexOf(carId));
    const override = input.playerOverrides?.[carId];
    let compound = override;
    if (!compound) {
      const wetCandidate = wetTarget;
      compound = wetCandidate ?? selectDryCompound(input, carId, position, doctrine, teamSlot);
    }
    const stint = projectedStint(compound, doctrine);
    return [carId, {
      carId,
      compound,
      doctrine,
      projectedStintLaps: stint,
      rationale: override
        ? `Player override · AI doctrine ${doctrine.replaceAll("_", " ").toLowerCase()}`
        : rationaleFor(compound, doctrine, position, rainSoon(input.weather)),
    } satisfies RaceStartingTyreDecision];
  }));
}

export function freshRaceStartSets(carId: string, tyreUsage?: WeekendTyreUsage): Readonly<Record<TyreCompound, number>> {
  return Object.fromEntries((Object.keys(FIA_2026_STANDARD_TYRE_ALLOCATION) as TyreCompound[]).map((compound) => [compound, remainingWeekendTyreUses(carId, compound, tyreUsage)])) as Readonly<Record<TyreCompound, number>>;
}
