import { TEAMS } from "@/fixtures/grid";
import { normalizeLapDistance, SILVERSTONE_CIRCUIT } from "@/simulation/track";

// Silverstone's F1 pit lane branches after Club and rejoins on Hamilton Straight
// before Abbey. Keeping the modelled lane inside this short final-corner/straight
// window avoids a route that incorrectly extends back through Vale/Stowe.
export const PIT_ENTRY_START = SILVERSTONE_CIRCUIT.lengthMeters - 185;
export const PIT_LANE_START = SILVERSTONE_CIRCUIT.lengthMeters - 135;
/** Nominal mid-lane box distance, kept for the lane's overall geometry. */
export const PIT_BOX_DISTANCE = SILVERSTONE_CIRCUIT.lengthMeters - 45;
export const PIT_EXIT_END = 155;

/**
 * The pit route is one continuous corridor: it starts at the entry line late on
 * a lap, runs past the garages, and rejoins the track after the timing line on
 * the following lap. Because it straddles the lap boundary it carries its own
 * coordinate, zero at the entry line and growing towards the exit.
 */
export const PIT_ROUTE_LENGTH_METERS = SILVERSTONE_CIRCUIT.lengthMeters - PIT_ENTRY_START + PIT_EXIT_END;
const PIT_ROUTE_BOX_METERS = PIT_BOX_DISTANCE - PIT_ENTRY_START;
/**
 * Garage frontage the eleven boxes are spread across, in metres of lane. The
 * whole run sits between the limiter line and the nominal box distance so no
 * garage falls outside the working part of the lane.
 */
const PIT_BOX_FRONTAGE_METERS = 80;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Converts a lap distance into the pit corridor coordinate. Distances at or
 * after the entry line are this lap's approach; the small distances just after
 * the timing line are the exit road of a stop that began on the previous lap.
 */
export function pitRouteDistanceFor(lapDistance: number): number {
  const normalized = normalizeLapDistance(lapDistance, SILVERSTONE_CIRCUIT.lengthMeters);
  return normalized >= PIT_ENTRY_START
    ? normalized - PIT_ENTRY_START
    : normalized + (SILVERSTONE_CIRCUIT.lengthMeters - PIT_ENTRY_START);
}

/** Normalised 0-1 position along the pit corridor. */
export function pitRouteProgressFor(lapDistance: number): number {
  return clamp(pitRouteDistanceFor(lapDistance) / PIT_ROUTE_LENGTH_METERS, 0, 1);
}

/**
 * Each team owns one garage, so a stop has to happen at that team's box rather
 * than at a single shared point in the lane. Box 1 sits nearest the pit exit,
 * which is how the real lane is numbered.
 */
export const PIT_BOX_ORDER: readonly string[] = TEAMS.map((team) => team.id);

export function pitBoxDistanceForTeam(teamId: string): number {
  const index = PIT_BOX_ORDER.indexOf(teamId);
  if (index === -1) return PIT_BOX_DISTANCE;
  const boxCount = PIT_BOX_ORDER.length;
  if (boxCount <= 1) return PIT_BOX_DISTANCE;
  const step = PIT_BOX_FRONTAGE_METERS / (boxCount - 1);
  // The first garage is furthest down the lane, closest to the pit exit.
  return PIT_BOX_DISTANCE - PIT_BOX_FRONTAGE_METERS + step * index;
}

export function pitBoxRouteProgressForTeam(teamId: string): number {
  return clamp((pitBoxDistanceForTeam(teamId) - PIT_ENTRY_START) / PIT_ROUTE_LENGTH_METERS, 0, 1);
}

/** Corridor progress of the nominal mid-lane box, used by session-level views. */
export const PIT_BOX_ROUTE_PROGRESS = clamp(PIT_ROUTE_BOX_METERS / PIT_ROUTE_LENGTH_METERS, 0, 1);
