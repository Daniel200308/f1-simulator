"use client";

import { useEffect, useMemo, useState } from "react";

import type { RaceCarState, RaceSnapshot } from "@/domain/race";
import { DRIVER_BY_ID, TEAM_BY_ID } from "@/fixtures/grid";
import { strategyPersonality } from "@/simulation/ai-strategy";
import { damageScenarioLabel } from "@/simulation/damage-response";
import { useRaceStore } from "@/store/race-store";

import styles from "./ai-debug-overlay.module.css";

const NOT_AVAILABLE = "N/A";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT"
    || target.isContentEditable;
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function driverShortName(carId: string | null, cars: readonly RaceCarState[]): string | null {
  if (!carId) return null;
  const car = cars.find((candidate) => candidate.carId === carId);
  return car ? DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId : carId;
}

function formatGap(car: RaceCarState | undefined, gap: number): string {
  return car ? `${DRIVER_BY_ID.get(car.driverId)?.shortName ?? car.driverId} · ${gap.toFixed(3)}s` : NOT_AVAILABLE;
}

function currentAiState(car: RaceCarState, snapshot: RaceSnapshot): string {
  if (car.teamId !== snapshot.playerTeamId) return "FULL AI ACTIVE";
  return car.energyAutoEnabled === true ? "PLAYER · AUTO ENERGY" : "PLAYER CONTROL";
}

function currentDecision(car: RaceCarState): string {
  if (car.aiDecision) return `${label(car.aiDecision.intent)} · ${car.aiDecision.objective}`;
  if (car.pitStatus !== "TRACK") return label(car.pitStatus);
  if (car.scheduledPitCompound) return `BOX → ${car.scheduledPitCompound}`;
  if (car.battleStatus === "SIDE_BY_SIDE") return "SIDE BY SIDE";
  if (car.racingLineMode === "ATTACK") return "ATTACK LINE";
  if (car.racingLineMode === "DEFEND") return "DEFEND LINE";
  return label(car.paceMode);
}

function currentMode(car: RaceCarState): string {
  if (car.overtakeActive || car.energyMode === "OVERTAKE") return "OVERTAKE";
  if (car.racingLineMode === "ATTACK" || car.paceMode === "ATTACK") return "ATTACK";
  if (car.racingLineMode === "DEFEND" || car.energyMode === "DEFEND") return "DEFEND";
  if (car.paceMode === "CONSERVE" || car.energyMode === "CONSERVE") return "CONSERVE";
  return "NORMAL";
}

function pitDecision(car: RaceCarState): string {
  if (car.pitStatus !== "TRACK") return label(car.pitStatus);
  return car.scheduledPitCompound ? `BOX → ${car.scheduledPitCompound}` : "NO STOP SCHEDULED";
}

function target(car: RaceCarState, cars: readonly RaceCarState[]): string {
  const targetId = car.aiDecision?.targetCarId ?? car.battleCarId ?? car.pendingOvertake?.opponentCarId ?? null;
  const targetName = driverShortName(targetId, cars);
  if (targetName) return targetName;
  return car.scheduledPitCompound ? `TYRE → ${car.scheduledPitCompound}` : NOT_AVAILABLE;
}

function weatherResponse(car: RaceCarState, snapshot: RaceSnapshot): string {
  const response = car.strategyIntent === "WEATHER" ? "WEATHER CALL" : NOT_AVAILABLE;
  return `${label(snapshot.weather.condition)} · ${response}`;
}

function safetyCarResponse(car: RaceCarState, snapshot: RaceSnapshot): string {
  if (car.safetyCarQueuePosition !== null) return `${label(snapshot.safetyCarPhase)} · Q${car.safetyCarQueuePosition}`;
  if (snapshot.raceControl === "SAFETY_CAR") return `${label(snapshot.safetyCarPhase)} · ${NOT_AVAILABLE}`;
  return NOT_AVAILABLE;
}

