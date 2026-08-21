import { describe, expect, it } from "vitest";
import { trackTemperatureFor } from "@/simulation/weather";

describe("track temperature", () => {
  it("warms as the track rubbers in and plateaus", () => {
    const start = trackTemperatureFor(0, 0, 0);
    const midRace = trackTemperatureFor(900, 0, 0);
    const lateRace = trackTemperatureFor(1_800, 0, 0);
    const veryLate = trackTemperatureFor(5_400, 0, 0);

    expect(midRace).toBeGreaterThan(start);
    expect(lateRace).toBeGreaterThan(midRace);
    /*
     * Evolution approaches a limit, so warming per unit time keeps falling.
     * Comparing rates rather than totals is what makes this a plateau check:
     * the later window is three times longer than the earlier one.
     */
    const earlyRate = (lateRace - midRace) / 900;
    const lateRate = (veryLate - lateRace) / 3_600;
    expect(lateRate).toBeLessThan(earlyRate);
    expect(veryLate).toBeLessThan(start + 6);
  });

  it("cools the surface when it rains and keeps it cool while wet", () => {
    const dry = trackTemperatureFor(1_800, 0, 0);
    const raining = trackTemperatureFor(1_800, 0.6, 0.5);
    const wetAfterRain = trackTemperatureFor(1_800, 0, 0.5);

    expect(raining).toBeLessThan(dry);
    expect(wetAfterRain).toBeLessThan(dry);
    // Active rain cools harder than the standing water it leaves behind.
    expect(raining).toBeLessThan(wetAfterRain);
  });

  it("responds to forecast cloud cover before rain reaches the surface", () => {
    const clear = trackTemperatureFor(900, 0, 0, 0);
    const laterClear = trackTemperatureFor(1_800, 0, 0, 0);
    const clouded = trackTemperatureFor(1_800, 0, 0, 0.85);

    expect(laterClear).not.toBeCloseTo(clear, 2);
    expect(clouded).toBeLessThan(laterClear);
  });

  it("never reports an implausible surface temperature", () => {
    for (const elapsed of [0, 600, 1_800, 7_200]) {
      for (const rain of [0, 0.5, 1]) {
        for (const wetness of [0, 0.5, 1]) {
          const temperature = trackTemperatureFor(elapsed, rain, wetness);
          expect(temperature).toBeGreaterThanOrEqual(12);
          expect(temperature).toBeLessThanOrEqual(40);
        }
      }
    }
  });
});
