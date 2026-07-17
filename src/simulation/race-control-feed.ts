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
  headline: string;
  detail: string;
  message: string;
  scope: RaceControlScope;
  sector: 1 | 2 | 3 | null;
  priority: RadioMessage["priority"];
}

function noticeHeadline(
  snapshot: RaceSnapshot,
  category: RaceControlCategory,
  flag: string | null,
  hasMessage: boolean,
): string {
  if (flag === "BLACK AND WHITE") return "BLACK AND WHITE FLAG";
  if (flag === "CHEQUERED") return "CHEQUERED FLAG";
  if (flag === "RED") return "RED FLAG";
  if (snapshot.raceControl === "RED_FLAG") return snapshot.redFlagPhase === "RESTART_COUNTDOWN" ? "RACE RESUMING" : "RED FLAG";
  if (snapshot.raceControl === "VSC") return "VIRTUAL SAFETY CAR";
  if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarPhase === "RESTART") return "SC ENDING";
  if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarLappedCarsMayOvertake) return "LAPPED CARS MAY NOW OVERTAKE";
  if (snapshot.raceControl === "SAFETY_CAR") return "SAFETY CAR";
  if (snapshot.raceControl === "YELLOW") return "YELLOW FLAG";
  if (category === "CarEvent") return "INCIDENT UNDER INVESTIGATION";
  if (category === "Drs") return "DRS STATUS";
  if (category === "SessionStatus") return "SESSION STATUS";
  return hasMessage ? "FIA RACE CONTROL" : "TRACK CLEAR";
}

function incidentReason(snapshot: RaceSnapshot): string | null {
  const incident = snapshot.activeIncident;
  if (!incident) return null;
  const car = snapshot.cars.find((candidate) => candidate.carId === incident.carId);
  const driver = car ? DRIVER_BY_ID.get(car.driverId) : undefined;
  const subject = driver ? `CAR ${driver.number} (${driver.shortName})` : incident.carId.toUpperCase();
  const location = `${incident.cornerName.toUpperCase()} · SECTOR ${incident.sector}`;
  const cause = incident.cause ? ` · ${incident.cause}` : "";
  if (incident.status === "SPUN") return `${subject} SPUN AT ${location}${cause}`;
  if (incident.status === "DAMAGED") return `${subject} DAMAGED AT ${location} · DEBRIS CHECK${cause}`;
  return `${subject} STOPPED AT ${location} · RECOVERY REQUIRED${cause}`;
}

