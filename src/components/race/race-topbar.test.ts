import { describe, expect, it } from "vitest";

import { getTrackFlagDisplay } from "@/components/race/race-topbar";
import { createInitialSnapshot } from "@/simulation/engine";

describe("race topbar track flag", () => {
  it("limits the dominant label to broadcast race-control states", () => {
    const initial = createInitialSnapshot(91);
    expect(getTrackFlagDisplay(initial).label).toBe("GREEN");
    expect(getTrackFlagDisplay({ ...initial, raceControl: "YELLOW", yellowSector: 2 }).label).toBe("YELLOW");
    expect(getTrackFlagDisplay({ ...initial, raceControl: "VSC" }).label).toBe("VIRTUAL SAFETY CAR");
    expect(getTrackFlagDisplay({ ...initial, raceControl: "SAFETY_CAR", safetyCarPhase: "BUNCHING" }).label).toBe("SAFETY CAR");
    expect(getTrackFlagDisplay({ ...initial, raceControl: "SAFETY_CAR", safetyCarPhase: "RESTART" }).label).toBe("SAFETY CAR ENDING");
    expect(getTrackFlagDisplay(initial, true)).toMatchObject({ label: "RED FLAG", tone: "red" });
    expect(getTrackFlagDisplay(initial, false, true)).toMatchObject({ label: "CHEQUERED", tone: "chequered" });
    expect(getTrackFlagDisplay({ ...initial, status: "FINISHED" })).toMatchObject({ label: "CHEQUERED", key: "chequered" });
    expect(getTrackFlagDisplay({ ...initial, status: "FINISHED", raceControl: "RED_FLAG" })).toMatchObject({ label: "RED FLAG", tone: "red" });
  });
});
