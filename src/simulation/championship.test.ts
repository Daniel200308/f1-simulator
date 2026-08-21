import { describe, expect, it } from "vitest";

import {
  ChampionshipError,
  CHAMPIONSHIP_POINTS_BY_POSITION,
  createChampionship,
  currentChampionshipRound,
  DEFAULT_CHAMPIONSHIP_CIRCUIT_IDS,
  driverStandings,
  isChampionshipComplete,
  pointsForPosition,
  recordRoundResult,
  teamStandings,
  type ChampionshipRoundResult,
  type ChampionshipState,
  type RoundClassificationEntry,
} from "@/simulation/championship";

const finished = { type: "FINISHED" } as const;

function finisher(position: number, driverId: string, teamId: string): RoundClassificationEntry {
  return { position, driverId, teamId, status: finished };
}

function retired(
  position: number,
  driverId: string,
  teamId: string,
  classified: boolean,
  reason = "Power unit",
): RoundClassificationEntry {
  return { position, driverId, teamId, status: { type: "RETIRED", classified, reason } };
}

function roundResult(
  state: ChampionshipState,
  classification: readonly RoundClassificationEntry[],
  fastestLapDriverId: string | null = null,
): ChampionshipRoundResult {
  const round = currentChampionshipRound(state);
  if (!round) throw new Error("Test attempted to add a result after the championship ended.");
  return { ...round, classification, fastestLapDriverId };
}

