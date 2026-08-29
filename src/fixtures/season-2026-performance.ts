/** Official standings snapshot retained for results/history displays. */
export const F1_2026_PERFORMANCE_SNAPSHOT = {
  asOf: "2026-07-20",
  completedRound: 10,
  sources: {
    drivers: "https://www.formula1.com/en/results/2026/drivers",
    teams: "https://www.formula1.com/en/results/2026/team",
    races: "https://www.formula1.com/en/results/2026/races",
  },
} as const;

export interface SeasonStanding {
  position: number;
  points: number;
}

export type SeasonQualifyingSegment = "Q1" | "Q2" | "Q3";

export interface SeasonDriverStanding extends SeasonStanding {
  carId: string;
  shortName: string;
  teamId: string;
}

export interface SeasonTeamStanding extends SeasonStanding {
  teamId: string;
}

export interface SeasonTeamPowerScaling {
  teamId: string;
  carPower: number;
}

export interface SeasonDriverPowerScaling {
  carId: string;
  shortName: string;
  teamId: string;
  speed: number;
  risk: number;
}

export const F1_2026_DRIVER_STANDINGS: readonly SeasonDriverStanding[] = [
  { position: 1, carId: "mercedes-2", shortName: "ANT", teamId: "mercedes", points: 204 },
  { position: 2, carId: "ferrari-2", shortName: "HAM", teamId: "ferrari", points: 159 },
  { position: 3, carId: "mercedes-1", shortName: "RUS", teamId: "mercedes", points: 154 },
  { position: 4, carId: "ferrari-1", shortName: "LEC", teamId: "ferrari", points: 126 },
  { position: 5, carId: "mclaren-1", shortName: "NOR", teamId: "mclaren", points: 103 },
  { position: 6, carId: "mclaren-2", shortName: "PIA", teamId: "mclaren", points: 92 },
  { position: 7, carId: "red-bull-1", shortName: "VER", teamId: "red-bull", points: 91 },
  { position: 8, carId: "red-bull-2", shortName: "HAD", teamId: "red-bull", points: 60 },
  { position: 9, carId: "alpine-1", shortName: "GAS", teamId: "alpine", points: 42 },
  { position: 10, carId: "racing-bulls-1", shortName: "LAW", teamId: "racing-bulls", points: 39 },
  { position: 11, carId: "racing-bulls-2", shortName: "LIN", teamId: "racing-bulls", points: 22 },
  { position: 12, carId: "alpine-2", shortName: "COL", teamId: "alpine", points: 19 },
  { position: 13, carId: "haas-2", shortName: "BEA", teamId: "haas", points: 18 },
  { position: 14, carId: "audi-2", shortName: "BOR", teamId: "audi", points: 10 },
  { position: 15, carId: "williams-1", shortName: "SAI", teamId: "williams", points: 6 },
  { position: 16, carId: "williams-2", shortName: "ALB", teamId: "williams", points: 5 },
  { position: 17, carId: "haas-1", shortName: "OCO", teamId: "haas", points: 3 },
  { position: 18, carId: "aston-martin-1", shortName: "ALO", teamId: "aston-martin", points: 1 },
  { position: 19, carId: "audi-1", shortName: "HUL", teamId: "audi", points: 0 },
  { position: 20, carId: "cadillac-2", shortName: "BOT", teamId: "cadillac", points: 0 },
  { position: 21, carId: "cadillac-1", shortName: "PER", teamId: "cadillac", points: 0 },
  { position: 22, carId: "aston-martin-2", shortName: "STR", teamId: "aston-martin", points: 0 },
] as const;

export const F1_2026_TEAM_STANDINGS: readonly SeasonTeamStanding[] = [
  { position: 1, teamId: "mercedes", points: 358 },
  { position: 2, teamId: "ferrari", points: 285 },
  { position: 3, teamId: "mclaren", points: 195 },
  { position: 4, teamId: "red-bull", points: 151 },
  { position: 5, teamId: "alpine", points: 61 },
  { position: 6, teamId: "racing-bulls", points: 61 },
  { position: 7, teamId: "haas", points: 21 },
  { position: 8, teamId: "williams", points: 11 },
  { position: 9, teamId: "audi", points: 10 },
  { position: 10, teamId: "aston-martin", points: 1 },
  { position: 11, teamId: "cadillac", points: 0 },
] as const;

/**
 * Gameplay tuning supplied by the user from the GenX V1.41 Barcelona
 * FP1/FP2-based power-scaling sheet. This deliberately stays separate from
 * championship points: points describe outcomes, while this table describes
 * the car, driver speed and mistake propensity the simulation should model.
 */
export const F1_2026_POWER_SCALING_SNAPSHOT = {
  name: "GenX V1.41 + Barcelona FP1/FP2",
  scaleMinimum: 1,
  scaleMaximum: 10,
} as const;

