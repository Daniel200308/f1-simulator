import { describe, expect, it } from "vitest";

import { DRIVERS, TEAMS } from "@/fixtures/grid";

describe("2026 Formula 1 grid fixture", () => {
  it("contains 11 two-car teams and 22 unique drivers", () => {
    expect(TEAMS).toHaveLength(11);
    expect(DRIVERS).toHaveLength(22);
    expect(new Set(DRIVERS.map((driver) => driver.id)).size).toBe(22);
    expect(TEAMS.every((team) => DRIVERS.filter((driver) => driver.teamId === team.id).length === 2)).toBe(true);
  });

  it("uses unique official three-letter abbreviations", () => {
    expect(new Set(DRIVERS.map((driver) => driver.shortName)).size).toBe(22);
    expect(DRIVERS.every((driver) => /^[A-Z]{3}$/.test(driver.shortName))).toBe(true);
  });
});