function damageResponse(car: RaceCarState): string {
  if (car.incidentStatus !== "DAMAGED") return NOT_AVAILABLE;
  if (!car.damageScenario) return "PENDING RESPONSE";
  return `${damageScenarioLabel(car.damageScenario)} · ${Math.max(0, car.damageScenarioTimer ?? 0).toFixed(1)}s`;
}

function Field({
  fieldLabel,
  testId,
  value,
  wide = false,
}: {
  fieldLabel: string;
  testId?: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span>{fieldLabel}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

function DriverRow({
  car,
  ahead,
  behind,
  snapshot,
}: {
  car: RaceCarState;
  ahead?: RaceCarState;
  behind?: RaceCarState;
  snapshot: RaceSnapshot;
}) {
  const team = TEAM_BY_ID.get(car.teamId);
  const driver = DRIVER_BY_ID.get(car.driverId);
  const personality = strategyPersonality(car);

  return (
    <article className={styles.driverRow} data-driver-id={car.carId} data-testid="ai-debug-driver-row">
      <header className={styles.driverHeader}>
        <div className={styles.driverIdentity}>
          <span className={styles.position}>P{car.racePosition}</span>
          <div>
            <strong data-testid="ai-debug-driver-name">{driver?.name ?? car.driverId}</strong>
            <small>{car.driverId} · {team?.shortName ?? car.teamId}</small>
          </div>
        </div>
        <div className={styles.driverStatus}>
          <span className={styles.mode}>{currentMode(car)}</span>
          <span>{label(car.battleStatus)}</span>
          <span>{label(car.pitStatus)}</span>
        </div>
      </header>

      <div className={styles.fieldGrid}>
        <Field fieldLabel="AI STATE" testId="ai-debug-ai-state" value={currentAiState(car, snapshot)} />
        <Field fieldLabel="PERSONALITY" value={personality.archetype} />
        <Field fieldLabel="CURRENT DECISION" testId="ai-debug-current-decision" value={currentDecision(car)} wide />
        <Field fieldLabel="TARGET / OBJECTIVE" value={target(car, snapshot.cars)} wide />
        <Field fieldLabel="MODE" value={currentMode(car)} />
        <Field fieldLabel="POSITION" value={`P${car.racePosition}`} />
        <Field fieldLabel="LAP" value={`${car.currentLap}`} />
        <Field fieldLabel="TYRE" testId="ai-debug-tyre" value={label(car.tyreCompound)} />
        <Field fieldLabel="TYRE LIFE" value={`${Math.round(car.tyreLife)}% · age ${car.tyreAgeLaps.toFixed(1)}`} />
        <Field fieldLabel="PLANNED PIT LAP" value={car.aiDecision?.plannedPitLap ? `LAP ${car.aiDecision.plannedPitLap}` : NOT_AVAILABLE} />
        <Field fieldLabel="PIT DECISION" testId="ai-debug-pit-decision" value={pitDecision(car)} />
        <Field fieldLabel="PIT REASON" value={car.aiDecision?.pitReason ?? NOT_AVAILABLE} wide />
        <Field fieldLabel="STRATEGY" value={label(car.strategyIntent)} />
        <Field fieldLabel="FUEL" value={`${car.fuelRemainingKg.toFixed(2)} kg`} />
        <Field fieldLabel="ERS / ENERGY" value={`${label(car.energyState)} · ${Math.round(car.batteryPercent)}%`} />
        <Field fieldLabel="ACTIVE AERO" value={label(car.activeAeroMode)} />
        <Field fieldLabel="TRAFFIC" value={label(car.battleStatus)} />
        <Field fieldLabel="CAR AHEAD" value={formatGap(ahead, car.gapToCarAhead)} />
        <Field fieldLabel="CAR BEHIND" value={formatGap(behind, car.gapToCarBehind)} />
        <Field fieldLabel="WEATHER / RESPONSE" value={weatherResponse(car, snapshot)} wide />
        <Field fieldLabel="DRIVER MOMENT" value={`${label(car.driverMoment ?? "NONE")} · ${Math.max(0, car.driverMomentTimer ?? 0).toFixed(1)}s`} wide />
        <Field fieldLabel="DAMAGE RESPONSE" value={damageResponse(car)} wide />
        <Field fieldLabel="SAFETY CAR / RESPONSE" value={safetyCarResponse(car, snapshot)} wide />
        <Field fieldLabel="AI REASONS" value={car.aiDecision?.reasons.join(" · ") ?? NOT_AVAILABLE} wide />
        <Field fieldLabel="LAST DECISION" value={car.aiDecision ? `${car.aiDecision.decidedAt.toFixed(1)}s` : NOT_AVAILABLE} />
        <Field fieldLabel="RELIABILITY" value={`${car.reliabilityLimitingComponent ?? "NONE"} · ${(car.reliabilityRiskPercent ?? 0).toFixed(1)}% risk`} wide />
      </div>
    </article>
  );
}

function AiDebugContent({ snapshot }: { snapshot: RaceSnapshot | null }) {
  const activeCars = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.cars
      .filter((car) => !car.finished && car.incidentStatus !== "RETIRED")
      .sort((left, right) => left.racePosition - right.racePosition || left.carId.localeCompare(right.carId));
  }, [snapshot]);

  return (
    <section aria-label="AI development telemetry" className={styles.overlay} data-testid="ai-debug-overlay">
      <header className={styles.overlayHeader}>
        <div>
          <span className={styles.eyebrow}>DEVELOPMENT TELEMETRY</span>
          <h2>AI DEBUG OVERLAY</h2>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.readOnly}>READ-ONLY</span>
          <span>{snapshot ? `${activeCars.length} ACTIVE DRIVERS` : "WAITING FOR SNAPSHOT"}</span>
          <span data-testid="ai-debug-tick">{snapshot ? `TICK ${snapshot.tick}` : "TICK N/A"}</span>
          <kbd>⌘&apos;</kbd>
        </div>
      </header>

      {snapshot && (
        <div className={styles.contextBar}>
          <span>RACE {snapshot.status}</span>
          <span>CONTROL {label(snapshot.raceControl)}</span>
          <span>WEATHER {label(snapshot.weather.condition)}</span>
          <span>RAIN {Math.round(snapshot.weather.rainIntensity * 100)}%</span>
          <span>SIM {snapshot.elapsedTime.toFixed(1)}s</span>
        </div>
      )}

      {snapshot && activeCars.length > 0 ? (
        <div className={styles.driverList}>
          {activeCars.map((car, index) => (
            <DriverRow
              ahead={activeCars[index - 1]}
              behind={activeCars[index + 1]}
              car={car}
              key={car.carId}
              snapshot={snapshot}
            />
          ))}
        </div>
      ) : (
        <p className={styles.emptyState}>No active race snapshot is available yet.</p>
      )}

      <footer className={styles.overlayFooter}>
        <span>⌘&apos; TO HIDE</span>
        <span>AI values are sourced from the live race snapshot.</span>
      </footer>
    </section>
  );
}

export function AiDebugOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // The app already exposes NODE_ENV to distinguish development builds. Keep
    // the debug shortcut out of production until a deliberate debug flag exists.
    if (process.env.NODE_ENV === "production") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommandApostrophe = event.metaKey
        && !event.shiftKey
        && !event.ctrlKey
        && !event.altKey
        && (event.key === "'" || event.code === "Quote");
      if (!isCommandApostrophe || event.repeat || isEditableTarget(event.target)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const snapshot = useRaceStore((state) => (open ? state.snapshot : null));

  if (process.env.NODE_ENV === "production" || !open) return null;
  return <AiDebugContent snapshot={snapshot} />;
}