export const F1_2026_TEAM_POWER: readonly SeasonTeamPowerScaling[] = [
  { teamId: "mercedes", carPower: 10 },
  { teamId: "ferrari", carPower: 10 },
  { teamId: "mclaren", carPower: 10 },
  { teamId: "red-bull", carPower: 9 },
  { teamId: "williams", carPower: 8 },
  { teamId: "alpine", carPower: 9 },
  { teamId: "racing-bulls", carPower: 8 },
  { teamId: "audi", carPower: 9 },
  { teamId: "haas", carPower: 7 },
  { teamId: "aston-martin", carPower: 6 },
  { teamId: "cadillac", carPower: 6 },
] as const;

export const F1_2026_DRIVER_POWER: readonly SeasonDriverPowerScaling[] = [
  { carId: "mercedes-1", shortName: "RUS", teamId: "mercedes", speed: 10, risk: 9 },
  { carId: "mercedes-2", shortName: "ANT", teamId: "mercedes", speed: 10, risk: 6 },
  { carId: "ferrari-1", shortName: "LEC", teamId: "ferrari", speed: 9, risk: 9 },
  { carId: "ferrari-2", shortName: "HAM", teamId: "ferrari", speed: 8, risk: 4 },
  { carId: "mclaren-1", shortName: "NOR", teamId: "mclaren", speed: 10, risk: 8 },
  { carId: "mclaren-2", shortName: "PIA", teamId: "mclaren", speed: 10, risk: 7 },
  { carId: "red-bull-1", shortName: "VER", teamId: "red-bull", speed: 10, risk: 9 },
  { carId: "red-bull-2", shortName: "HAD", teamId: "red-bull", speed: 7, risk: 7 },
  { carId: "alpine-1", shortName: "GAS", teamId: "alpine", speed: 7, risk: 6 },
  { carId: "alpine-2", shortName: "COL", teamId: "alpine", speed: 6, risk: 7 },
  { carId: "racing-bulls-1", shortName: "LAW", teamId: "racing-bulls", speed: 8, risk: 8 },
  { carId: "racing-bulls-2", shortName: "LIN", teamId: "racing-bulls", speed: 6, risk: 8 },
  { carId: "haas-1", shortName: "OCO", teamId: "haas", speed: 8, risk: 7 },
  { carId: "haas-2", shortName: "BEA", teamId: "haas", speed: 8, risk: 6 },
  { carId: "williams-1", shortName: "SAI", teamId: "williams", speed: 7, risk: 5 },
  { carId: "williams-2", shortName: "ALB", teamId: "williams", speed: 7, risk: 8 },
  { carId: "audi-1", shortName: "HUL", teamId: "audi", speed: 8, risk: 8 },
  { carId: "audi-2", shortName: "BOR", teamId: "audi", speed: 9, risk: 7 },
  { carId: "aston-martin-1", shortName: "ALO", teamId: "aston-martin", speed: 6, risk: 8 },
  { carId: "aston-martin-2", shortName: "STR", teamId: "aston-martin", speed: 4, risk: 4 },
  { carId: "cadillac-1", shortName: "PER", teamId: "cadillac", speed: 10, risk: 8 },
  { carId: "cadillac-2", shortName: "BOT", teamId: "cadillac", speed: 5, risk: 3 },
] as const;

const POWER_DRIVER_BY_CAR_ID = new Map(F1_2026_DRIVER_POWER.map((driver) => [driver.carId, driver]));
const POWER_DRIVER_BY_SHORT_NAME = new Map(F1_2026_DRIVER_POWER.map((driver) => [driver.shortName, driver]));
const POWER_TEAM_BY_TEAM_ID = new Map(F1_2026_TEAM_POWER.map((team) => [team.teamId, team]));
const STANDING_DRIVER_BY_CAR_ID = new Map(F1_2026_DRIVER_STANDINGS.map((driver) => [driver.carId, driver]));
const STANDING_TEAM_BY_TEAM_ID = new Map(F1_2026_TEAM_STANDINGS.map((team) => [team.teamId, team]));

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function season2026TeamPower(teamId: string): number {
  return POWER_TEAM_BY_TEAM_ID.get(teamId)?.carPower ?? 8;
}

export function season2026DriverSpeed(shortName: string): number {
  return POWER_DRIVER_BY_SHORT_NAME.get(shortName)?.speed ?? 7;
}

export function season2026DriverRisk(shortName: string): number {
  return POWER_DRIVER_BY_SHORT_NAME.get(shortName)?.risk ?? 6;
}

export function season2026TeamStrength(teamId: string): number {
  return clamp((season2026TeamPower(teamId) - 6) / 4, 0, 1);
}

export function season2026DriverStrength(shortName: string): number {
  return clamp((season2026DriverSpeed(shortName) - 4) / 6, 0, 1);
}

/** Bounded whole-race multipliers consumed by the shared race engine. */
export function season2026TeamPerformance(teamId: string): number {
  return 1.004 - (10 - season2026TeamPower(teamId)) * 0.005;
}

export function season2026DriverPace(shortName: string): number {
  return 1.006 - (10 - season2026DriverSpeed(shortName)) * 0.002;
}

export function season2026DriverConsistency(shortName: string): number {
  return 1.01 - (season2026DriverRisk(shortName) - 3) * 0.002;
}

