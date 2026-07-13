import type { RaceSnapshot } from "@/domain/race";

/**
 * Returns a short operator-facing reason when a race-control transition is
 * important enough to stop accelerated playback. Keeping this pure lets the
 * worker react on the exact simulation step where the transition occurs.
 */
export function criticalRaceControlTransition(
  previous: Pick<RaceSnapshot, "raceControl" | "yellowSector" | "safetyCarPhase">,
  next: Pick<RaceSnapshot, "raceControl" | "yellowSector" | "safetyCarPhase">,
): string | null {
  if (previous.raceControl !== next.raceControl && next.raceControl !== "GREEN") {
    if (next.raceControl === "YELLOW") return `LOCAL YELLOW · SECTOR ${next.yellowSector ?? "—"}`;
    if (next.raceControl === "VSC") return "VIRTUAL SAFETY CAR DEPLOYED";
    return "SAFETY CAR DEPLOYED";
  }

  if (
    next.raceControl === "SAFETY_CAR"
    && previous.safetyCarPhase !== next.safetyCarPhase
    && next.safetyCarPhase === "DEPLOYED"
  ) {
    return "SAFETY CAR REDEPLOYED";
  }

  if (
    next.raceControl === "SAFETY_CAR"
    && previous.safetyCarPhase !== next.safetyCarPhase
    && next.safetyCarPhase === "RESTART"
  ) {
    return "SAFETY CAR IN THIS LAP";
  }

  return null;
}
