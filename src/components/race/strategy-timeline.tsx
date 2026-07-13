"use client";

import { DRIVER_BY_ID } from "@/fixtures/grid";
import { calculateLiveStrategy } from "@/simulation/live-strategy";
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
  const live = calculateLiveStrategy({
    raceControl: snapshot.raceControl,
    pitLaneOpen: snapshot.pitLaneOpen,
    weather: snapshot.weather,
    cars: snapshot.cars,
  }, car.carId);
  const crossover = live.crossover;
  const recommendedCompound = live.recommendedCompound ?? recommendation.recommendedCompound;
  const targetDriver = live.battle.targetCarId ? DRIVER_BY_ID.get(live.battle.targetCarId) : null;
  const callLabel = live.call.replace("_", " ");
  const battleLabel = live.battle.preferred === "UNDERCUT"
    ? `UND +${live.battle.undercutGainSeconds.toFixed(1)}s`
    : live.battle.preferred === "OVERCUT"
      ? `OVR +${live.battle.overcutGainSeconds.toFixed(1)}s`
      : "NEUTRAL";
  const crossoverLabel = crossover.shouldPit
    ? `→ ${crossover.recommendedCompound} · ${crossover.gainRangePerLapSeconds.low >= 0 ? "+" : ""}${crossover.gainRangePerLapSeconds.low.toFixed(1)}–${crossover.gainRangePerLapSeconds.high >= 0 ? "+" : ""}${crossover.gainRangePerLapSeconds.high.toFixed(1)}s/LAP · NET ${crossover.netRaceGainSeconds >= 0 ? "+" : ""}${crossover.netRaceGainSeconds.toFixed(1)}s`
    : `STAY OUT · ${crossover.bestCompound === car.tyreCompound ? "CURRENT TYRE QUICKEST" : crossover.expectedWetLaps > 0.2 ? `${crossover.bestCompound} WINDOW TOO SHORT` : `${crossover.bestCompound} CHANGE NOT YET WORTH IT`} · NET ${crossover.netRaceGainSeconds >= 0 ? "+" : ""}${crossover.netRaceGainSeconds.toFixed(1)}s`;

  return (
    <div className="strategy-timeline">
      <div className="strategy-live-grid">
        <div className={`strategy-live-call strategy-live-call--${live.call.toLowerCase().replace("_", "-")}`}>
          <span>LIVE CALL</span><strong>{callLabel}</strong><small>{recommendedCompound} · {Math.round(live.confidence * 100)}%</small>
        </div>
        <div className="strategy-live-metric"><span>PIT WINDOW</span><strong>L{recommendation.pitWindowStart}–{recommendation.pitWindowEnd}</strong><small>{recommendedCompound}</small></div>
        <div className="strategy-live-metric"><span>PIT LOSS</span><strong>{live.pitLoss.expectedSeconds.toFixed(1)}s</strong><small>{live.pitLoss.greenFlagSavingSeconds > 0 ? `SAVE ${live.pitLoss.greenFlagSavingSeconds.toFixed(1)}s` : "GREEN BASE"}</small></div>
        <div className={`strategy-live-metric strategy-live-metric--traffic-${live.rejoin.trafficLevel.toLowerCase()}`}><span>REJOIN</span><strong>P{live.rejoin.position}</strong><small>{live.rejoin.trafficLevel} TRAFFIC</small></div>
        <div className="strategy-live-metric"><span>BATTLE {targetDriver?.shortName ?? "—"}</span><strong>{battleLabel}</strong><small>{live.battle.preferred === "NEUTRAL" ? "NO OFFSET" : "OPPORTUNITY"}</small></div>
        <div className={`strategy-live-metric strategy-live-metric--stack-${live.doubleStack.risk.toLowerCase()}`}><span>DOUBLE STACK</span><strong>{live.doubleStack.risk}</strong><small>{live.doubleStack.queueDelaySeconds > 0 ? `+${live.doubleStack.queueDelaySeconds.toFixed(1)}s QUEUE` : "BOX CLEAR"}</small></div>
      </div>
      <div className="strategy-laps" aria-label="52 lap strategy timeline">
        {Array.from({ length: SILVERSTONE_CIRCUIT.totalLaps }, (_, index) => {
          const lap = index + 1;
          const className = lap < car.currentLap ? "is-complete" : lap === car.currentLap ? "is-current" : lap >= recommendation.pitWindowStart && lap <= recommendation.pitWindowEnd ? "is-window" : lap > recommendation.pitWindowEnd ? `is-${recommendedCompound.toLowerCase()}` : `is-${car.tyreCompound.toLowerCase()}`;
          return <i className={className} key={lap} title={`Lap ${lap}`} />;
        })}
      </div>
      <div className="strategy-timeline__footer"><span className="strategy-crossover" title={live.reasons.join(" ")}><b>CROSSOVER</b> {crossoverLabel}</span><span title={`${live.reasons.join(" ")} · ${SILVERSTONE_TELEMETRY_SOURCE}`}>MODEL 2.0 · {live.reasons[0] ?? "LIVE RACE MODEL"}</span></div>
    </div>
  );
}
