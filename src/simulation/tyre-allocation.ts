import type {
  TyreCompound,
  WeekendTyreInventory,
  WeekendTyreSet,
  WeekendTyreUsage,
} from "@/domain/race";

/** FIA 2026 standard-format weekend allocation per driver (Section B, B6.2.4). */
export const FIA_2026_STANDARD_TYRE_ALLOCATION: Readonly<Record<TyreCompound, number>> = {
  SOFT: 6,
  MEDIUM: 4,
  HARD: 2,
  INTERMEDIATE: 2,
  WET: 2,
};

export const TYRE_COMPOUND_ORDER: readonly TyreCompound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

export type RaceStartTyreFreshness = "NEW" | "USED";

export interface RaceStartTyreSetOption {
  id: string;
  compound: TyreCompound;
  setNumber: number;
  freshness: RaceStartTyreFreshness;
  condition: number;
  lapsUsed: number;
  status: WeekendTyreSet["status"];
}

export type RaceStartTyreSelection = RaceStartTyreSetOption;

const ESTIMATED_LAPS_PER_USE: Readonly<Record<TyreCompound, number>> = {
  SOFT: 3,
  MEDIUM: 8,
  HARD: 10,
  INTERMEDIATE: 6,
  WET: 6,
};

const ESTIMATED_WEAR_PER_LAP: Readonly<Record<TyreCompound, number>> = {
  SOFT: 3.6,
  MEDIUM: 2.35,
  HARD: 1.65,
  INTERMEDIATE: 2.4,
  WET: 2.05,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function tyreSetId(carId: string, compound: TyreCompound, setNumber: number): string {
  return `${carId}-${compound.toLowerCase()}-${setNumber}`;
}

export function createWeekendTyreInventory(driverIds: readonly string[]): WeekendTyreInventory {
  return Object.fromEntries(driverIds.map((driverId) => [driverId, TYRE_COMPOUND_ORDER.flatMap((compound) => (
    Array.from({ length: FIA_2026_STANDARD_TYRE_ALLOCATION[compound] }, (_, index): WeekendTyreSet => ({
      id: tyreSetId(driverId, compound, index + 1),
      compound,
      driverId,
      status: "NEW",
      wearPercent: 0,
      heatCycles: 0,
      lapsCompleted: 0,
      sessionHistory: [],
    }))
  ))])) as WeekendTyreInventory;
}

function isWeekendTyreInventory(source: WeekendTyreUsage | WeekendTyreInventory | undefined): source is WeekendTyreInventory {
  if (!source) return false;
  const first = Object.values(source)[0];
  return Array.isArray(first);
}

export function weekendTyreUsageFromInventory(inventory: WeekendTyreInventory): WeekendTyreUsage {
  return Object.fromEntries(Object.entries(inventory).map(([driverId, sets]) => {
    const usage: Partial<Record<TyreCompound, number>> = {};
    for (const compound of TYRE_COMPOUND_ORDER) {
      usage[compound] = sets.filter((set) => set.compound === compound && set.sessionHistory.length > 0).length;
    }
    return [driverId, usage];
  }));
}

export function weekendTyreSetById(
  inventory: WeekendTyreInventory,
  driverId: string,
  setId: string | null,
): WeekendTyreSet | null {
  if (!setId) return null;
  return inventory[driverId]?.find((set) => set.id === setId) ?? null;
}

export function selectableWeekendTyreSets(
  inventory: WeekendTyreInventory,
  driverId: string,
  compound?: TyreCompound,
): readonly WeekendTyreSet[] {
  return (inventory[driverId] ?? [])
    .filter((set) => (!compound || set.compound === compound) && (set.status === "NEW" || set.status === "USED"))
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "NEW" ? -1 : 1;
      return left.wearPercent - right.wearPercent || left.id.localeCompare(right.id);
    });
}

export function fitWeekendTyreSet(
  inventory: WeekendTyreInventory,
  driverId: string,
  setId: string,
  session: string,
): WeekendTyreInventory {
  const selected = weekendTyreSetById(inventory, driverId, setId);
  if (!selected || (selected.status !== "NEW" && selected.status !== "USED")) return inventory;
  return {
    ...inventory,
    [driverId]: inventory[driverId].map((set) => set.id === setId
      ? { ...set, status: "FITTED", sessionHistory: set.sessionHistory.includes(session) ? set.sessionHistory : [...set.sessionHistory, session] }
      : set.status === "FITTED" ? { ...set, status: set.sessionHistory.length ? "USED" : "NEW" } : set),
  };
}

