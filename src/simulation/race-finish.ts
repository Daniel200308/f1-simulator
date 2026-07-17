import type { RaceCarState, RaceStatus } from "@/domain/race";

/** Retirements are classified as out and never hold the chequered flag open. */
export function classifiedFieldHasFinished(cars: readonly RaceCarState[]): boolean {
  return cars
    .filter((car) => car.incidentStatus !== "RETIRED")
    .every((car) => car.finished && car.finishTime !== null);
}

/** Driver markers clear only after the last classified runner crosses the line. */
export function shouldShowDriverMarkers(status: RaceStatus): boolean {
  return status !== "FINISHED";
}
