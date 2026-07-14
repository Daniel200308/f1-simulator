import type { TyreCompound } from "@/domain/race";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, DRIVERS, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { hashNoise, signedNoise } from "@/simulation/random";

export type PracticeSession = "FP1" | "FP2" | "FP3";
export type QualifyingSession = "Q1" | "Q2" | "Q3";
export type WeekendSession = PracticeSession | QualifyingSession | "RACE";

export interface CarSetup {
  frontWing: number;
  suspension: number;
  cooling: number;
}

export interface SetupFeedback {
  area: "RUN" | "AERO" | "MECHANICAL" | "THERMAL";
  severity: "INFO" | "WATCH" | "GOOD";
  message: string;
}

export interface WeekendClassificationEntry {
  position: number;
  carId: string;
  bestLapSeconds: number;
  laps: number;
  compound: TyreCompound;
  gapSeconds: number;
  eliminated: boolean;
}

export interface WeekendSessionResult {
  session: PracticeSession | QualifyingSession;
  durationMinutes: number;
  entries: readonly WeekendClassificationEntry[];
}

export interface WeekendCarReport {
  carId: string;
  position: number | null;
  bestLapSeconds: number | null;
  outcome: "COMPLETE" | "ADVANCED" | "ELIMINATED" | "NO RUN";
  aeroBalancePercent: number;
  mechanicalBalancePercent: number;
  thermalMarginPercent: number;
  tyreConditionPercent: number;
  driverMessage: string;
  engineerMessage: string;
}

export interface WeekendSessionReport {
  session: PracticeSession | QualifyingSession;
  title: string;
  summary: string;
  cars: readonly WeekendCarReport[];
}

export interface QualifyingRecord {
  carId: string;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  finalPosition: number | null;
}

export interface WeekendState {
  seed: number;
  playerTeamId: string;
  currentSession: WeekendSession;
  completedSessions: readonly (PracticeSession | QualifyingSession)[];
  results: readonly WeekendSessionResult[];
  qualifying: readonly QualifyingRecord[];
  gridOrder: readonly string[];
  setups: Readonly<Record<string, CarSetup>>;
  lastRunSetups: Readonly<Record<string, CarSetup>>;
  setupKnowledge: number;
  tyreUsage: Readonly<Record<string, Partial<Record<TyreCompound, number>>>>;
  sessionReports: readonly WeekendSessionReport[];
}

export interface SessionRule {
  id: WeekendSession;
  group: "PRACTICE" | "QUALIFYING" | "RACE";
  durationMinutes: number | null;
  entrants: number;
  eliminated: number;
  breakBeforeMinutes: number;
}