/**
 * Qualifying strength weights the full available car and driver ranges. It is
 * used for AI run planning only; the actual lap-time deficit is calculated in
 * seconds below.
 */
export function season2026QualifyingStrength(carId: string): number {
  const driver = POWER_DRIVER_BY_CAR_ID.get(carId);
  if (!driver) return 0.5;
  const driverStrength = season2026DriverStrength(driver.shortName);
  const teamStrength = season2026TeamStrength(driver.teamId);
  const potential = teamStrength * 0.65 + driverStrength * 0.35;
  const form = 1 - clamp(season2026FormAdjustmentSeconds(carId) / 1.75, 0, 1);
  return clamp(potential * 0.72 + form * 0.28, 0, 1);
}

/** Pure car/driver potential from the user-supplied Barcelona scaling sheet. */
export function season2026PowerQualifyingPenaltySeconds(carId: string): number {
  const driver = POWER_DRIVER_BY_CAR_ID.get(carId);
  if (!driver) return 1.54;
  return (10 - season2026TeamPower(driver.teamId)) * 0.5 + (10 - driver.speed) * 0.18;
}

/**
 * Continuous current-form prior from the official 2026 points tables. It does
 * not force a result or special-case a driver; it only separates equally rated
 * power-sheet entries whose observed season form is materially different.
 */
export function season2026FormAdjustmentSeconds(carId: string): number {
  const driver = POWER_DRIVER_BY_CAR_ID.get(carId);
  if (!driver) return 1.75;
  const teamPoints = STANDING_TEAM_BY_TEAM_ID.get(driver.teamId)?.points ?? 0;
  const driverPoints = STANDING_DRIVER_BY_CAR_ID.get(carId)?.points ?? 0;
  const leaderTeamPoints = F1_2026_TEAM_STANDINGS[0]?.points ?? 1;
  const leaderDriverPoints = F1_2026_DRIVER_STANDINGS[0]?.points ?? 1;
  const teamForm = (1 - Math.sqrt(clamp(teamPoints / leaderTeamPoints, 0, 1))) * 1.3;
  const driverForm = (1 - Math.sqrt(clamp(driverPoints / leaderDriverPoints, 0, 1))) * 0.45;
  return teamForm + driverForm;
}

export function season2026RawQualifyingPenaltySeconds(carId: string): number {
  return season2026PowerQualifyingPenaltySeconds(carId) + season2026FormAdjustmentSeconds(carId);
}

/**
 * Only front-running bands converge from Q1 to Q3. A blanket compression used
 * to pull a lucky lower-tier survivor toward the leader by more than a second.
 */
export function season2026QualifyingPenaltySeconds(carId: string, session: SeasonQualifyingSegment): number {
  const rawPenalty = season2026RawQualifyingPenaltySeconds(carId);
  if (session === "Q1") return rawPenalty;
  const compression = rawPenalty <= 1
    ? session === "Q2" ? 0.88 : 0.78
    : rawPenalty <= 1.36
      ? session === "Q2" ? 0.96 : 0.92
      : 1;
  return rawPenalty * compression;
}

export function season2026PracticePenaltySeconds(carId: string): number {
  return season2026RawQualifyingPenaltySeconds(carId) * 0.92;
}

/**
 * Car-only pace deficit for a team, in seconds. Driver speed is deliberately
 * excluded: this describes the machinery, so a strong driver must not flatter a
 * slow car. Championship form separates teams that share a power rating.
 */
export function season2026TeamCarDeficitSeconds(teamId: string): number {
  const powerDeficit = (10 - season2026TeamPower(teamId)) * 0.5;
  const teamPoints = STANDING_TEAM_BY_TEAM_ID.get(teamId)?.points ?? 0;
  const leaderTeamPoints = F1_2026_TEAM_STANDINGS[0]?.points ?? 1;
  const formDeficit = (1 - Math.sqrt(clamp(teamPoints / leaderTeamPoints, 0, 1))) * 1.3;
  return powerDeficit + formDeficit;
}

/**
 * Lowest rating shown for the slowest car. The scale is a competitiveness
 * reading rather than an absolute measure, so the back of the grid keeps a
 * non-trivial number while still reading as clearly slower.
 */
export const CAR_PERFORMANCE_RATING_FLOOR = 52;

/**
 * Display rating (0-100) for a team's car.
 *
 * The engine's `performance` value is a lap-time multiplier that spans only
 * 1.004 to 0.984, so showing it as a percentage collapsed the whole grid into
 * 98-100%. This normalises the real car deficit across the field instead, which
 * keeps the top teams genuinely close while separating the midfield and the back
 * markers by a meaningful margin.
 */
export function season2026TeamCarRating(teamId: string): number {
  const deficits = F1_2026_TEAM_POWER.map((team) => season2026TeamCarDeficitSeconds(team.teamId));
  const best = Math.min(...deficits);
  const worst = Math.max(...deficits);
  const span = worst - best;
  if (span <= 0) return 100;
  const relative = (season2026TeamCarDeficitSeconds(teamId) - best) / span;
  return Math.round(100 - relative * (100 - CAR_PERFORMANCE_RATING_FLOOR));
}
