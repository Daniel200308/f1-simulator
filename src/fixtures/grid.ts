import type { DriverDefinition, TeamDefinition } from "@/domain/race";
import {
  season2026DriverConsistency,
  season2026DriverPace,
  season2026DriverRisk,
  season2026TeamPerformance,
} from "@/fixtures/season-2026-performance";

// 2026 grid using the user-provided car-power, driver-speed and risk table.
export const TEAMS: readonly TeamDefinition[] = [
  { id: "mercedes", name: "Mercedes", shortName: "MER", primaryColor: 0x27f4d2, accentColor: 0xb6fff3, performance: season2026TeamPerformance("mercedes") },
  { id: "ferrari", name: "Ferrari", shortName: "FER", primaryColor: 0xff2238, accentColor: 0xffa1aa, performance: season2026TeamPerformance("ferrari") },
  { id: "mclaren", name: "McLaren", shortName: "MCL", primaryColor: 0xff8700, accentColor: 0xffc47a, performance: season2026TeamPerformance("mclaren") },
  { id: "red-bull", name: "Red Bull Racing", shortName: "RBR", primaryColor: 0x4c6fff, accentColor: 0xa8b6ff, performance: season2026TeamPerformance("red-bull") },
  { id: "alpine", name: "Alpine", shortName: "ALP", primaryColor: 0x32a8ff, accentColor: 0x9dd5ff, performance: season2026TeamPerformance("alpine") },
  { id: "racing-bulls", name: "Racing Bulls", shortName: "RB", primaryColor: 0xdde6ff, accentColor: 0xffffff, performance: season2026TeamPerformance("racing-bulls") },
  { id: "haas", name: "Haas F1 Team", shortName: "HAS", primaryColor: 0xc8cbd0, accentColor: 0xffffff, performance: season2026TeamPerformance("haas") },
  { id: "williams", name: "Williams", shortName: "WIL", primaryColor: 0x1688ff, accentColor: 0x9dccff, performance: season2026TeamPerformance("williams") },
  { id: "audi", name: "Audi", shortName: "AUD", primaryColor: 0xe8ff35, accentColor: 0xf5ff9c, performance: season2026TeamPerformance("audi") },
  { id: "aston-martin", name: "Aston Martin", shortName: "AMR", primaryColor: 0x229971, accentColor: 0x8ce1c4, performance: season2026TeamPerformance("aston-martin") },
  { id: "cadillac", name: "Cadillac", shortName: "CAD", primaryColor: 0xd7b56d, accentColor: 0xf4ddb0, performance: season2026TeamPerformance("cadillac") },
] as const;

const DRIVER_DATA = [
  ["George Russell", "RUS", 63], ["Kimi Antonelli", "ANT", 12],
  ["Charles Leclerc", "LEC", 16], ["Lewis Hamilton", "HAM", 44],
  ["Lando Norris", "NOR", 1], ["Oscar Piastri", "PIA", 81],
  ["Max Verstappen", "VER", 3], ["Isack Hadjar", "HAD", 6],
  ["Pierre Gasly", "GAS", 10], ["Franco Colapinto", "COL", 43],
  ["Liam Lawson", "LAW", 30], ["Arvid Lindblad", "LIN", 41],
  ["Esteban Ocon", "OCO", 31], ["Oliver Bearman", "BEA", 87],
  ["Carlos Sainz", "SAI", 55], ["Alexander Albon", "ALB", 23],
  ["Nico Hulkenberg", "HUL", 27], ["Gabriel Bortoleto", "BOR", 5],
  ["Fernando Alonso", "ALO", 14], ["Lance Stroll", "STR", 18],
  ["Sergio Perez", "PER", 11], ["Valtteri Bottas", "BOT", 77],
] as const;

export const DRIVERS: readonly DriverDefinition[] = DRIVER_DATA.map((driver, index) => {
  const team = TEAMS[Math.floor(index / 2)];
  return {
    id: `${team.id}-${index % 2 + 1}`,
    teamId: team.id,
    name: driver[0],
    shortName: driver[1],
    number: driver[2],
    pace: season2026DriverPace(driver[1]),
    consistency: season2026DriverConsistency(driver[1]),
    risk: season2026DriverRisk(driver[1]),
  };
});

export const TEAM_BY_ID = new Map(TEAMS.map((team) => [team.id, team]));
export const DRIVER_BY_ID = new Map(DRIVERS.map((driver) => [driver.id, driver]));
export const DEFAULT_PLAYER_TEAM_ID = "ferrari";
export function playerCarIdsFor(teamId: string): string[] {
  return DRIVERS.filter((driver) => driver.teamId === teamId).map((driver) => driver.id);
}
export const PLAYER_CAR_IDS = playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID);
