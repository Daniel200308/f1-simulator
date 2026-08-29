import { describe, expect, it } from "vitest";

import type { WeekendTyreUsage } from "@/domain/race";
import { DRIVERS } from "@/fixtures/grid";
import { createInitialSnapshot, setCarStartingTyre } from "@/simulation/engine";
import {
  chooseRaceStartTyreSet,
  completeWeekendTyreRun,
  createWeekendTyreInventory,
  FIA_2026_STANDARD_TYRE_ALLOCATION,
  fitWeekendTyreSet,
  raceStartTyreInventory,
  raceStartTyreSetsFor,
  reserveWeekendTyreSet,
  weekendTyreUsageFromInventory,
} from "@/simulation/tyre-allocation";

describe("2026 race-start tyre allocation", () => {
  it("uses the FIA standard-format allocation for every driver", () => {
    expect(FIA_2026_STANDARD_TYRE_ALLOCATION).toEqual({
      SOFT: 6,
      MEDIUM: 4,
      HARD: 2,
      INTERMEDIATE: 2,
      WET: 2,
    });
    expect(raceStartTyreInventory("ferrari-1")).toHaveLength(16);
  });

  it("keeps used qualifying softs selectable when no new soft remains", () => {
    const usage: WeekendTyreUsage = { "ferrari-1": { SOFT: 6 } };
    const softs = raceStartTyreSetsFor("ferrari-1", "SOFT", usage);
    expect(softs).toHaveLength(6);
    expect(softs.every((set) => set.freshness === "USED")).toBe(true);
    expect(chooseRaceStartTyreSet("ferrari-1", "SOFT", usage).freshness).toBe("USED");
  });

  it("persists an exact physical set and its wear across qualifying sessions", () => {
    const carId = "ferrari-1";
    const initial = createWeekendTyreInventory(DRIVERS.map((driver) => driver.id));
    const selected = raceStartTyreSetsFor(carId, "SOFT", initial)[0];
    const fitted = fitWeekendTyreSet(initial, carId, selected.id, "Q1");
    const returned = completeWeekendTyreRun(fitted, carId, selected.id, "Q1", 88, 2);
    const q2Set = raceStartTyreSetsFor(carId, "SOFT", returned).find((set) => set.id === selected.id)!;
    expect(q2Set).toMatchObject({ freshness: "USED", condition: 88, lapsUsed: 2 });
    expect(returned[carId].find((set) => set.id === selected.id)?.sessionHistory).toEqual(["Q1"]);
  });

  it("passes the same qualifying-worn set and exact life into race preparation", () => {
    const carId = "ferrari-1";
    const initial = createWeekendTyreInventory(DRIVERS.map((driver) => driver.id));
    const selected = raceStartTyreSetsFor(carId, "SOFT", initial)[0];
    const used = completeWeekendTyreRun(fitWeekendTyreSet(initial, carId, selected.id, "Q1"), carId, selected.id, "Q1", 87, 2);
    const reserved = reserveWeekendTyreSet(used, carId, selected.id);
    const snapshot = createInitialSnapshot(20_260_831, "PAUSED", undefined, weekendTyreUsageFromInventory(reserved), undefined, "ferrari", reserved);
    const prepared = setCarStartingTyre(snapshot, carId, "SOFT", selected.id);
    const car = prepared.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.activeTyreSetId).toBe(selected.id);
    expect(car.tyreLife).toBe(87);
    expect(car.tyreAgeLaps).toBe(2);
  });

  it("fits the exact selected qualifying-used set with its remaining life", () => {
    const carId = "ferrari-1";
    const usage: WeekendTyreUsage = { [carId]: { SOFT: 3 } };
    const selected = raceStartTyreSetsFor(carId, "SOFT", usage).find((set) => set.freshness === "USED")!;
    const initial = createInitialSnapshot(20_260_720, "PAUSED", undefined, usage);
    const prepared = setCarStartingTyre(initial, carId, selected.compound, selected.id);
    const car = prepared.cars.find((candidate) => candidate.carId === carId)!;
    expect(car.activeTyreSetId).toBe(selected.id);
    expect(car.tyreCompound).toBe("SOFT");
    expect(car.tyreLife).toBe(selected.condition);
    expect(car.tyreAgeLaps).toBe(selected.lapsUsed);
    expect(car.tyreSets.filter((set) => set.status === "FITTED")).toHaveLength(1);
  });
});
