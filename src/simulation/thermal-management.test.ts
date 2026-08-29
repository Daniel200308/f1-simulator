import { describe, expect, it } from "vitest";

import { createInitialSnapshot } from "@/simulation/engine";
import { advanceBrakeTemperatures, advanceThermalStress, assessVehicleThermals, thermalPerformanceFactor, tyreThermalSeverity } from "@/simulation/thermal-management";

describe("thermal management", () => {
  it("raises a critical power-unit alert and derates an overheated car", () => {
    const car = createInitialSnapshot().cars[0];
    const hotCar = { ...car, powerUnitTemperature: 131, powerUnitStress: 82 };
    const assessment = assessVehicleThermals(hotCar);
    expect(assessment.severity).toBe("CRITICAL");
    expect(assessment.alerts.some((alert) => alert.system === "POWER_UNIT" && alert.action === "LIFT_AND_COAST")).toBe(true);
    expect(assessment.deratePercent).toBeGreaterThan(4);
    expect(thermalPerformanceFactor(hotCar)).toBeLessThan(0.96);
  });

  it("uses the fixed default braking distribution for brake heat", () => {
    const start = { frontLeft: 500, frontRight: 500, rearLeft: 500, rearRight: 500 };
    const result = advanceBrakeTemperatures(start, {
      previousSpeedKph: 300,
      currentSpeedKph: 150,
      segmentKind: "SLOW",
      cornerIntensity: 0,
      hotterSide: null,
      localWater: 0,
      airTemperature: 22,
      pitStopped: false,
      coolingMode: "NORMAL",
    }, 1);
    expect(result.frontLeft).toBeGreaterThan(result.rearLeft);
    expect(result.frontRight).toBeGreaterThan(result.rearRight);
  });

  it("builds stress above the warning threshold and recovers when cool", () => {
    const hot = advanceThermalStress(10, 128, 118, 125, 1);
    const recovered = advanceThermalStress(hot, 95, 118, 125, 1);
    expect(hot).toBeGreaterThan(10);
    expect(recovered).toBeLessThan(hot);
  });

  it("uses one tyre warning scale for alerts and the vehicle map", () => {
    expect(tyreThermalSeverity(116, "MEDIUM")).toBe("WARNING");
    expect(tyreThermalSeverity(122, "MEDIUM")).toBe("CRITICAL");
  });
});
