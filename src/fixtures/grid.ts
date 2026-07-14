import type { DriverDefinition, TeamDefinition } from "@/domain/race";

// 2026 grid verified against Formula 1's official driver and results pages on 2026-07-12.
export const TEAMS: readonly TeamDefinition[] = [
  { id: "mercedes", name: "Mercedes", shortName: "MER", primaryColor: 0x27f4d2, accentColor: 0xb6fff3, performance: 1.012 },
  { id: "ferrari", name: "Ferrari", shortName: "FER", primaryColor: 0xff2238, accentColor: 0xffa1aa, performance: 1.008 },
  { id: "mclaren", name: "McLaren", shortName: "MCL", primaryColor: 0xff8700, accentColor: 0xffc47a, performance: 1.005 },
  { id: "red-bull", name: "Red Bull Racing", shortName: "RBR", primaryColor: 0x4c6fff, accentColor: 0xa8b6ff, performance: 1.002 },
  { id: "alpine", name: "Alpine", shortName: "ALP", primaryColor: 0x32a8ff, accentColor: 0x9dd5ff, performance: 0.994 },
  { id: "racing-bulls", name: "Racing Bulls", shortName: "RB", primaryColor: 0xdde6ff, accentColor: 0xffffff, performance: 0.992 },
  { id: "haas", name: "Haas F1 Team", shortName: "HAS", primaryColor: 0xc8cbd0, accentColor: 0xffffff, performance: 0.988 },
  { id: "williams", name: "Williams", shortName: "WIL", primaryColor: 0x1688ff, accentColor: 0x9dccff, performance: 0.985 },
  { id: "audi", name: "Audi", shortName: "AUD", primaryColor: 0xe8ff35, accentColor: 0xf5ff9c, performance: 0.981 },
  { id: "aston-martin", name: "Aston Martin", shortName: "AMR", primaryColor: 0x229971, accentColor: 0x8ce1c4, performance: 0.978 },
  { id: "cadillac", name: "Cadillac", shortName: "CAD", primaryColor: 0xd7b56d, accentColor: 0xf4ddb0, performance: 0.973 },
] as const;

const DRIVER_DATA = [
  ["George Russell", "RUS", 63, 1.010, 1.006], ["Kimi Antonelli", "ANT", 12, 1.012, 0.998],
  ["Charles Leclerc", "LEC", 16, 1.008, 1.006], ["Lewis Hamilton", "HAM", 44, 1.006, 1.010],
  ["Lando Norris", "NOR", 1, 1.007, 1.004], ["Oscar Piastri", "PIA", 81, 1.005, 1.008],
  ["Max Verstappen", "VER", 3, 1.012, 1.009], ["Isack Hadjar", "HAD", 6, 0.999, 1.001],
  ["Pierre Gasly", "GAS", 10, 1.002, 1.005], ["Franco Colapinto", "COL", 43, 0.994, 0.999],
  ["Liam Lawson", "LAW", 30, 0.998, 1.002], ["Arvid Lindblad", "LIN", 41, 0.996, 0.997],
  ["Esteban Ocon", "OCO", 31, 0.999, 1.006], ["Oliver Bearman", "BEA", 87, 0.997, 1.001],
  ["Carlos Sainz", "SAI", 55, 1.003, 1.008], ["Alexander Albon", "ALB", 23, 1.001, 1.004],
  ["Nico Hulkenberg", "HUL", 27, 0.999, 1.007], ["Gabriel Bortoleto", "BOR", 5, 0.995, 1.002],
  ["Fernando Alonso", "ALO", 14, 1.004, 1.010], ["Lance Stroll", "STR", 18, 0.990, 1.000],
  ["Sergio Perez", "PER", 11, 0.998, 1.005], ["Valtteri Bottas", "BOT", 77, 0.997, 1.008],
] as const;

export const DRIVERS: readonly DriverDefinition[] = DRIVER_DATA.map((driver, index) => {
  const team = TEAMS[Math.floor(index / 2)];
  return {
    id: `${team.id}-${index % 2 + 1}`,
    teamId: team.id,
    name: driver[0],
    shortName: driver[1],
    number: driver[2],
    pace: driver[3],
    consistency: driver[4],
  };
});

export const TEAM_BY_ID = new Map(TEAMS.map((team) => [team.id, team]));
export const DRIVER_BY_ID = new Map(DRIVERS.map((driver) => [driver.id, driver]));
export const DEFAULT_PLAYER_TEAM_ID = "ferrari";
export function playerCarIdsFor(teamId: string): string[] {
  return DRIVERS.filter((driver) => driver.teamId === teamId).map((driver) => driver.id);
}
export const PLAYER_CAR_IDS = playerCarIdsFor(DEFAULT_PLAYER_TEAM_ID);
