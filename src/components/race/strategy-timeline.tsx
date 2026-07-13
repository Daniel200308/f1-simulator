"use client";

import { SILVERSTONE_TELEMETRY_SOURCE } from "@/simulation/silverstone-telemetry";
import { strategyRecommendation } from "@/simulation/strategy";
import { SILVERSTONE_CIRCUIT } from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";

export function StrategyTimeline() {
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const car = snapshot?.cars.find((candidate) => candidate.carId === selectedCarId);
  if (!snapshot || !car) return <div className="strategy-timeline strategy-timeline--empty">WAITING FOR STRATEGY DATA</div>;
  const recommendation = strategyRecommendation(snapshot, car);

  return (
    <div className="strategy-timeline">
      <div className="strategy-timeline__summary">
        <span><b>STRATEGY</b> PIT L{recommendation.pitWindowStart}–{recommendation.pitWindowEnd} · {recommendation.recommendedCompound}</span>
        <span>LOSS <b>{recommendation.pitLossSeconds.toFixed(1)}s</b></span>
        <span>UNDERCUT <b>+{recommendation.undercutGainSeconds.toFixed(2)}s</b></span>
        <span>REJOIN <b>P{recommendation.predictedPosition}</b></span>
      </div>
      <div className="strategy-laps" aria-label="52 lap strategy timeline">
        {Array.from({ length: SILVERSTONE_CIRCUIT.totalLaps }, (_, index) => {
          const lap = index + 1;
          const className = lap < car.currentLap ? "is-complete" : lap === car.currentLap ? "is-current" : lap >= recommendation.pitWindowStart && lap <= recommendation.pitWindowEnd ? "is-window" : lap > recommendation.pitWindowEnd ? `is-${recommendation.recommendedCompound.toLowerCase()}` : `is-${car.tyreCompound.toLowerCase()}`;
          return <i className={className} key={lap} title={`Lap ${lap}`} />;
        })}
      </div>
      <div className="strategy-timeline__footer"><span>{recommendation.reason}</span><span>PACE BASE · {SILVERSTONE_TELEMETRY_SOURCE}</span></div>
    </div>
  );
}