// FIA 2026 Formula 1 Sporting Regulations, Section B, issue 07 (25 June 2026).
export const STANDARD_WEEKEND_RULES: readonly SessionRule[] = [
  { id: "FP1", group: "PRACTICE", durationMinutes: 60, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
  { id: "FP2", group: "PRACTICE", durationMinutes: 60, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
  { id: "FP3", group: "PRACTICE", durationMinutes: 60, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
  { id: "Q1", group: "QUALIFYING", durationMinutes: 18, entrants: 22, eliminated: 6, breakBeforeMinutes: 0 },
  { id: "Q2", group: "QUALIFYING", durationMinutes: 15, entrants: 16, eliminated: 6, breakBeforeMinutes: 7 },
  { id: "Q3", group: "QUALIFYING", durationMinutes: 13, entrants: 10, eliminated: 0, breakBeforeMinutes: 7 },
  { id: "RACE", group: "RACE", durationMinutes: null, entrants: 22, eliminated: 0, breakBeforeMinutes: 0 },
] as const;

const SESSION_SEQUENCE: readonly WeekendSession[] = STANDARD_WEEKEND_RULES.map((rule) => rule.id);
const PRACTICE_COMPOUND: Record<PracticeSession, TyreCompound> = { FP1: "HARD", FP2: "MEDIUM", FP3: "SOFT" };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundMillis(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

function optimalSetupFor(seed: number, carId: string): CarSetup {
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  const aeroShift = Math.round(signedNoise(seed, 701, 13) * 1.15);
  const mechanicalShift = Math.round(signedNoise(seed, 702, 17) * 1.15);
  const driverPreference = driverIndex % 2 === 0 ? 0 : 1;
  return {
    frontWing: clamp(7 + aeroShift + driverPreference, 5, 9),
    suspension: clamp(5 + mechanicalShift - driverPreference, 3, 8),
    cooling: clamp(3 + Math.round(signedNoise(seed, 703, 19) * 0.8), 2, 4),
  };
}

function initialSetupFor(seed: number, carId: string, playerTeamId: string): CarSetup {
  const driver = DRIVER_BY_ID.get(carId);
  if (driver?.teamId === playerTeamId) {
    const teamSlot = playerCarIdsFor(playerTeamId).indexOf(carId);
    return teamSlot === 0
      ? { frontWing: 5, suspension: 6, cooling: 2 }
      : { frontWing: 6, suspension: 4, cooling: 4 };
  }
  const target = optimalSetupFor(seed, carId);
  const driverIndex = Math.max(0, DRIVERS.findIndex((driver) => driver.id === carId));
  return {
    frontWing: clamp(target.frontWing + Math.round(signedNoise(seed, driverIndex + 810, 1) * 0.7), 1, 10),
    suspension: clamp(target.suspension + Math.round(signedNoise(seed, driverIndex + 810, 2) * 0.7), 1, 10),
    cooling: clamp(target.cooling + Math.round(signedNoise(seed, driverIndex + 810, 3) * 0.55), 1, 5),
  };
}

function setupPenalty(setup: CarSetup, target: CarSetup): number {
  return Math.abs(setup.frontWing - target.frontWing) * 0.12
    + Math.abs(setup.suspension - target.suspension) * 0.09
    + Math.abs(setup.cooling - target.cooling) * 0.06;
}

export function raceSetupPerformanceFactor(setup: CarSetup, seed = 20_260_712, carId = "ferrari-1"): number {
  return clamp(1 - setupPenalty(setup, optimalSetupFor(seed, carId)) * 0.008, 0.993, 1);
}

function setupFor(state: WeekendState, carId: string): CarSetup {
  return state.setups[carId] ?? initialSetupFor(state.seed, carId, state.playerTeamId);
}

function driverLapTime(
  state: WeekendState,
  carId: string,
  session: PracticeSession | QualifyingSession,
  run: number,
): number {
  const driver = DRIVER_BY_ID.get(carId);
  const team = driver ? TEAM_BY_ID.get(driver.teamId) : undefined;
  if (!driver || !team) return 99;

  const sessionIndex = SESSION_SEQUENCE.indexOf(session);
  const qualifyingGain = session === "Q1" ? 0.8 : session === "Q2" ? 1.35 : session === "Q3" ? 1.72 : 0;
  const practiceGain = session === "FP1" ? -0.15 : session === "FP2" ? 0.3 : session === "FP3" ? 0.62 : 0;
  const performanceGain = (team.performance - 0.99) * 20 + (driver.pace - 1) * 24;
  const setupLoss = setupPenalty(setupFor(state, carId), optimalSetupFor(state.seed, carId));
  const evolution = state.completedSessions.length * 0.08;
  const variation = signedNoise(state.seed, DRIVERS.findIndex((candidate) => candidate.id === carId) + sessionIndex * 31, run + 17) * (0.24 / driver.consistency);
  const base = 91.25 - performanceGain - practiceGain - qualifyingGain - evolution + setupLoss + variation;
  return roundMillis(base);
}

function classify(
  state: WeekendState,
  session: PracticeSession | QualifyingSession,
  carIds: readonly string[],
  eliminatedCount: number,
): WeekendSessionResult {
  const rule = STANDARD_WEEKEND_RULES.find((candidate) => candidate.id === session)!;
  const compound: TyreCompound = session.startsWith("Q") ? "SOFT" : PRACTICE_COMPOUND[session as PracticeSession];
  const entries = carIds.map((carId, index) => {
    const runs = session.startsWith("Q") ? 2 : 3;
    const bestLapSeconds = Math.min(...Array.from({ length: runs }, (_, run) => driverLapTime(state, carId, session, run)));
    const laps = session.startsWith("Q")
      ? 6 + Math.floor(hashNoise(state.seed, index + 210, SESSION_SEQUENCE.indexOf(session)) * 4)
      : 20 + Math.floor(hashNoise(state.seed, index + 110, SESSION_SEQUENCE.indexOf(session)) * 11);
    return { carId, bestLapSeconds, laps, compound };
  }).sort((a, b) => a.bestLapSeconds - b.bestLapSeconds || carIds.indexOf(a.carId) - carIds.indexOf(b.carId));
  const leader = entries[0]?.bestLapSeconds ?? 0;
  const eliminationLine = Math.max(0, entries.length - eliminatedCount);

  return {
    session,
    durationMinutes: rule.durationMinutes ?? 0,
    entries: entries.map((entry, index) => ({
      ...entry,
      position: index + 1,
      gapSeconds: roundMillis(entry.bestLapSeconds - leader),
      eliminated: eliminatedCount > 0 && index >= eliminationLine,
    })),
  };
}

function incrementTyreUsage(
  tyreUsage: WeekendState["tyreUsage"],
  carIds: readonly string[],
  compound: TyreCompound,
): WeekendState["tyreUsage"] {
  return Object.fromEntries(DRIVERS.map((driver) => {
    const current = tyreUsage[driver.id] ?? {};
    return [driver.id, carIds.includes(driver.id)
      ? { ...current, [compound]: (current[compound] ?? 0) + 1 }
      : current];
  }));
}

function qualifyingRecords(results: readonly WeekendSessionResult[]): QualifyingRecord[] {
  const bySession = new Map(results.filter((result) => result.session.startsWith("Q")).map((result) => [result.session, result]));
  const q1 = bySession.get("Q1");
  const q2 = bySession.get("Q2");
  const q3 = bySession.get("Q3");
  const finalOrder = q3
    ? [
        ...q3.entries,
        ...(q2?.entries.filter((entry) => entry.eliminated) ?? []),
        ...(q1?.entries.filter((entry) => entry.eliminated) ?? []),
      ]
    : [];

  return DRIVERS.map((driver) => ({
    carId: driver.id,
    q1: q1?.entries.find((entry) => entry.carId === driver.id)?.bestLapSeconds ?? null,
    q2: q2?.entries.find((entry) => entry.carId === driver.id)?.bestLapSeconds ?? null,
    q3: q3?.entries.find((entry) => entry.carId === driver.id)?.bestLapSeconds ?? null,
    finalPosition: finalOrder.findIndex((entry) => entry.carId === driver.id) + 1 || null,
  }));
}

export function createWeekendState(seed: number, playerTeamId = DEFAULT_PLAYER_TEAM_ID): WeekendState {
  if (!TEAM_BY_ID.has(playerTeamId)) throw new RangeError(`Unknown player team: ${playerTeamId}.`);
  const setups = Object.fromEntries(DRIVERS.map((driver) => [driver.id, initialSetupFor(seed, driver.id, playerTeamId)]));
  const tyreUsage = Object.fromEntries(DRIVERS.map((driver) => [driver.id, {}]));
  return {
    seed,
    playerTeamId,
    currentSession: "FP1",
    completedSessions: [],
    results: [],
    qualifying: DRIVERS.map((driver) => ({ carId: driver.id, q1: null, q2: null, q3: null, finalPosition: null })),
    gridOrder: DRIVERS.map((driver) => driver.id),
    setups,
    lastRunSetups: Object.fromEntries(Object.entries(setups).map(([carId, setup]) => [carId, { ...setup }])),
    setupKnowledge: 0,
    tyreUsage,
    sessionReports: [],
  };
}

function sessionReportFor(state: WeekendState, result: WeekendSessionResult): WeekendSessionReport {
  const qualifying = result.session.startsWith("Q");
  const reports = playerCarIdsFor(state.playerTeamId).map((carId): WeekendCarReport => {
    const driver = DRIVER_BY_ID.get(carId)!;
    const entry = result.entries.find((candidate) => candidate.carId === carId);
    const setup = state.setups[carId];
    const target = optimalSetupFor(state.seed, carId);
    const aeroDifference = setup.frontWing - target.frontWing;
    const mechanicalDifference = setup.suspension - target.suspension;
    const coolingDifference = setup.cooling - target.cooling;
    const aeroBalancePercent = Math.round(clamp(100 - Math.abs(aeroDifference) * 18, 28, 100));
    const mechanicalBalancePercent = Math.round(clamp(100 - Math.abs(mechanicalDifference) * 20, 25, 100));
    const thermalMarginPercent = Math.round(clamp(100 - Math.abs(coolingDifference) * 22, 24, 100));
    const tyreConditionPercent = entry
      ? Math.round(clamp(100 - entry.laps * (result.session === "FP3" || qualifying ? 1.05 : result.session === "FP2" ? 0.72 : 0.52), 38, 96))
      : 100;
    const outcome: WeekendCarReport["outcome"] = !entry ? "NO RUN" : entry.eliminated ? "ELIMINATED" : qualifying && result.session !== "Q3" ? "ADVANCED" : "COMPLETE";
    const balanceIssue = Math.abs(aeroDifference) >= Math.abs(mechanicalDifference)
      ? aeroDifference < 0 ? "high-speed understeer" : aeroDifference > 0 ? "straight-line drag" : "a stable front balance"
      : mechanicalDifference < 0 ? "platform movement through direction changes" : mechanicalDifference > 0 ? "rear instability over kerbs" : "a stable mechanical platform";
    const driverMessage = !entry
      ? `We did not run in ${result.session}. I will stay involved with the engineering debrief for the next session.`
      : qualifying
        ? entry.eliminated
          ? `I did not put the lap together. The car still had ${balanceIssue}, and we left time in the final sector.`
          : `The lap was committed and the car gave me confidence. I still feel ${balanceIssue}, so there is more performance available.`
        : `Across the long and short runs I felt ${balanceIssue}. ${tyreConditionPercent < 60 ? "The tyre balance faded late in the run." : "The balance remained repeatable as the fuel came down."}`;
    const engineerMessage = !entry
      ? `${driver.shortName} was not eligible for this segment. We retained the car and tyre allocation for the remaining programme.`
      : qualifying
        ? `${driver.shortName} classified P${entry.position} with ${entry.bestLapSeconds.toFixed(3)}. ${entry.eliminated ? "The lap missed the progression threshold; review preparation, traffic and final-run execution." : result.session === "Q3" ? "Final grid position is confirmed." : "The car advances, but the next run will require a cleaner tyre-preparation window."}`
        : `${driver.shortName} completed ${entry.laps} laps and classified P${entry.position}, ${entry.gapSeconds.toFixed(3)}s from the reference. Aero ${aeroBalancePercent}%, mechanical ${mechanicalBalancePercent}%, thermal margin ${thermalMarginPercent}%.`;
    return {
      carId,
      position: entry?.position ?? null,
      bestLapSeconds: entry?.bestLapSeconds ?? null,
      outcome,
      aeroBalancePercent,
      mechanicalBalancePercent,
      thermalMarginPercent,
      tyreConditionPercent,
      driverMessage,
      engineerMessage,
    };
  });
  const activeReports = reports.filter((report) => report.position !== null);
  const bestPosition = activeReports.length ? Math.min(...activeReports.map((report) => report.position!)) : null;
  return {
    session: result.session,
    title: qualifying ? `${result.session} QUALIFYING REPORT` : `${result.session} RUN REPORT`,
    summary: bestPosition === null
      ? "No player car recorded a timed lap in this segment."
      : qualifying
        ? `Best team result P${bestPosition}. Review driver execution and engineering state before the next segment.`
        : `Programme complete. Best team result P${bestPosition}; use the driver and engineering reports before changing the setup.`,
    cars: reports,
  };
}

function balanceFeedback(area: SetupFeedback["area"], difference: number, lowMessage: string, highMessage: string, goodMessage: string): SetupFeedback {
  if (difference <= -1) return { area, severity: Math.abs(difference) >= 2 ? "WATCH" : "INFO", message: lowMessage };
  if (difference >= 1) return { area, severity: Math.abs(difference) >= 2 ? "WATCH" : "INFO", message: highMessage };
  return { area, severity: "GOOD", message: goodMessage };
}

export function setupFeedbackFor(state: WeekendState, carId: string): readonly SetupFeedback[] {
  const driver = DRIVER_BY_ID.get(carId);
  const completedPractice = state.completedSessions.filter((session): session is PracticeSession => session.startsWith("FP"));
  if (!driver || completedPractice.length === 0) {
    return [{ area: "RUN", severity: "INFO", message: "Run the FP1 baseline first. No target values are pre-solved; use the driver debrief to choose the next change." }];
  }

  // Debrief only the configuration that actually completed the most recent
  // practice run. Moving a slider must not reveal the hidden target instantly.
  const setup = state.lastRunSetups[carId] ?? setupFor(state, carId);
  const target = optimalSetupFor(state.seed, carId);
  const latestPractice = [...state.results].reverse().find((result) => result.session.startsWith("FP"));
  const entry = latestPractice?.entries.find((candidate) => candidate.carId === carId);
  const runFeedback: SetupFeedback = {
    area: "RUN",
    severity: entry && entry.position > 10 ? "WATCH" : "INFO",
    message: entry
      ? `${latestPractice?.session} debrief · ${driver.shortName} was P${entry.position}, ${entry.position === 1 ? "setting the reference" : `${entry.gapSeconds.toFixed(3)}s from the reference`}. ${completedPractice.length === 1 ? "Use the comments below to prepare FP2." : completedPractice.length === 2 ? "Compare the FP2 response with the first run before committing for FP3." : "Final practice data is ready for qualifying."}`
      : `${driver.shortName} completed the run programme; timing correlation is still incomplete.`,
  };

  const aero = balanceFeedback(
    "AERO",
    setup.frontWing - target.frontWing,
    `${driver.shortName} reports high-speed front wash through Copse and Maggotts. More front load should help, with a straight-line cost.`,
    `${driver.shortName} has a sharp front end but is losing efficiency on the Hangar Straight. Trim front load carefully.`,
    `${driver.shortName} reports a predictable high-speed front balance. Aero is inside the current confidence window.`,
  );
  const mechanical = balanceFeedback(
    "MECHANICAL",
    setup.suspension - target.suspension,
    `${driver.shortName} feels the platform moving in direction changes and the rear takes time to settle. A firmer response may help.`,
    `${driver.shortName} reports snap oversteer over kerbs and traction loss from slower corners. The platform may be too stiff.`,
    `${driver.shortName} is comfortable over kerbs and through rapid direction changes. Mechanical balance is stable.`,
  );
  const thermal = balanceFeedback(
    "THERMAL",
    setup.cooling - target.cooling,
    `${driver.shortName} is seeing rising temperatures late in the run. Open the cooling margin or shorten the push phase.`,
    `${driver.shortName} has safe temperatures but the car is paying an avoidable drag penalty. Cooling margin looks conservative.`,
    `${driver.shortName} reports stable temperatures across the representative run. Cooling is in range.`,
  );

  return [runFeedback, aero, mechanical, thermal];
}

export function setWeekendCarSetup(state: WeekendState, carId: string, setup: CarSetup): WeekendState {
  if (!DRIVER_BY_ID.has(carId)) return state;
  return {
    ...state,
    setups: {
      ...state.setups,
      [carId]: {
        frontWing: clamp(Math.round(setup.frontWing), 1, 10),
        suspension: clamp(Math.round(setup.suspension), 1, 10),
        cooling: clamp(Math.round(setup.cooling), 1, 5),
      },
    },
  };
}

export function runWeekendSession(state: WeekendState): WeekendState {
  if (state.currentSession === "RACE") return state;
  const session = state.currentSession;
  const previousQualifying = state.results.filter((result) => result.session.startsWith("Q"));
  const entrants = session === "Q2"
    ? previousQualifying.find((result) => result.session === "Q1")?.entries.filter((entry) => !entry.eliminated).map((entry) => entry.carId) ?? []
    : session === "Q3"
      ? previousQualifying.find((result) => result.session === "Q2")?.entries.filter((entry) => !entry.eliminated).map((entry) => entry.carId) ?? []
      : DRIVERS.map((driver) => driver.id);
  const rule = STANDARD_WEEKEND_RULES.find((candidate) => candidate.id === session)!;
  const result = classify(state, session, entrants, rule.eliminated);
  const sessionReport = sessionReportFor(state, result);
  const results = [...state.results, result];
  const completedSessions = [...state.completedSessions, session];
  const nextSession = SESSION_SEQUENCE[SESSION_SEQUENCE.indexOf(session) + 1] ?? "RACE";
  const compound: TyreCompound = session.startsWith("Q") ? "SOFT" : PRACTICE_COMPOUND[session as PracticeSession];
  // Q2 and Q3 reuse the retained qualifying allocation in this prototype;
  // only Q1 consumes an additional race-weekend set.
  const tyreUsage = !session.startsWith("Q") || session === "Q1"
    ? incrementTyreUsage(state.tyreUsage, entrants, compound)
    : state.tyreUsage;
  const qualifying = qualifyingRecords(results);
  const finalGrid = nextSession === "RACE"
    ? [...qualifying].sort((a, b) => (a.finalPosition ?? 99) - (b.finalPosition ?? 99)).map((record) => record.carId)
    : state.gridOrder;

  return {
    ...state,
    currentSession: nextSession,
    completedSessions,
    results,
    qualifying,
    gridOrder: finalGrid,
    lastRunSetups: session.startsWith("FP")
      ? Object.fromEntries(Object.entries(state.setups).map(([carId, setup]) => [carId, { ...setup }]))
      : state.lastRunSetups,
    setupKnowledge: session.startsWith("FP") ? clamp(state.setupKnowledge + 30, 0, 100) : state.setupKnowledge,
    tyreUsage,
    sessionReports: [...state.sessionReports, sessionReport],
  };
}

export function currentWeekendRule(state: WeekendState): SessionRule {
  return STANDARD_WEEKEND_RULES.find((rule) => rule.id === state.currentSession)!;
}

export function latestWeekendResult(state: WeekendState): WeekendSessionResult | null {
  return state.results.at(-1) ?? null;
}

export function latestWeekendReport(state: WeekendState): WeekendSessionReport | null {
  return state.sessionReports.at(-1) ?? null;
}