function noticeDetail(snapshot: RaceSnapshot, message: RadioMessage | undefined, headline: string): string {
  const cause = incidentReason(snapshot);
  if (snapshot.raceControl === "RED_FLAG") {
    const seconds = Math.max(0, Math.ceil(snapshot.redFlagTimerSeconds ?? 0));
    if (snapshot.redFlagPhase === "RESTART_COUNTDOWN") return `${snapshot.redFlagRestartType ?? "STANDING"} RESTART · LIGHTS IN ${seconds}S · FOLLOW GRID ORDER`;
    if (snapshot.redFlagPhase === "RESTART_FORMATION") return `${snapshot.redFlagRestartType ?? "STANDING"} RESTART CONFIRMED · FORMATION PROCEDURE IN ${seconds}S`;
    return `${cause ?? "RACE SUSPENDED"} · PIT EXIT CLOSED · TYRE CHANGE AND GENUINE ACCIDENT REPAIR PERMITTED`;
  }
  if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarLappedCarsMayOvertake) {
    return "LAPPED CARS MAY PASS THE SAFETY CAR · REJOIN AT THE BACK";
  }
  if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarPhase === "RESTART") {
    return "SAFETY CAR IN THIS LAP · LEADER CONTROLS PACE · OVERTAKE AFTER THE CONTROL LINE";
  }
  if (snapshot.raceControl === "VSC") return "MAINTAIN POSITIVE DELTA · REDUCE SPEED · OVERTAKING PROHIBITED";
  if (snapshot.raceControl === "SAFETY_CAR") return `FOLLOW SAFETY CAR DELTA · ${snapshot.safetyCarPhase.replace("_", " ")} · OVERTAKING PROHIBITED`;
  if (snapshot.raceControl === "YELLOW") return `SECTOR ${snapshot.yellowSector ?? "—"} · REDUCE SPEED · OVERTAKING PROHIBITED`;

  if (!message) {
    return `RACE CONTROL MONITORING · ${snapshot.pitLaneOpen ? "PIT LANE OPEN" : "PIT LANE CLOSED"}`;
  }

  const prefix = new RegExp(`^${headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i");
  const detail = message.message.replace(prefix, "").replace(/^[\s·:–—-]+/, "").trim();
  return detail || "INSTRUCTIONS ACTIVE · FOLLOW RACE CONTROL DIRECTION";
}

function categoryFor(message: RadioMessage | undefined, snapshot: RaceSnapshot): RaceControlCategory {
  const content = message?.message.toUpperCase() ?? "";
  if (content.includes("SESSION")) return "SessionStatus";
  if (content.includes("DRS")) return "Drs";
  if (content.includes("SAFETY CAR") || content.includes("VSC") || snapshot.raceControl === "SAFETY_CAR" || snapshot.raceControl === "VSC") return "SafetyCar";
  if (content.includes("FLAG") || snapshot.raceControl === "YELLOW" || snapshot.raceControl === "RED_FLAG") return "Flag";
  if (message?.carId) return "CarEvent";
  return "Other";
}

function flagFor(snapshot: RaceSnapshot, message: RadioMessage | undefined): string | null {
  const content = message?.message.toUpperCase() ?? "";
  if (content.includes("BLACK AND WHITE")) return "BLACK AND WHITE";
  if (content.includes("CHEQUERED")) return "CHEQUERED";
  if (content.includes("RED FLAG")) return "RED";
  if (snapshot.raceControl === "RED_FLAG") return "RED";
  if (snapshot.raceControl === "YELLOW") return "YELLOW";
  if (snapshot.raceControl === "VSC") return "VSC";
  if (snapshot.raceControl === "SAFETY_CAR") return "SAFETY CAR";
  return "GREEN";
}

function fallbackMessage(snapshot: RaceSnapshot): string {
  if (snapshot.raceControl === "YELLOW") return `YELLOW FLAG IN TRACK SECTOR ${snapshot.yellowSector ?? "—"}`;
  if (snapshot.raceControl === "VSC") return "VIRTUAL SAFETY CAR DEPLOYED · OVERTAKING PROHIBITED";
  if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarLappedCarsMayOvertake) return "LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR";
  if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarPhase === "RESTART") return "SC ENDING · SAFETY CAR ENTERING PITS IN SECTOR 3";
  if (snapshot.raceControl === "SAFETY_CAR") return `SAFETY CAR ${snapshot.safetyCarPhase.replace("_", " ")} · FOLLOW DELTA INSTRUCTIONS`;
  if (snapshot.raceControl === "RED_FLAG") return "RED FLAG · RACE SUSPENDED · PROCEED TO PIT-LANE QUEUE";
  return "TRACK CLEAR · RACE CONTROL MONITORING";
}

export function latestRaceControlNotice(snapshot: RaceSnapshot): RaceControlNotice {
  const neutralisedRace = snapshot.raceControl === "YELLOW" || snapshot.raceControl === "VSC" || snapshot.raceControl === "SAFETY_CAR";
  // During a neutralisation, the live directive owns the banner. A stale or
  // newly generated car incident must not replace YELLOW / VSC / SC guidance.
  const message = neutralisedRace
    ? undefined
    : snapshot.radioMessages.find((candidate) => candidate.source === "RACE CONTROL");
  const car = message?.carId ? snapshot.cars.find((candidate) => candidate.carId === message.carId) : undefined;
  const driver = car ? DRIVER_BY_ID.get(car.driverId) : undefined;
  const leader = [...snapshot.cars].sort((left, right) => left.racePosition - right.racePosition)[0];
  const sector = car?.currentSector ?? snapshot.activeIncident?.sector ?? snapshot.yellowSector;
  const scope: RaceControlScope = message?.carId ? "Driver" : sector !== null ? "Sector" : "Track";
  const category = categoryFor(message, snapshot);
  const flag = flagFor(snapshot, message);
  const content = message?.message.toUpperCase() ?? "";
  const headline = neutralisedRace
    ? noticeHeadline(snapshot, category, flag, Boolean(message))
    : content.includes("NO FURTHER ACTION")
    ? "STEWARDS · NO FURTHER ACTION"
    : content.includes("PENALTY") || content.includes("DISQUALIFIED") || content.includes("REPRIMAND")
      ? "STEWARDS DECISION"
      : content.includes("UNDER INVESTIGATION") || content.includes("INCIDENT NOTED")
        ? "INCIDENT UNDER INVESTIGATION"
        : noticeHeadline(snapshot, category, flag, Boolean(message));

  return {
    id: message?.id ?? `monitor-${snapshot.raceControl.toLowerCase()}`,
    elapsedTime: message?.elapsedTime ?? snapshot.elapsedTime,
    category,
    driverNumber: driver?.number ?? null,
    flag,
    lapNumber: car?.currentLap ?? leader?.currentLap ?? 1,
    headline,
    detail: noticeDetail(snapshot, message, headline),
    message: message?.message ?? fallbackMessage(snapshot),
    scope,
    sector: scope === "Sector" ? sector : null,
    priority: message?.priority ?? "NORMAL",
  };
}
