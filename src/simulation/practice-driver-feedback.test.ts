import { describe, expect, it } from "vitest";
import { buildSessionDriverMessage, practiceMoodFor } from "@/simulation/message-library";

const BASE = {
  seed: 20_260_801,
  carIndex: 3,
  sessionIndex: 1,
  session: "FP2",
  phase: "PRACTICE" as const,
  outcome: "COMPLETE" as const,
  driverShortName: "LEC",
  position: 7,
  laps: 22,
  gapSeconds: 0.62,
  balanceIssue: "high-speed understeer",
  tyreConditionPercent: 74,
  aeroBalancePercent: 70,
  mechanicalBalancePercent: 70,
  thermalMarginPercent: 70,
  bestLapSeconds: 89.4,
};

const GOOD = { ...BASE, aeroBalancePercent: 99, mechanicalBalancePercent: 98, thermalMarginPercent: 99, position: 2, balanceIssue: "a stable mechanical platform" };
const BAD = { ...BASE, aeroBalancePercent: 32, mechanicalBalancePercent: 29, thermalMarginPercent: 34, position: 18 };

describe("practice driver feedback", () => {
  it("sounds pleased when the car is in its window", () => {
    expect(practiceMoodFor(GOOD)).toBe("DELIGHTED");
    const message = buildSessionDriverMessage(GOOD);
    expect(message).toMatch(/enjoy|love|happy|superb|brilliant|pleasure|joy|smiling|best|fantastic|strong/i);
  });

  it("sounds annoyed when the car will not do what the driver asks", () => {
    expect(practiceMoodFor(BAD)).toBe("ANGRY");
    const message = buildSessionDriverMessage(BAD);
    expect(message).toMatch(/horrible|unacceptable|angry|hated|awful|furious|dreadful|terrible|undriveable|confidence|mess|fighting|enough/i);
  });

  it("moves through the mood range as the car moves away from its window", () => {
    const moods = [100, 88, 72, 55, 30].map((balance) => practiceMoodFor({
      ...BASE,
      aeroBalancePercent: balance,
      mechanicalBalancePercent: balance,
      thermalMarginPercent: balance,
    }));
    // Every tier is reachable, so feedback is not stuck on one tone.
    expect(new Set(moods).size).toBe(5);
  });

  it("never accuses an efficiency-limited car of being undriveable", () => {
    for (const balanceIssue of ["straight-line drag", "excess cooling drag"]) {
      const mood = practiceMoodFor({ ...BAD, balanceIssue });
      expect(mood).not.toBe("ANGRY");
      // The complaint is about lost speed rather than lost confidence.
      expect(buildSessionDriverMessage({ ...BAD, balanceIssue })).not.toMatch(/undriveable|no grip/i);
    }
  });

  it("produces a wide spread of practice reactions", () => {
    const messages = new Set<string>();
    const issues = [
      "high-speed understeer",
      "rear instability over kerbs",
      "a stable mechanical platform",
      "restricted cooling margin",
      "straight-line drag",
      "platform movement through direction changes",
    ];
    for (let seed = 1; seed <= 120; seed += 1) {
      for (const balanceIssue of issues) {
        messages.add(buildSessionDriverMessage({
          ...BASE,
          seed,
          carIndex: seed % 22,
          sessionIndex: seed % 3,
          laps: 12 + (seed % 20),
          position: (seed % 20) + 1,
          balanceIssue,
          aeroBalancePercent: 30 + (seed % 70),
          mechanicalBalancePercent: 28 + (seed % 72),
          thermalMarginPercent: 32 + (seed % 68),
        }));
      }
    }
    expect(messages.size).toBeGreaterThan(300);
    // The debrief cards clamp to three lines, so the reaction has to stay short.
    expect([...messages].every((message) => message.length < 330)).toBe(true);
  });

  it("keeps the qualifying voice unchanged", () => {
    const message = buildSessionDriverMessage({ ...BASE, phase: "QUALIFYING", outcome: "ADVANCED", session: "Q2" });
    expect(message.length).toBeGreaterThan(30);
    expect(message.length).toBeLessThan(330);
  });
});
