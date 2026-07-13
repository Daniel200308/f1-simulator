import type { RaceCarState, RaceSnapshot, TyreCompound } from "@/domain/race";
import { estimatePitLossSeconds, estimatePitOutPosition } from "@/simulation/engine";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { estimateTyreCrossover, type TyreCrossoverEstimate } from "@/simulation/tyre-crossover";

const EXPECTED_WEAR_PER_LAP: Record<TyreCompound, number> = {
  SOFT: 6.8,
  MEDIUM: 4.8,
  HARD: 3.6,
  INTERMEDIATE: 5.2,
  WET: 4.5,
};

export interface StrategyRecommendation {
  pitWindowStart: number;
  pitWindowEnd: number;
  recommendedCompound: TyreCompound;
  pitLossSeconds: number;
  predictedPosition: number;
  undercutGainSeconds: number;
  overcutRiskSeconds: number;
  estimatedTyreLapsRemaining: number;
  reason: string;
  crossover: TyreCrossoverEstimate;
}

export function strategyRecommendation(snapshot: RaceSnapshot, car: RaceCarState): StrategyRecommendation {
  const measuredWear = car.tyreAgeLaps > 1 ? (100 - car.tyreLife) / car.tyreAgeLaps : EXPECTED_WEAR_PER_LAP[car.tyreCompound];
  const wearPerLap = Math.max(2.2, measuredWear);
  const estimatedTyreLapsRemaining = Math.max(1, Math.floor((car.tyreLife - 28) / wearPerLap));
  const remainingRaceLaps = SILVERSTONE_CIRCUIT.totalLaps - car.currentLap;
  const pitWindowStart = Math.min(SILVERSTONE_CIRCUIT.totalLaps, Math.max(car.currentLap, car.currentLap + estimatedTyreLapsRemaining - 2));
  const pitWindowEnd = Math.min(SILVERSTONE_CIRCUIT.totalLaps, pitWindowStart + 3);
  const baselineCompound: TyreCompound = snapshot.weather.trackWetness > 0.62
    ? "WET"
    : snapshot.weather.trackWetness > 0.15
      ? "INTERMEDIATE"
      : remainingRaceLaps <= 16 ? "SOFT" : remainingRaceLaps <= 31 ? "MEDIUM" : "HARD";
  const availableCompounds = [...new Set(car.tyreSets.filter((set) => set.status === "AVAILABLE").map((set) => set.compound))];
  const crossover = estimateTyreCrossover({
    weather: snapshot.weather,
    currentCompound: car.tyreCompound,
    availableCompounds,
    remainingLaps: remainingRaceLaps,
    pitLossSeconds: estimatePitLossSeconds(snapshot),
  });
  const modelHasWeather = crossover.expectedWetLaps > 0.2 || car.tyreCompound === "INTERMEDIATE" || car.tyreCompound === "WET";
  const recommendedCompound = crossover.shouldPit ? crossover.recommendedCompound : modelHasWeather ? car.tyreCompound : baselineCompound;
  const tyreOffset = Math.max(0, car.tyreAgeLaps - 7) * 0.07 + Math.max(0, 52 - car.tyreLife) * 0.018;
  const undercutGainSeconds = Math.min(1.8, 0.25 + tyreOffset + (car.gapToCarAhead < 2.5 ? 0.35 : 0));
  const overcutRiskSeconds = Math.min(2.2, undercutGainSeconds * 0.72 + (car.tyreLife < 45 ? 0.55 : 0.1));
  const cheapStop = snapshot.raceControl === "SAFETY_CAR" || snapshot.raceControl === "VSC";
  const teammate = snapshot.cars.find((candidate) => candidate.carId !== car.carId && candidate.teamId === car.teamId);
  const doubleStackRisk = Boolean(teammate?.scheduledPitCompound || teammate?.pitStatus === "PIT_LANE" || teammate?.pitStatus === "PIT_STOP");
  const weatherDecision = crossover.shouldPit || modelHasWeather;
  const reason = weatherDecision
    ? crossover.reason
    : doubleStackRisk
    ? "Double-stack queue adds about 1.8s"
    : cheapStop
    ? `${snapshot.raceControl.replace("_", " ")} reduces pit loss`
    : car.gapToCarAhead < 2.5
      ? "Undercut window against car ahead"
      : snapshot.weather.trackWetness > 0.15
        ? "Weather crossover approaching"
        : "Tyre life and traffic model";
  return {
    pitWindowStart,
    pitWindowEnd,
    recommendedCompound,
    pitLossSeconds: estimatePitLossSeconds(snapshot) + (doubleStackRisk ? 1.8 : 0),
    predictedPosition: estimatePitOutPosition(snapshot, car.carId),
    undercutGainSeconds,
    overcutRiskSeconds,
    estimatedTyreLapsRemaining,
    reason,
    crossover,
  };
}