function expectChampionshipError(action: () => unknown, code: ChampionshipError["code"]): void {
  try {
    action();
    throw new Error(`Expected ChampionshipError ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ChampionshipError);
    expect((error as ChampionshipError).code).toBe(code);
  }
}

describe("championship points", () => {
  it("uses the requested top-ten Formula One points table", () => {
    expect(CHAMPIONSHIP_POINTS_BY_POSITION).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
    expect(Array.from({ length: 12 }, (_, index) => pointsForPosition(index + 1))).toEqual([
      25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0,
    ]);
    expect(pointsForPosition(0)).toBe(0);
    expect(pointsForPosition(1.5)).toBe(0);
  });

  it("awards one fastest-lap point only to an officially classified top-ten driver", () => {
    let championship = createChampionship({ circuitIds: ["round-a", "round-b", "round-c"] });
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(1, "winner", "team-a"),
      finisher(10, "top-ten", "team-b"),
      finisher(11, "outside", "team-c"),
    ], "top-ten"));
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(1, "winner", "team-a"),
      finisher(2, "top-ten", "team-b"),
      finisher(11, "outside", "team-c"),
    ], "outside"));
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(1, "winner", "team-a"),
      retired(10, "unclassified", "team-d", false),
      finisher(11, "outside", "team-c"),
    ], "unclassified"));

    const standings = driverStandings(championship);
    expect(standings.find((entry) => entry.driverId === "top-ten")).toMatchObject({ points: 20, fastestLaps: 1 });
    expect(standings.find((entry) => entry.driverId === "outside")).toMatchObject({ points: 0, fastestLaps: 0 });
    expect(standings.find((entry) => entry.driverId === "unclassified")).toMatchObject({ points: 0, fastestLaps: 0 });
  });

  it("scores a classified retirement but preserves finish and retirement totals", () => {
    let championship = createChampionship({ circuitIds: ["round-a"] });
    championship = recordRoundResult(championship, roundResult(championship, [
      retired(1, "classified-retirement", "team-a", true, "Gearbox"),
      retired(2, "unclassified-retirement", "team-b", false, "Collision"),
      finisher(3, "finisher", "team-c"),
    ], "classified-retirement"));

    expect(driverStandings(championship)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        driverId: "classified-retirement",
        points: 26,
        starts: 1,
        finishes: 0,
        retirements: 1,
        classifiedRetirements: 1,
        fastestLaps: 1,
      }),
      expect.objectContaining({
        driverId: "unclassified-retirement",
        points: 0,
        finishes: 0,
        retirements: 1,
        classifiedRetirements: 0,
      }),
      expect.objectContaining({ driverId: "finisher", points: 15, finishes: 1, retirements: 0 }),
    ]));
  });
});

describe("championship progression", () => {
  it("creates a three-round default schedule using circuit ids", () => {
    const championship = createChampionship();

    expect(championship.schedule.map((round) => round.circuitId)).toEqual(DEFAULT_CHAMPIONSHIP_CIRCUIT_IDS);
    expect(championship.schedule.map((round) => round.roundNumber)).toEqual([1, 2, 3]);
    expect(currentChampionshipRound(championship)).toEqual(championship.schedule[0]);
    expect(championship.status).toBe("IN_PROGRESS");
  });

  it("advances after each result and completes after the final scheduled round", () => {
    let championship = createChampionship({ circuitIds: ["one", "two", "three"] });

    for (const expectedRound of [1, 2, 3]) {
      expect(currentChampionshipRound(championship)?.roundNumber).toBe(expectedRound);
      championship = recordRoundResult(championship, roundResult(championship, [
        finisher(1, `driver-${expectedRound}`, "team-a"),
      ]));
    }

    expect(championship.nextRoundIndex).toBe(3);
    expect(championship.roundResults).toHaveLength(3);
    expect(currentChampionshipRound(championship)).toBeNull();
    expect(isChampionshipComplete(championship)).toBe(true);
    expect(championship.status).toBe("COMPLETED");
  });

  it("is idempotent for an identical duplicate and rejects a conflicting duplicate", () => {
    const initial = createChampionship({ circuitIds: ["one", "two"] });
    const result = roundResult(initial, [finisher(1, "driver-a", "team-a")], "driver-a");
    const recorded = recordRoundResult(initial, result);

    expect(recordRoundResult(recorded, {
      ...result,
      classification: [...result.classification],
    })).toBe(recorded);
    expect(recorded.roundResults).toHaveLength(1);
    expect(initial.roundResults).toHaveLength(0);

    expectChampionshipError(() => recordRoundResult(recorded, {
      ...result,
      fastestLapDriverId: null,
    }), "CONFLICTING_ROUND_RESULT");
  });

  it("rejects skipped rounds, circuit mismatches, and unscheduled rounds", () => {
    const championship = createChampionship({ circuitIds: ["one", "two"] });
    const classification = [finisher(1, "driver-a", "team-a")];

    expectChampionshipError(() => recordRoundResult(championship, {
      roundNumber: 2,
      circuitId: "two",
      classification,
      fastestLapDriverId: null,
    }), "ROUND_OUT_OF_SEQUENCE");
    expectChampionshipError(() => recordRoundResult(championship, {
      roundNumber: 1,
      circuitId: "wrong",
      classification,
      fastestLapDriverId: null,
    }), "CIRCUIT_MISMATCH");
    expectChampionshipError(() => recordRoundResult(championship, {
      roundNumber: 99,
      circuitId: "nowhere",
      classification,
      fastestLapDriverId: null,
    }), "ROUND_NOT_SCHEDULED");
  });
});

describe("championship standings", () => {
  it("aggregates driver and team points, including the fastest-lap bonus", () => {
    let championship = createChampionship({ circuitIds: ["round-a"] });
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(1, "a1", "team-a"),
      finisher(2, "b1", "team-b"),
      finisher(3, "b2", "team-b"),
      finisher(10, "a2", "team-a"),
    ], "a1"));

    expect(driverStandings(championship)[0]).toMatchObject({ driverId: "a1", points: 26, wins: 1 });
    expect(teamStandings(championship)).toEqual([
      expect.objectContaining({ rank: 1, teamId: "team-b", points: 33, wins: 0 }),
      expect.objectContaining({ rank: 2, teamId: "team-a", points: 27, wins: 1, fastestLaps: 1 }),
    ]);
  });

  it("breaks equal points by wins, then counts of each next-best finish", () => {
    let championship = createChampionship({ circuitIds: ["one", "two", "three"] });
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(1, "one-win", "team-win"),
      finisher(2, "best-second", "team-second"),
      finisher(11, "no-win", "team-no-win"),
      finisher(12, "split-scorer", "team-split"),
    ]));
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(3, "no-win", "team-no-win"),
      finisher(4, "split-scorer", "team-split"),
      finisher(11, "one-win", "team-win"),
      finisher(12, "best-second", "team-second"),
    ]));
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(5, "no-win", "team-no-win"),
      finisher(7, "split-scorer", "team-split"),
      finisher(12, "one-win", "team-win"),
      finisher(13, "best-second", "team-second"),
    ]));

    const standings = driverStandings(championship);
    expect(standings.find((entry) => entry.driverId === "one-win")?.points).toBe(25);
    expect(standings.find((entry) => entry.driverId === "no-win")?.points).toBe(25);
    expect(standings.find((entry) => entry.driverId === "best-second")?.points).toBe(18);
    expect(standings.find((entry) => entry.driverId === "split-scorer")?.points).toBe(18);
    expect(standings.findIndex((entry) => entry.driverId === "one-win"))
      .toBeLessThan(standings.findIndex((entry) => entry.driverId === "no-win"));
    expect(standings.findIndex((entry) => entry.driverId === "best-second"))
      .toBeLessThan(standings.findIndex((entry) => entry.driverId === "split-scorer"));
  });

  it("uses the stable id as the final tie-break after identical countback records", () => {
    let championship = createChampionship({ circuitIds: ["one", "two"] });
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(4, "alpha", "team-zulu"),
      finisher(5, "beta", "team-yankee"),
    ]));
    championship = recordRoundResult(championship, roundResult(championship, [
      finisher(4, "beta", "team-yankee"),
      finisher(5, "alpha", "team-zulu"),
    ]));

    expect(driverStandings(championship).map((entry) => entry.driverId)).toEqual(["alpha", "beta"]);
    expect(teamStandings(championship).map((entry) => entry.teamId)).toEqual(["team-yankee", "team-zulu"]);
  });
});

describe("championship result validation", () => {
  it("rejects duplicate positions, duplicate drivers, and an unknown fastest-lap driver", () => {
    const championship = createChampionship({ circuitIds: ["one"] });

    expectChampionshipError(() => recordRoundResult(championship, roundResult(championship, [
      finisher(1, "driver-a", "team-a"),
      finisher(1, "driver-b", "team-b"),
    ])), "DUPLICATE_POSITION");
    expectChampionshipError(() => recordRoundResult(championship, roundResult(championship, [
      finisher(1, "driver-a", "team-a"),
      finisher(2, "driver-a", "team-a"),
    ])), "DUPLICATE_DRIVER");
    expectChampionshipError(() => recordRoundResult(championship, roundResult(championship, [
      finisher(1, "driver-a", "team-a"),
    ], "missing-driver")), "UNKNOWN_FASTEST_LAP_DRIVER");
  });
});
