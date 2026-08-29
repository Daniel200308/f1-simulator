import { describe, expect, it } from "vitest";

import { createInitialSnapshot, stepSnapshot } from "@/simulation/engine";
import {
  createGameSave,
  createGameSaveV1,
  GAME_SAVE_SCHEMA_VERSION,
  GameSaveParseError,
  GameSaveValidationError,
  gameSaveValidationIssues,
  isGameSaveV1,
  migrateGameSave,
  parseGameSave,
  stringifyGameSave,
  UnsupportedGameSaveVersionError,
  validateGameSave,
} from "@/simulation/game-save";
import { createWeekendState, runWeekendSession } from "@/simulation/weekend";
import { createChampionship } from "@/simulation/championship";
import { createReliabilityState } from "@/simulation/reliability";

const SAVED_AT = "2026-08-13T09:30:15.125Z";

function representativeSave() {
  const seed = 20_260_813;
  const playerTeamId = "mclaren";
  let weekendState = createWeekendState(seed, playerTeamId);
  weekendState = runWeekendSession(weekendState);
  weekendState = runWeekendSession(weekendState);
  const raceSnapshot = stepSnapshot(createInitialSnapshot(
    seed,
    "RUNNING",
    weekendState.gridOrder,
    weekendState.tyreUsage,
    undefined,
    playerTeamId,
    weekendState.tyreInventory,
  ));
  return createGameSave({ savedAt: SAVED_AT, raceSnapshot, weekendState });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("versioned game saves", () => {
  it("creates a detached, JSON-serializable GameSaveV1 without reading ambient time", () => {
    const save = representativeSave();

    expect(save.schemaVersion).toBe(GAME_SAVE_SCHEMA_VERSION);
    expect(save.savedAt).toBe(SAVED_AT);
    expect(save.raceSnapshot.seed).toBe(save.weekendState.seed);
    expect(save.raceSnapshot.playerTeamId).toBe("mclaren");
    expect(isGameSaveV1(save)).toBe(true);
    expect(validateGameSave(save)).toBe(save);
    expect(gameSaveValidationIssues(save)).toEqual([]);
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
    expect(JSON.stringify(save)).not.toContain("brakeBiasPercent");
    expect(createGameSaveV1({
      savedAt: save.savedAt,
      raceSnapshot: save.raceSnapshot,
      weekendState: save.weekendState,
    })).toEqual(save);
  });

  it("round-trips deterministically and produces stable JSON key ordering", () => {
    const save = representativeSave();
    const first = stringifyGameSave(save);
    const restored = parseGameSave(first);
    const second = stringifyGameSave(restored);

    expect(restored).toEqual(save);
    expect(second).toBe(first);
    expect(stringifyGameSave(save)).toBe(first);
  });

  it("accepts fractional live tyre age and set usage accumulated during a lap", () => {
    const base = representativeSave();
    const raceSnapshot = {
      ...base.raceSnapshot,
      cars: base.raceSnapshot.cars.map((car, index) => index === 0 ? {
        ...car,
        tyreAgeLaps: 1.375,
        tyreSets: car.tyreSets.map((set) => set.id === car.activeTyreSetId ? { ...set, lapsUsed: 1.375 } : set),
      } : car),
    };
    const save = createGameSave({ savedAt: base.savedAt, raceSnapshot, weekendState: base.weekendState });

    expect(parseGameSave(stringifyGameSave(save)).raceSnapshot.cars[0].tyreAgeLaps).toBe(1.375);
  });

  it("validates and round-trips championship and component state", () => {
    const base = representativeSave();
    const save = createGameSave({
      savedAt: base.savedAt,
      raceSnapshot: base.raceSnapshot,
      weekendState: base.weekendState,
      championshipState: createChampionship(),
      reliabilityState: createReliabilityState(),
    });

    expect(parseGameSave(stringifyGameSave(save))).toEqual(save);
    const corrupt = jsonClone(save) as unknown as Record<string, unknown>;
    (((corrupt.reliabilityState as Record<string, unknown>).components as Record<string, unknown>).ICE as Record<string, unknown>).health = 110;
    expect(() => validateGameSave(corrupt)).toThrow(/components\.ICE\.health/);
    const badSeason = jsonClone(save) as unknown as Record<string, unknown>;
    (badSeason.championshipState as Record<string, unknown>).nextRoundIndex = 2;
    expect(() => validateGameSave(badSeason)).toThrow(/number of recorded results/);
  });

  it("keeps migration behind one non-mutating entry point", () => {
    const save = representativeSave();
    const original = jsonClone(save);

    expect(migrateGameSave(save)).toBe(save);
    expect(save).toEqual(original);
    expect(() => migrateGameSave({ ...save, schemaVersion: 2 })).toThrow(UnsupportedGameSaveVersionError);
    expect(() => migrateGameSave({ ...save, schemaVersion: 0 })).toThrow(/Unsupported game save schema version: 0/);
  });

  it("removes the retired brake-balance field from legacy saves", () => {
    const legacy = jsonClone(representativeSave()) as unknown as Record<string, unknown>;
    const raceSnapshot = legacy.raceSnapshot as Record<string, unknown>;
    const cars = raceSnapshot.cars as Array<Record<string, unknown>>;
    cars.forEach((car) => { car.brakeBiasPercent = 61; });

    const restored = parseGameSave(JSON.stringify(legacy));
    expect(restored.raceSnapshot.cars.every((car) => !("brakeBiasPercent" in car))).toBe(true);
    expect(stringifyGameSave(legacy)).not.toContain("brakeBiasPercent");
    expect(cars.every((car) => car.brakeBiasPercent === 61)).toBe(true);
  });

  it("rejects malformed JSON and unsupported versions safely", () => {
    expect(() => parseGameSave("{not-json" )).toThrow(GameSaveParseError);
    expect(() => parseGameSave(JSON.stringify({ schemaVersion: 999 }))).toThrow(UnsupportedGameSaveVersionError);
    expect(() => parseGameSave(JSON.stringify({ schemaVersion: "1" }))).toThrow(GameSaveValidationError);
  });

  it("rejects corrupt required and nested race data with actionable paths", () => {
    const missingCars = jsonClone(representativeSave()) as unknown as Record<string, unknown>;
    (missingCars.raceSnapshot as Record<string, unknown>).cars = null;
    expect(() => validateGameSave(missingCars)).toThrow(GameSaveValidationError);
    expect(gameSaveValidationIssues(missingCars)).toContainEqual({
      path: "$.raceSnapshot.cars",
      message: "must be an array",
    });

    const badCar = jsonClone(representativeSave());
    (badCar.raceSnapshot.cars[0] as unknown as Record<string, unknown>).tyreTemperatures = { frontLeft: "hot" };
    expect(() => parseGameSave(JSON.stringify(badCar))).toThrow(/tyreTemperatures\.frontLeft/);
  });

  it("rejects corrupt weekend data and cross-state identity mismatches", () => {
    const badWeekend = jsonClone(representativeSave());
    (badWeekend.weekendState.setups[badWeekend.weekendState.gridOrder[0]] as unknown as Record<string, unknown>).frontWing = 500;
    expect(() => validateGameSave(badWeekend)).toThrow(/frontWing/);

    const seedMismatch = jsonClone(representativeSave());
    seedMismatch.weekendState.seed += 1;
    expect(() => validateGameSave(seedMismatch)).toThrow(/must match raceSnapshot\.seed/);

    const teamMismatch = jsonClone(representativeSave());
    teamMismatch.weekendState.playerTeamId = "ferrari";
    expect(() => validateGameSave(teamMismatch)).toThrow(/must match raceSnapshot\.playerTeamId/);

    const duplicateGrid = jsonClone(representativeSave());
    const mutableGrid = duplicateGrid.weekendState.gridOrder as string[];
    mutableGrid[1] = mutableGrid[0];
    expect(() => validateGameSave(duplicateGrid)).toThrow(/duplicate car IDs/);
  });

  it("rejects values that JSON would silently lose or coerce", () => {
    const undefinedValue = representativeSave() as unknown as Record<string, unknown>;
    undefinedValue.extra = undefined;
    expect(() => stringifyGameSave(undefinedValue)).toThrow(/non-JSON value undefined/);

    const nonFinite = jsonClone(representativeSave());
    nonFinite.raceSnapshot.elapsedTime = Number.NaN;
    expect(() => stringifyGameSave(nonFinite)).toThrow(/non-finite number/);

    const circular = representativeSave() as unknown as Record<string, unknown>;
    circular.loop = circular;
    expect(() => stringifyGameSave(circular)).toThrow(/circular reference/);
  });

  it("rejects invalid timestamps and unknown root fields", () => {
    const invalidTimestamp = { ...representativeSave(), savedAt: "today" };
    expect(() => validateGameSave(invalidTimestamp)).toThrow(/UTC ISO-8601/);

    const unknownRoot = { ...representativeSave(), debug: true };
    expect(() => validateGameSave(unknownRoot)).toThrow(/not part of the GameSaveV1 schema/);
  });
});
