import type { CoolingMode, RaceCarState, SegmentKind, TyreCompound, TyreTemperatureState } from "@/domain/race";

export type ThermalSeverity = "NOMINAL" | "WARNING" | "CRITICAL";
export type ThermalSystem = "TYRES" | "BRAKES" | "POWER_UNIT" | "GEARBOX" | "ENERGY_STORE";
export type ThermalAction = "TYRE_COOL" | "BRAKE_COOL" | "LIFT_AND_COAST" | "RECHARGE" | "BOX";

export interface ThermalAlert {
  id: string;
  system: ThermalSystem;
  severity: Exclude<ThermalSeverity, "NOMINAL">;
  title: string;
  message: string;
  action: ThermalAction;
  actionLabel: string;
}

export interface ThermalAssessment {
  severity: ThermalSeverity;
  alerts: readonly ThermalAlert[];
  deratePercent: number;
  reliabilityRiskPercent: number;
}

export const THERMAL_THRESHOLDS = {
  brakes: { warning: 900, critical: 1_050, cold: 350 },
  powerUnit: { warning: 118, critical: 125 },
  gearbox: { warning: 110, critical: 120 },
  energyStore: { warning: 55, critical: 63 },
} as const;

export const TYRE_TEMPERATURE_WINDOWS: Record<TyreCompound, readonly [number, number]> = {
  SOFT: [92, 108],
  MEDIUM: [90, 105],
  HARD: [87, 102],
  INTERMEDIATE: [70, 90],
  WET: [60, 80],
};

export function tyreThermalSeverity(temperature: number, compound: TyreCompound): ThermalSeverity {
  const [, maximum] = TYRE_TEMPERATURE_WINDOWS[compound];
  if (temperature > maximum + 16) return "CRITICAL";
  if (temperature > maximum + 8) return "WARNING";
  return "NOMINAL";
}

