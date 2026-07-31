import type { BattleStatus, EnergyMode, PaceMode, RaceCarState, RaceControlStatus, RacingLineMode, WeatherState } from "@/domain/race";
import { normalizeLapDistance, SILVERSTONE_CIRCUIT, SILVERSTONE_WING_ZONES, wingZoneAtDistance } from "@/simulation/track";

export type RacecraftIntent = "ATTACK" | "DEFEND" | "HARVEST" | "HOLD";

export interface RacecraftContext {
  raceControl: RaceControlStatus;
  weather: WeatherState;
  cars: readonly RaceCarState[];
}

export interface RacecraftDecision {
  carId: string;
  intent: RacecraftIntent;
  targetCarId: string | null;
  threatCarId: string | null;
  battleStatus: BattleStatus;
  recommendedPaceMode: PaceMode;
  recommendedEnergyMode: EnergyMode;
  recommendedRacingLineMode: RacingLineMode;
  /** The simulator intentionally keeps every car on the single visual centre line. */
  trackLineOffset: 0;
  overtakeProbability: number;
  defenceProbability: number;
  closingRateKph: number;
  predictedGapInThreeSeconds: number | null;
  timeToAttackSeconds: number | null;
  dirtyAirCostSecondsPerLap: number;
  confidence: number;
  reasons: readonly string[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function orderedActiveCars(cars: readonly RaceCarState[]): RaceCarState[] {
  return [...cars]
    .filter((car) => !car.finished && car.incidentStatus !== "RETIRED")
    .sort((a, b) => a.racePosition - b.racePosition || b.totalDistance - a.totalDistance || a.carId.localeCompare(b.carId));
}

function speedDelta(attacker: RaceCarState, defender: RaceCarState | undefined): number {
  return defender ? attacker.currentSpeed - defender.currentSpeed : 0;
}

function inactiveRacecraftDecision(car: RaceCarState): RacecraftDecision {
  const retired = car.incidentStatus === "RETIRED";
  return {
    carId: car.carId,
    intent: "HOLD",
    targetCarId: null,
    threatCarId: null,
    battleStatus: "CLEAR",
    recommendedPaceMode: "STANDARD",
    recommendedEnergyMode: "BALANCED",
    recommendedRacingLineMode: "RACING",
    trackLineOffset: 0,
    overtakeProbability: 0,
    defenceProbability: 0,
    closingRateKph: 0,
    predictedGapInThreeSeconds: null,
    timeToAttackSeconds: null,
    dirtyAirCostSecondsPerLap: 0,
    confidence: 1,
    reasons: [retired ? "Car retired; racecraft commands are unavailable." : "Race complete; racecraft commands are unavailable."],
  };
}

function calculateActiveRacecraftDecision(context: RacecraftContext, field: readonly RaceCarState[], index: number): RacecraftDecision {
  const car = field[index];
  const ahead = field[index - 1];
  const behind = field[index + 1];
  const green = context.raceControl === "GREEN" && car.pitStatus === "TRACK" && car.incidentStatus === "RUNNING";
  const segment = SILVERSTONE_CIRCUIT.segments[car.currentSegment];
  const lowGrip = context.weather.trackWetness > 0.42;
  const gapAhead = ahead ? car.gapToCarAhead : Infinity;
  const gapBehind = behind ? car.gapToCarBehind : Infinity;
  const closingRateKph = speedDelta(car, ahead);
  const rearClosingRateKph = behind ? behind.currentSpeed - car.currentSpeed : 0;
  const predictedGapInThreeSeconds = ahead
    ? Math.max(0, gapAhead - (closingRateKph / Math.max(40, car.currentSpeed)) * 3)
    : null;
  const timeToAttackSeconds = ahead && closingRateKph > 0.5
    ? clamp((gapAhead * Math.max(40, car.currentSpeed) / closingRateKph), 0, 99)
    : null;
  const deploymentWindow = segment.kind === "STRAIGHT" || segment.kind === "FAST";
  const overtakeProbability = !green || !ahead ? 0 : clamp(
    0.1
      + (1.35 - Math.min(1.35, gapAhead)) * 0.42
      + Math.max(-10, Math.min(25, closingRateKph)) * 0.012
      + (car.batteryPercent - 20) * 0.004
      + (deploymentWindow ? 0.12 : -0.06)
      - (lowGrip ? 0.12 : 0)
      - car.dirtyAirLoss * 8,
    0,
    0.97,
  );
  const defenceProbability = !green || !behind ? 0 : clamp(
    0.08
      + (1.25 - Math.min(1.25, gapBehind)) * 0.43
      + Math.max(-8, Math.min(24, rearClosingRateKph)) * 0.012
      + (behind.batteryPercent - car.batteryPercent) * 0.003
      + (deploymentWindow ? 0.1 : 0),
    0,
    0.96,
  );

  const thermalProtection = car.thermalDeratePercent >= 2.5 || car.thermalRiskPercent >= 12;

  /*
   * Racecraft looks two cars ahead, not one. A driver who can see a train
   * forming builds a run before the gap closes rather than reacting only once
   * it is already inside a second, and a driver in the middle of a train knows
   * that attacking is pointless while the car ahead is itself blocked.
   */
  const secondAhead = field[index - 2];
  const gapToSecondAhead = ahead && secondAhead ? gapAhead + ahead.gapToCarAhead : Infinity;
  const trainAhead = Number.isFinite(gapToSecondAhead) && gapToSecondAhead <= 2.6;
  const aheadIsBlocked = Boolean(ahead && ahead.gapToCarAhead <= 1.1);
  /*
   * Closing on a car that is still 1-2.5s away is worth preparing for: build
   * charge now so the attack lands with a full battery. Only a genuinely low
   * reserve triggers this, otherwise every car in the field would spend the race
   * harvesting instead of racing.
   */
  const approachWindow = Boolean(ahead && gapAhead > 1.25 && gapAhead <= 2.6 && closingRateKph > 1.5);

  /*
   * Overtakes are set up before the straight, not on it. A car about to reach a
   * movable-aero zone with a rival inside the activation window commits early,
   * and a car whose rival is on materially worse tyres presses that advantage
   * even from a gap that would otherwise read as out of range.
   */
  const wingZone = wingZoneAtDistance(car.lapDistance);
  const nextWingZone = SILVERSTONE_WING_ZONES.find((zone) => zone.openAtMeters > normalizeLapDistance(car.lapDistance));
  const metresToWingZone = nextWingZone ? nextWingZone.openAtMeters - normalizeLapDistance(car.lapDistance) : Infinity;
  const approachingWingZone = metresToWingZone <= 320;
  const wingAttackWindow = Boolean(ahead && (wingZone || approachingWingZone) && gapAhead <= 1.0);
  // A tyre-life edge is worth using even from further back.
  const tyreAdvantage = ahead ? car.tyreLife - ahead.tyreLife : 0;
  const tyreLeverage = Boolean(ahead && tyreAdvantage >= 18 && gapAhead <= 2.0 && !aheadIsBlocked);
  // Defending into a zone means spending energy before the rival can use theirs.
  const wingDefenceWindow = Boolean(behind && (wingZone || approachingWingZone) && gapBehind <= 1.0);

  let intent: RacecraftIntent = "HOLD";
  if (!green || thermalProtection || car.batteryPercent < 18) intent = "HARVEST";
  // A zone with the rival in range outranks the generic probability test: this
  // is the one place on the lap where a pass is genuinely available.
  else if (wingAttackWindow && car.batteryPercent >= 24) intent = "ATTACK";
  else if (ahead && gapAhead <= 1.25 && overtakeProbability >= Math.max(0.38, defenceProbability + 0.05)) intent = "ATTACK";
  else if (tyreLeverage && car.batteryPercent >= 30) intent = "ATTACK";
  else if (wingDefenceWindow && car.batteryPercent >= 22) intent = "DEFEND";
  else if (behind && gapBehind <= 1.15 && defenceProbability >= 0.36) intent = "DEFEND";
  else if (approachWindow && car.batteryPercent < 34) intent = "HARVEST";

  const battleStatus: BattleStatus = !green
    ? "CLEAR"
    : ahead && gapAhead <= 0.18
      ? "SIDE_BY_SIDE"
      : intent === "ATTACK" ? "ATTACKING" : intent === "DEFEND" ? "DEFENDING" : "CLEAR";
  const recommendedPaceMode: PaceMode = intent === "ATTACK"
    // Attacking behind a blocked car burns the tyre for nothing.
    ? aheadIsBlocked && gapAhead > 0.6 ? "PUSH" : "ATTACK"
    : intent === "DEFEND" ? "PUSH"
      : intent === "HARVEST" ? (thermalProtection ? "COOL" : "CONSERVE")
        : trainAhead && closingRateKph > 0 ? "PUSH" : "STANDARD";
  /*
   * Every car uses the same three usage levels the pit wall offers: tight,
   * balanced and saving. OVERTAKE stays separate as the discrete passing boost.
   */
  const recommendedEnergyMode: EnergyMode = intent === "ATTACK"
    ? car.energySystem?.overtakeEligible ? "OVERTAKE" : "ATTACK"
    : intent === "DEFEND" ? "ATTACK"
      : intent === "HARVEST" ? "CONSERVE"
        : car.batteryPercent < 38 ? "CONSERVE" : "BALANCED";
  const recommendedRacingLineMode: RacingLineMode = intent === "ATTACK" ? "ATTACK" : intent === "DEFEND" ? "DEFEND" : "RACING";
  const dirtyAirCostSecondsPerLap = clamp(car.dirtyAirLoss * 88 + (gapAhead < 1.2 && segment.kind !== "STRAIGHT" ? (1.2 - gapAhead) * 0.18 : 0), 0, 1.8);
  const reasons: string[] = [];
  if (!green) reasons.push(`${context.raceControl.replace("_", " ")} neutralises racecraft commands.`);
  if (thermalProtection) reasons.push(`Thermal protection costs ${car.thermalDeratePercent.toFixed(1)}% power.`);
  if (car.batteryPercent < 18) reasons.push(`Energy reserve is only ${Math.round(car.batteryPercent)}%.`);
  if (intent === "ATTACK" && ahead) reasons.push(`${ahead.carId} is ${gapAhead.toFixed(3)}s ahead with ${Math.round(overtakeProbability * 100)}% pass probability.`);
  if (wingAttackWindow && ahead) reasons.push(`${wingZone ? `Inside the ${wingZone.label}` : `${Math.round(metresToWingZone)}m to the ${nextWingZone?.label}`} with ${ahead.carId} in range.`);
  if (tyreLeverage && ahead) reasons.push(`${Math.round(tyreAdvantage)}% tyre advantage over ${ahead.carId}.`);
  if (intent === "DEFEND" && behind) reasons.push(`${behind.carId} is the immediate threat at ${gapBehind.toFixed(3)}s.`);
  if (intent === "HARVEST" && approachWindow && ahead) reasons.push(`Building charge to attack ${ahead.carId} in ${gapAhead.toFixed(1)}s.`);
  if (aheadIsBlocked && ahead) reasons.push(`${ahead.carId} is itself held up; waiting for a cleaner run.`);
  if (intent === "HOLD") reasons.push("No high-value attack or defence window is open.");
  if (lowGrip) reasons.push("Low grip reduces deployment and braking confidence.");

  return {
    carId: car.carId,
    intent,
    targetCarId: ahead?.carId ?? null,
    threatCarId: behind?.carId ?? null,
    battleStatus,
    recommendedPaceMode,
    recommendedEnergyMode,
    recommendedRacingLineMode,
    trackLineOffset: 0,
    overtakeProbability,
    defenceProbability,
    closingRateKph,
    predictedGapInThreeSeconds,
    timeToAttackSeconds,
    dirtyAirCostSecondsPerLap,
    confidence: clamp(0.62 + Math.abs(overtakeProbability - defenceProbability) * 0.28 - (lowGrip ? 0.08 : 0), 0.45, 0.96),
    reasons: reasons.slice(0, 3),
  };
}

export function calculateRacecraftDecision(context: RacecraftContext, carId: string): RacecraftDecision {
  const requestedCar = context.cars.find((car) => car.carId === carId);
  if (!requestedCar) throw new RangeError(`Unknown carId: ${carId}.`);
  const field = orderedActiveCars(context.cars);
  const index = field.findIndex((car) => car.carId === carId);
  return index < 0 ? inactiveRacecraftDecision(requestedCar) : calculateActiveRacecraftDecision(context, field, index);
}

export function calculateFieldRacecraft(context: RacecraftContext): readonly RacecraftDecision[] {
  const field = orderedActiveCars(context.cars);
  return field.map((_, index) => calculateActiveRacecraftDecision(context, field, index));
}
