import type { RaceSnapshot, RadioMessage } from "@/domain/race";
import { DRIVER_BY_ID } from "@/fixtures/grid";

export type RaceControlCategory = "SessionStatus" | "CarEvent" | "Drs" | "Flag" | "SafetyCar" | "Other";
export type RaceControlScope = "Track" | "Sector" | "Driver";

/**
 * Display model based on the OpenF1 race-control schema. The simulation keeps
 * elapsed session time instead of a wall-clock UTC timestamp so replays remain
 * deterministic.
 */
export interface RaceControlNotice {
  id: string;
  elapsedTime: number;
  category: RaceControlCategory;
  driverNumber: number | null;
  flag: string | null;
  lapNumber: number;
  message: string;
  scope: RaceControlScope;
  sector: 1 | 2 | 3 | null;
  priority: RadioMessage["priority"];
}

function categoryFor(message: RadioMessage | undefined, snapshot: RaceSnapshot): RaceControlCategory {
  const content = message?.message.toUpperCase() ?? "";
  if (content.includes("SESSION")) return "SessionStatus";
  if (content.includes("DRS")) return "Drs";
  if (content.includes("SAFETY CAR") || content.includes("VSC") || snapshot.raceControl === "SAFETY_CAR" || snapshot.raceControl === "VSC") return "SafetyCar";
  if (content.includes("FLAG") || snapshot.raceControl === "YELLOW") return "Flag";
  if (message?.carId) return "CarEvent";
  return "Other";
}

function flagFor(snapshot: RaceSnapshot, message: RadioMessage | undefined): string | null {
  const content = message?.message.toUpperCase() ?? "";
  if (content.includes("BLACK AND WHITE")) return "BLACK AND WHITE";
  if (content.includes("CHEQUERED")) return "CHEQUERED";
  if (snapshot.raceControl === "YELLOW") return "YELLOW";
  if (snapshot.raceControl === "VSC") return "VSC";
  if (snapshot.raceControl === "SAFETY_CAR") return "SAFETY CAR";
  return "GREEN";
}

function fallbackMessage(snapshot: RaceSnapshot): string {
  if (snapshot.raceControl === "YELLOW") return `YELLOW FLAG IN TRACK SECTOR ${snapshot.yellowSector ?? "—"}`;
  if (snapshot.raceControl === "VSC") return "VIRTUAL SAFETY CAR DEPLOYED · OVERTAKING PROHIBITED";
  if (snapshot.raceControl === "SAFETY_CAR") return `SAFETY CAR ${snapshot.safetyCarPhase.replace("_", " ")} · FOLLOW DELTA INSTRUCTIONS`;
  return "TRACK CLEAR · RACE CONTROL MONITORING";
}

export function latestRaceControlNotice(snapshot: RaceSnapshot): RaceControlNotice {
  const message = snapshot.radioMessages.find((candidate) => candidate.source === "RACE CONTROL");
  const car = message?.carId ? snapshot.cars.find((candidate) => candidate.carId === message.carId) : undefined;
  const driver = car ? DRIVER_BY_ID.get(car.driverId) : undefined;
  const leader = [...snapshot.cars].sort((left, right) => left.racePosition - right.racePosition)[0];
  const sector = car?.currentSector ?? snapshot.activeIncident?.sector ?? snapshot.yellowSector;
  const scope: RaceControlScope = message?.carId ? "Driver" : sector !== null ? "Sector" : "Track";

  return {
    id: message?.id ?? `monitor-${snapshot.raceControl.toLowerCase()}`,
    elapsedTime: message?.elapsedTime ?? snapshot.elapsedTime,
    category: categoryFor(message, snapshot),
    driverNumber: driver?.number ?? null,
    flag: flagFor(snapshot, message),
    lapNumber: car?.currentLap ?? leader?.currentLap ?? 1,
    message: message?.message ?? fallbackMessage(snapshot),
    scope,
    sector: scope === "Sector" ? sector : null,
    priority: message?.priority ?? "NORMAL",
  };
}