const severityRank: Record<ThermalSeverity, number> = { NOMINAL: 0, WARNING: 1, CRITICAL: 2 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function averageCornerTemperature(temperatures: TyreTemperatureState): number {
  return (temperatures.frontLeft + temperatures.frontRight + temperatures.rearLeft + temperatures.rearRight) / 4;
}

function severityFor(value: number, warning: number, critical: number): ThermalSeverity {
  if (value > critical) return "CRITICAL";
  if (value > warning) return "WARNING";
  return "NOMINAL";
}

function hottestSeverity(...severities: ThermalSeverity[]): ThermalSeverity {
  return severities.reduce((highest, severity) => severityRank[severity] > severityRank[highest] ? severity : highest, "NOMINAL");
}

function alertFor(
  system: ThermalSystem,
  severity: ThermalSeverity,
  value: number,
): ThermalAlert | null {
  if (severity === "NOMINAL") return null;
  const criticalAlert = severity === "CRITICAL";
  if (system === "BRAKES") return {
    id: `brakes-${severity.toLowerCase()}`,
    system,
    severity,
    title: criticalAlert ? "BRAKE OVERHEAT" : "BRAKES RUNNING HOT",
    message: `${Math.round(value)}°C · ${criticalAlert ? "fade and reliability risk" : "cooling margin reduced"}`,
    action: criticalAlert ? "BOX" : "BRAKE_COOL",
    actionLabel: criticalAlert ? "PREPARE BOX" : "BRAKE COOL",
  };
  if (system === "POWER_UNIT") return {
    id: `power-unit-${severity.toLowerCase()}`,
    system,
    severity,
    title: criticalAlert ? "PU PROTECTION ACTIVE" : "POWER UNIT HOT",
    message: `${value.toFixed(1)}°C · ${criticalAlert ? "automatic power derate" : "lift required"}`,
    action: "LIFT_AND_COAST",
    actionLabel: criticalAlert ? "MAX COOLING" : "LIFT & COAST",
  };
  if (system === "GEARBOX") return {
    id: `gearbox-${severity.toLowerCase()}`,
    system,
    severity,
    title: criticalAlert ? "GEARBOX CRITICAL" : "GEARBOX HOT",
    message: `${value.toFixed(1)}°C · shift protection ${criticalAlert ? "active" : "standby"}`,
    action: "LIFT_AND_COAST",
    actionLabel: criticalAlert ? "MAX COOLING" : "LIFT & COAST",
  };
  return {
    id: `energy-store-${severity.toLowerCase()}`,
    system,
    severity,
    title: criticalAlert ? "ENERGY STORE CRITICAL" : "BATTERY HOT",
    message: `${value.toFixed(1)}°C · deployment ${criticalAlert ? "limited" : "at risk"}`,
    action: "RECHARGE",
    actionLabel: "RECHARGE",
  };
}

export function assessVehicleThermals(car: RaceCarState): ThermalAssessment {
  const brakes = car.brakeTemperatures ?? {
    frontLeft: car.brakeTemperature,
    frontRight: car.brakeTemperature,
    rearLeft: car.brakeTemperature,
    rearRight: car.brakeTemperature,
  };
  const hottestBrake = Math.max(brakes.frontLeft, brakes.frontRight, brakes.rearLeft, brakes.rearRight);
  const hottestTyre = Math.max(car.tyreTemperatures.frontLeft, car.tyreTemperatures.frontRight, car.tyreTemperatures.rearLeft, car.tyreTemperatures.rearRight);
  const [, tyreMaximum] = TYRE_TEMPERATURE_WINDOWS[car.tyreCompound];
  const tyreSeverity = tyreThermalSeverity(hottestTyre, car.tyreCompound);
  const brakeSeverity = severityFor(hottestBrake, THERMAL_THRESHOLDS.brakes.warning, THERMAL_THRESHOLDS.brakes.critical);
  const powerUnitSeverity = severityFor(car.powerUnitTemperature, THERMAL_THRESHOLDS.powerUnit.warning, THERMAL_THRESHOLDS.powerUnit.critical);
  const gearboxSeverity = severityFor(car.gearboxTemperature, THERMAL_THRESHOLDS.gearbox.warning, THERMAL_THRESHOLDS.gearbox.critical);
  const energyStoreSeverity = severityFor(car.energyStoreTemperature, THERMAL_THRESHOLDS.energyStore.warning, THERMAL_THRESHOLDS.energyStore.critical);
  const alerts: ThermalAlert[] = [];

  if (tyreSeverity !== "NOMINAL") alerts.push({
    id: `tyres-${tyreSeverity.toLowerCase()}`,
    system: "TYRES",
    severity: tyreSeverity,
    title: tyreSeverity === "CRITICAL" ? "TYRE TEMPERATURE CRITICAL" : "TYRES OVERHEATING",
    message: `${Math.round(hottestTyre)}°C · ${car.tyreCompound} window ends at ${tyreMaximum}°C`,
    action: tyreSeverity === "CRITICAL" ? "BOX" : "TYRE_COOL",
    actionLabel: tyreSeverity === "CRITICAL" ? "PREPARE BOX" : "TYRE COOL",
  });
  const systemAlerts = [
    alertFor("BRAKES", brakeSeverity, hottestBrake),
    alertFor("POWER_UNIT", powerUnitSeverity, car.powerUnitTemperature),
    alertFor("GEARBOX", gearboxSeverity, car.gearboxTemperature),
    alertFor("ENERGY_STORE", energyStoreSeverity, car.energyStoreTemperature),
  ].filter((alert): alert is ThermalAlert => alert !== null);
  alerts.push(...systemAlerts);

  const severity = hottestSeverity(tyreSeverity, brakeSeverity, powerUnitSeverity, gearboxSeverity, energyStoreSeverity);
  const rawDerate = Math.max(
    Math.max(0, car.powerUnitTemperature - THERMAL_THRESHOLDS.powerUnit.warning) * 0.42,
    Math.max(0, car.gearboxTemperature - THERMAL_THRESHOLDS.gearbox.warning) * 0.28,
    Math.max(0, car.energyStoreTemperature - THERMAL_THRESHOLDS.energyStore.warning) * 0.22,
    Math.max(0, hottestBrake - THERMAL_THRESHOLDS.brakes.warning) * 0.012,
  );
  const stress = Math.max(car.powerUnitStress ?? 0, car.gearboxStress ?? 0, car.energyStoreStress ?? 0, car.brakeStress ?? 0);
  const deratePercent = clamp(rawDerate + Math.max(0, stress - 65) * 0.08, 0, 9.5);
  const reliabilityRiskPercent = clamp(
    (car.powerUnitStress ?? 0) * 0.18
      + (car.gearboxStress ?? 0) * 0.12
      + (car.energyStoreStress ?? 0) * 0.1
      + (car.brakeStress ?? 0) * 0.08,
    0,
    42,
  );

  return { severity, alerts, deratePercent, reliabilityRiskPercent };
}

export interface BrakeThermalContext {
  previousSpeedKph: number;
  currentSpeedKph: number;
  segmentKind: SegmentKind;
  cornerIntensity: number;
  hotterSide: "LEFT" | "RIGHT" | null;
  localWater: number;
  airTemperature: number;
  pitStopped: boolean;
  brakeBiasPercent: number;
  coolingMode: CoolingMode;
}

export function advanceBrakeTemperatures(
  current: TyreTemperatureState,
  context: BrakeThermalContext,
  stepSeconds: number,
): TyreTemperatureState {
  const brakingRate = Math.max(0, context.previousSpeedKph - context.currentSpeedKph) / Math.max(0.01, stepSeconds);
  const segmentBase = context.segmentKind === "SLOW" ? 820 : context.segmentKind === "MEDIUM" ? 690 : context.segmentKind === "FAST" ? 560 : 430;
  const brakingHeat = clamp(brakingRate * 4.6, 0, 285);
  const cooling = context.coolingMode === "MAX_COOLING" ? 105 : context.coolingMode === "LIFT_AND_COAST" ? 58 : 0;
  const waterCooling = clamp(context.localWater, 0, 1) * (75 + context.currentSpeedKph * 0.22);
  const airflowCooling = clamp((context.currentSpeedKph - 120) * 0.18, 0, 38);
  const frontShare = clamp(context.brakeBiasPercent / 100, 0.50, 0.64);
  const rearShare = 1 - frontShare;
  const leftLoad = context.hotterSide === "LEFT" ? context.cornerIntensity * 42 : context.hotterSide === "RIGHT" ? -context.cornerIntensity * 18 : 0;
  const rightLoad = context.hotterSide === "RIGHT" ? context.cornerIntensity * 42 : context.hotterSide === "LEFT" ? -context.cornerIntensity * 18 : 0;
  const base = context.pitStopped ? Math.max(210, context.airTemperature + 170) : segmentBase + brakingHeat - cooling - waterCooling - airflowCooling;
  const targets: TyreTemperatureState = {
    frontLeft: base + (frontShare - 0.56) * 1_100 + leftLoad,
    frontRight: base + (frontShare - 0.56) * 1_100 + rightLoad,
    rearLeft: base - 95 + (rearShare - 0.44) * 900 + leftLoad * 0.72,
    rearRight: base - 95 + (rearShare - 0.44) * 900 + rightLoad * 0.72,
  };
  const response = context.pitStopped ? 0.022 : 0.095;
  const blend = 1 - Math.exp(-response * stepSeconds);
  const advance = (value: number, target: number) => clamp(value + (clamp(target, 180, 1_250) - value) * blend, 180, 1_250);
  return {
    frontLeft: advance(current.frontLeft, targets.frontLeft),
    frontRight: advance(current.frontRight, targets.frontRight),
    rearLeft: advance(current.rearLeft, targets.rearLeft),
    rearRight: advance(current.rearRight, targets.rearRight),
  };
}

export function advanceThermalStress(current: number, temperature: number, warning: number, critical: number, stepSeconds: number): number {
  const rate = temperature > critical
    ? 7 + (temperature - critical) * 0.18
    : temperature > warning
      ? 2.2 + (temperature - warning) * 0.08
      : temperature < warning - (warning > 200 ? 110 : 10) ? -2.8 : -1.35;
  return clamp(current + rate * stepSeconds, 0, 100);
}

export function thermalPerformanceFactor(car: RaceCarState): number {
  const assessment = assessVehicleThermals(car);
  const brakeTemperatures = car.brakeTemperatures ?? {
    frontLeft: car.brakeTemperature,
    frontRight: car.brakeTemperature,
    rearLeft: car.brakeTemperature,
    rearRight: car.brakeTemperature,
  };
  const averageBrake = averageCornerTemperature(brakeTemperatures);
  const coldBrakePenalty = averageBrake < THERMAL_THRESHOLDS.brakes.cold
    ? clamp((THERMAL_THRESHOLDS.brakes.cold - averageBrake) / 2_000, 0, 0.035)
    : 0;
  return clamp(1 - assessment.deratePercent / 100 - coldBrakePenalty, 0.87, 1);
}

export function thermalSeverityRank(severity: ThermalSeverity): number {
  return severityRank[severity];
}