export function completeWeekendTyreRun(
  inventory: WeekendTyreInventory,
  driverId: string,
  setId: string,
  session: string,
  conditionPercent: number,
  lapsCompleted: number,
): WeekendTyreInventory {
  const selected = weekendTyreSetById(inventory, driverId, setId);
  if (!selected || selected.status !== "FITTED") return inventory;
  return {
    ...inventory,
    [driverId]: inventory[driverId].map((set) => set.id === setId ? {
      ...set,
      status: "USED",
      wearPercent: Math.max(set.wearPercent, Math.min(100, 100 - conditionPercent)),
      heatCycles: set.heatCycles + 1,
      lapsCompleted: set.lapsCompleted + Math.max(0, lapsCompleted),
      sessionHistory: set.sessionHistory.includes(session) ? set.sessionHistory : [...set.sessionHistory, session],
    } : set),
  };
}

export function reserveWeekendTyreSet(
  inventory: WeekendTyreInventory,
  driverId: string,
  setId: string,
): WeekendTyreInventory {
  const selected = weekendTyreSetById(inventory, driverId, setId);
  if (!selected || !(["NEW", "USED", "RESERVED"] as const).includes(selected.status as "NEW" | "USED" | "RESERVED")) return inventory;
  return {
    ...inventory,
    [driverId]: inventory[driverId].map((set) => {
      if (set.id === setId) return { ...set, status: "RESERVED" };
      if (set.status !== "RESERVED") return set;
      return { ...set, status: set.sessionHistory.length ? "USED" : "NEW" };
    }),
  };
}

export function weekendTyreUseCount(carId: string, compound: TyreCompound, tyreUsage?: WeekendTyreUsage): number {
  return clamp(Math.floor(tyreUsage?.[carId]?.[compound] ?? 0), 0, FIA_2026_STANDARD_TYRE_ALLOCATION[compound]);
}

/**
 * Reconstructs a deterministic per-set ledger from the weekend usage counters.
 * The weekend model currently records a set use rather than every tyre lap, so
 * used-set life is intentionally an estimate until full stint telemetry is stored.
 */
export function raceStartTyreInventory(carId: string, source?: WeekendTyreUsage | WeekendTyreInventory): readonly RaceStartTyreSetOption[] {
  if (isWeekendTyreInventory(source)) {
    return (source[carId] ?? []).map((set, index) => ({
      id: set.id,
      compound: set.compound,
      setNumber: Number(set.id.split("-").at(-1)) || index + 1,
      freshness: set.sessionHistory.length === 0 && set.wearPercent === 0 && set.lapsCompleted === 0 ? "NEW" : "USED",
      condition: Math.round(clamp(100 - set.wearPercent, 0, 100)),
      lapsUsed: set.lapsCompleted,
      status: set.status,
    }));
  }
  const tyreUsage = source;
  return TYRE_COMPOUND_ORDER.flatMap((compound) => {
    const usedCount = weekendTyreUseCount(carId, compound, tyreUsage);
    return Array.from({ length: FIA_2026_STANDARD_TYRE_ALLOCATION[compound] }, (_, index) => {
      const setNumber = index + 1;
      const used = index < usedCount;
      const lapsUsed = used ? ESTIMATED_LAPS_PER_USE[compound] + (index % 2) : 0;
      const condition = used
        ? Math.round(clamp(100 - lapsUsed * ESTIMATED_WEAR_PER_LAP[compound], 55, 99))
        : 100;
      return {
        id: tyreSetId(carId, compound, setNumber),
        compound,
        setNumber,
        freshness: used ? "USED" : "NEW",
        condition,
        lapsUsed,
        status: used ? "USED" : "NEW",
      } satisfies RaceStartTyreSetOption;
    });
  });
}

export function raceStartTyreSetsFor(
  carId: string,
  compound: TyreCompound,
  source?: WeekendTyreUsage | WeekendTyreInventory,
): readonly RaceStartTyreSetOption[] {
  return raceStartTyreInventory(carId, source)
    .filter((set) => set.compound === compound && set.status !== "FITTED" && set.status !== "UNAVAILABLE")
    .sort((left, right) => {
      if (left.freshness !== right.freshness) return left.freshness === "NEW" ? -1 : 1;
      return right.condition - left.condition || left.setNumber - right.setNumber;
    });
}

export function chooseRaceStartTyreSet(
  carId: string,
  compound: TyreCompound,
  source?: WeekendTyreUsage | WeekendTyreInventory,
  freshness: RaceStartTyreFreshness | "BEST" = "BEST",
): RaceStartTyreSelection {
  const candidates = raceStartTyreSetsFor(carId, compound, source);
  const selected = freshness === "BEST"
    ? candidates[0]
    : candidates.find((set) => set.freshness === freshness) ?? candidates[0];
  if (!selected) throw new RangeError(`No ${compound} tyre set allocated for ${carId}`);
  return { ...selected };
}

export function remainingWeekendTyreUses(carId: string, compound: TyreCompound, tyreUsage?: WeekendTyreUsage): number {
  return Math.max(0, FIA_2026_STANDARD_TYRE_ALLOCATION[compound] - weekendTyreUseCount(carId, compound, tyreUsage));
}
