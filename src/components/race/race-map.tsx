"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Application, Container, Graphics, Text } from "pixi.js";
import { Droplets } from "lucide-react";

import type { EnergyFlowState } from "@/domain/energy";
import type { RaceCarState } from "@/domain/race";
import { DEFAULT_PLAYER_TEAM_ID, DRIVER_BY_ID, DRIVERS, playerCarIdsFor, TEAM_BY_ID } from "@/fixtures/grid";
import { RaceControlsPanel } from "@/components/race/race-controls-panel";
import { TeamRadioOverlay } from "@/components/race/team-radio-overlay";
import { createTrackViewport, distanceToCenterline, projectTrackPoint } from "@/components/race/track-viewport";
import {
  PIT_BOX_ORDER,
  pitBoxRouteProgressForTeam,
  pitRouteDistanceFor,
  pitRouteProgressFor,
} from "@/simulation/pit-lane";
import { shouldShowDriverMarkers } from "@/simulation/race-finish";
import { energyFlowStateFor } from "@/simulation/energy/energy-system";
import { SAFETY_CAR_PIT_RELEASE_SECONDS } from "@/simulation/race-control";
import {
  pointAtDistance,
  sectorAtDistance,
  circuitById,
} from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";
import { liveQualifyingClassification, qualifyingCarProgress, qualifyingCutPosition, type WeekendState } from "@/simulation/weekend";
import { unwrapTrackDistance } from "@/simulation/qualifying-traffic";

interface MarkerParts {
  container: Container;
  glyph: Container;
  motion: Graphics;
  ring: Graphics;
  label: Text;
  isPlayer: boolean;
  displayDistance: number;
  displayRoute: "TRACK" | "PIT" | null;
  lastRingKey: string;
  routeBlend: number;
  routeTransitionStartX: number;
  routeTransitionStartY: number;
}

interface EnergyMarkerState {
  flow: EnergyFlowState;
  strategy: string;
  color: number;
  active: boolean;
  label: "DEPLOY" | "HARVEST" | "CLIPPING" | "AUTO";
}

function energyMarkerStateFor(car: RaceCarState): EnergyMarkerState {
  const flow = car.energySystem ? energyFlowStateFor(car.energySystem) : car.energyState;
  const strategy = car.energySystem?.deploymentMode ?? car.energyMode;
  const activeDeployment = flow === "DEPLOYING" || flow === "OVERTAKE" || flow === "DEFENDING";
  if (activeDeployment) {
    return { flow, strategy, color: 0xff334f, active: true, label: "DEPLOY" };
  }
  if (flow === "HARVESTING") {
    return { flow, strategy, color: 0x36dc79, active: true, label: "HARVEST" };
  }
  if (flow === "CLIPPING") {
    return { flow, strategy, color: 0xffd34d, active: true, label: "CLIPPING" };
  }

  // In coast/neutral windows, keep the driver's individual battery tendency
  // visible without pretending that power is currently flowing.
  const aggressive = strategy === "ATTACK" || strategy === "BOOST" || strategy === "OVERTAKE" || strategy === "DEFEND";
  const conservative = strategy === "HARVEST" || strategy === "CONSERVE" || strategy === "RECHARGE";
  return {
    flow,
    strategy,
    color: aggressive ? 0xff687d : conservative ? 0x67e4a2 : 0xf4f7f8,
    active: false,
    label: "AUTO",
  };
}

function interpolateDisplayDistance(current: number, target: number, deltaMs: number, speed: number): number {
  const smoothing = Math.min(1, deltaMs / (speed >= 8 ? 18 : 42));
  return current + (target - current) * smoothing;
}

type SectorRainfallValues = readonly [number, number, number];

function SectorRainfallBars({ rainfall }: { rainfall: SectorRainfallValues }) {
  return (
    <div className="track-weather__bars" role="list">
      {rainfall.map((rainIntensity, index) => {
        const sector = (index + 1) as 1 | 2 | 3;
        const percent = Math.round(Math.max(0, Math.min(1, rainIntensity)) * 100);
        return (
          <div
            aria-label={`Sector ${sector}: rain ${percent} percent`}
            className="track-weather__row"
            data-rainfall={percent}
            data-sector={sector}
            key={sector}
            role="listitem"
            title={`Sector ${sector}: rain ${percent}%`}
          >
            <b className="track-weather__sector-label">S{sector}</b>
            <span
              aria-label={`Sector ${sector} rainfall ${percent} percent`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className="track-weather__bar"
              role="progressbar"
            >
              {Array.from({ length: 10 }, (_, segment) => {
                const segmentProgress = Math.max(0, Math.min(1, percent / 10 - segment));
                return <i aria-hidden="true" key={segment} style={{ "--segment-progress": `${Math.round(segmentProgress * 100)}%` } as CSSProperties} />;
              })}
            </span>
            <strong>{percent}<small>%</small></strong>
          </div>
        );
      })}
    </div>
  );
}

function raceMapViewport(width: number, height: number, points: Parameters<typeof createTrackViewport>[0]) {
  const intelligenceRailReserve = Math.min(360, Math.max(250, width * 0.34));
  const drawableWidth = Math.max(260, width - intelligenceRailReserve - 8);
  const padding = Math.max(20, Math.min(34, height * 0.1));
  return createTrackViewport(points, drawableWidth, height, padding);
}

const SAFETY_CAR_PIT_RELEASE_START_PROGRESS = 0.84;

export function RaceMap({ startPhase, lightsOn, qualifyingState = null }: { startPhase: "MENU" | "LIGHTS" | "GO" | "RACING"; lightsOn: number; qualifyingState?: WeekendState | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const qualifyingRef = useRef<WeekendState | null>(qualifyingState);
  const qualifyingPositionsRef = useRef<Map<string, number>>(new Map());
  const qualifyingReceivedAtRef = useRef(0);
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const qualifyingLive = qualifyingState?.qualifyingLive ?? null;
  const playerTeamId = qualifyingState?.playerTeamId ?? snapshot?.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID;
  const isQualifying = Boolean(qualifyingLive);
  const circuit = circuitById(qualifyingState?.circuitId ?? snapshot?.circuitId);
  const pitRouteLengthMeters = circuit.lengthMeters - circuit.pitLane.entryStart + circuit.pitLane.exitEnd;
  const pitBoxRouteProgress = (circuit.pitLane.boxDistance - circuit.pitLane.entryStart) / pitRouteLengthMeters;
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
  /*
   * Pit timing is published for every player car in the pit lane, not just the
   * selected one. A double stack is exactly the moment both timers matter.
   */
  const pitTimings = (snapshot ? playerCarIdsFor(snapshot.playerTeamId) : [])
    .map((carId) => snapshot?.cars.find((car) => car.carId === carId))
    .filter((car): car is RaceCarState => Boolean(car))
    .map((car) => {
      const tyreChangeComplete = Boolean(car.lastPitStopTime !== null
        && car.lastPitStopCompletedAt != null
        && snapshot
        && snapshot.elapsedTime - car.lastPitStopCompletedAt < 4.5);
      return {
        car,
        tyreChangeComplete,
        visible: car.pitStatus !== "TRACK" || tyreChangeComplete,
        // The tyre change is live while the car is stationary and frozen at its
        // final time for a few seconds after release.
        tyreChangeSeconds: tyreChangeComplete
          ? car.lastPitStopTime ?? 0
          : car.pitTyreServiceElapsedSeconds ?? car.pitTimer,
        tyreChangeRunning: !tyreChangeComplete && car.pitStatus === "PIT_STOP",
        pitLaneSeconds: car.pitStatus === "TRACK" ? car.lastPitLaneTime ?? 0 : car.pitLaneTimer,
        servingPenaltyHold: car.pitServicePhase === "PENALTY_HOLD" || car.pitServicePhase === "STOP_GO_HOLD",
      };
    })
    .filter((entry) => entry.visible);
  const servingPenaltyHold = selectedCar?.pitServicePhase === "PENALTY_HOLD" || selectedCar?.pitServicePhase === "STOP_GO_HOLD";
  const penaltyHoldElapsed = selectedCar?.penaltyHoldElapsedSeconds ?? 0;
  const penaltyHoldTarget = selectedCar?.penaltyHoldSeconds ?? 0;
  const sectorRainfall = ([1, 2, 3] as const).map((sector) => (
    snapshot?.weather.sectors?.find((candidate) => candidate.sector === sector)?.rainIntensity
      ?? snapshot?.weather.rainIntensity
      ?? 0
  )) as [number, number, number];

  useEffect(() => {
    qualifyingRef.current = qualifyingState;
    qualifyingPositionsRef.current = new Map(
      qualifyingState
        ? liveQualifyingClassification(qualifyingState).map((entry) => [entry.carId, entry.position])
        : [],
    );
    qualifyingReceivedAtRef.current = performance.now();
  }, [qualifyingState]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let app: Application | null = null;
    let frame = 0;
    let destroyed = false;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let mapVisible = true;
    let handleVisibility: (() => void) | null = null;

    async function mount() {
      const PIXI = await import("pixi.js");
      if (destroyed || !host) return;

      app = new PIXI.Application();
      await app.init({
        width: Math.max(320, host.clientWidth),
        height: Math.max(1, host.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        // The map is an information surface, not a photo. Capping the backing
        // store keeps a 22-car qualifying session from paying a 2x pixel cost
        // on retina displays while the vector labels remain crisp.
        resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }

      host.appendChild(app.canvas);
      host.dataset.overtakeDetectionDistance = circuit.overtakeZone.detectionDistance.toFixed(1);
      host.dataset.overtakeActivationDistance = circuit.overtakeZone.activationDistance.toFixed(1);
      host.dataset.cornerCount = String(circuit.corners.length);
      host.dataset.pitLaneRenderer = "RACE_SHARED";
      host.dataset.trackRenderer = "PIXI_RACE_MAP";
      host.dataset.motionModel = "RACE_SHARED_INTERPOLATION";
      host.dataset.snapshotAgeCapSeconds = "ADAPTIVE_1.15";
      app.canvas.setAttribute("aria-label", `${circuit.name} live track map with ${circuit.straightZones.length} Straight Mode sections and ${circuit.corners.length} corners.`);
      app.canvas.setAttribute("role", "img");

      const trackLayer = new PIXI.Container();
      const battleLayer = new PIXI.Graphics();
      const markerLayer = new PIXI.Container();
      const alertLayer = new PIXI.Container();
      alertLayer.sortableChildren = true;
      app.stage.addChild(trackLayer, battleLayer, markerLayer, alertLayer);

      const trackBase = new PIXI.Graphics();
      const surfaceLayer = new PIXI.Graphics();
      const trackEdge = new PIXI.Graphics();
      const aeroLayer = new PIXI.Graphics();
      const startLine = new PIXI.Graphics();
      const pitLane = new PIXI.Graphics();
      const controlOverlay = new PIXI.Graphics();
      const overtakeLayer = new PIXI.Container();
      const aeroLabelLayer = new PIXI.Container();
      const cornerLayer = new PIXI.Container();
      trackLayer.addChild(trackBase, surfaceLayer, aeroLayer, pitLane, trackEdge, controlOverlay, overtakeLayer, startLine, cornerLayer, aeroLabelLayer);
      let viewport = raceMapViewport(app.screen.width, app.screen.height, circuit.points);
      let projectedCenterline = circuit.points.map((point) => projectTrackPoint(point, viewport));

      const markers = new Map<string, MarkerParts>();
      const incidentBadge = new PIXI.Container();
      const incidentShape = new PIXI.Graphics().circle(0, 0, 11).fill({ color: 0x251007, alpha: 0.96 }).stroke({ width: 2, color: 0xffc84a });
      const incidentText = new PIXI.Text({ text: "!", style: { fontFamily: "Arial, sans-serif", fontSize: 13, fontWeight: "900", fill: 0xffd46b } });
      incidentText.anchor.set(0.5);
      incidentBadge.addChild(incidentShape, incidentText);
      incidentBadge.visible = false;
      const safetyCarBadge = new PIXI.Container();
      const safetyAura = new PIXI.Graphics().circle(0, 0, 38).fill({ color: 0x39d4ff, alpha: 0.1 });
      const safetyGlow = new PIXI.Graphics().circle(0, 0, 30).stroke({ width: 2.4, color: 0x39d4ff, alpha: 0.62 });
      const safetyRing = new PIXI.Graphics().circle(0, 0, 22).stroke({ width: 2.8, color: 0xffd34d, alpha: 0.98 });
      const safetyShape = new PIXI.Graphics()
        .roundRect(-22, -12, 44, 24, 7)
        .fill({ color: 0x07171c, alpha: 0.98 })
        .stroke({ width: 2.2, color: 0xf4f7f8, alpha: 1 });
      const safetyLabelPlate = new PIXI.Graphics()
        .roundRect(-16, -7.5, 32, 15, 4)
        .fill({ color: 0xf4f7f8, alpha: 1 });
      const safetyBeacon = new PIXI.Graphics().circle(0, -15, 3.5).fill({ color: 0xff5269, alpha: 0.98 });
      const safetyText = new PIXI.Text({ text: "SC", style: { fontFamily: "Arial, sans-serif", fontSize: 11, fontWeight: "900", fill: 0x071015 } });
      safetyText.anchor.set(0.5);
      safetyCarBadge.addChild(safetyAura, safetyGlow, safetyRing, safetyShape, safetyLabelPlate, safetyBeacon, safetyText);
      safetyCarBadge.zIndex = 50;
      safetyCarBadge.visible = false;
      alertLayer.addChild(incidentBadge, safetyCarBadge);
      let lastControlKey = "";
      let lastSpatialWeatherKey = "";

      function drawRaceControl(control: string, yellowSector: number | null) {
        const key = `${control}-${yellowSector ?? 0}`;
        if (key === lastControlKey) return;
        lastControlKey = key;
        controlOverlay.clear();
        if (control === "GREEN") return;
        const color = control === "VSC" ? 0xb276ff : 0xf4d35e;
        circuit.segments.forEach((segment) => {
          if (control === "YELLOW" && sectorAtDistance(segment.startDistance, circuit) !== yellowSector) return;
          const p1 = projectTrackPoint(segment.p1, viewport);
          const p2 = projectTrackPoint(segment.p2, viewport);
          controlOverlay.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ width: 5, color, alpha: 0.72, cap: "round" });
        });
      }

      function drawSpatialWeather(weather: NonNullable<ReturnType<typeof useRaceStore.getState>["snapshot"]>["weather"]) {
        surfaceLayer.clear();

        weather.surfaceZones?.forEach((zone) => {
          const effectiveWater = Math.min(1, zone.wetness * (1 - zone.dryingLine * 0.45) + zone.standingWater * 0.22);
          if (effectiveWater < 0.035) return;
          const color = effectiveWater > 0.64 ? 0x245bff : effectiveWater > 0.27 ? 0x398cff : 0xf4f7f8;
          const samples = Math.max(2, Math.ceil((zone.endDistance - zone.startDistance) / 24));
          for (let index = 0; index <= samples; index += 1) {
            const distance = zone.startDistance + ((zone.endDistance - zone.startDistance) * index) / samples;
            const point = projectTrackPoint(pointAtDistance(distance, circuit), viewport);
            if (index === 0) surfaceLayer.moveTo(point.x, point.y);
            else surfaceLayer.lineTo(point.x, point.y);
          }
          surfaceLayer.stroke({ width: 6, color, alpha: 0.22 + effectiveWater * 0.58, cap: "round", join: "round" });
        });
      }

      /**
       * Places a point on the drawn pit corridor from a 0-1 progress value.
       * Progress is resolved from the car's lap distance, because the corridor
       * straddles the timing line and is far shorter than a cumulative race
       * distance.
       */
      function pitPointAtProgress(progress: number) {
        const clamped = Math.min(1, Math.max(0, progress));
        const entry = projectTrackPoint(pointAtDistance(circuit.pitLane.entryStart, circuit), viewport);
        const exit = projectTrackPoint(pointAtDistance(circuit.pitLane.exitEnd, circuit), viewport);
        const chordX = exit.x - entry.x;
        const chordY = exit.y - entry.y;
        const magnitude = Math.max(0.000001, Math.hypot(chordX, chordY));
        const normalX = -chordY / magnitude;
        const normalY = chordX / magnitude;
        const mergeFraction = 0.16;
        const laneOffset = 9;
        const straightStart = {
          x: entry.x + chordX * mergeFraction + normalX * laneOffset,
          y: entry.y + chordY * mergeFraction + normalY * laneOffset,
        };
        const straightEnd = {
          x: entry.x + chordX * (1 - mergeFraction) + normalX * laneOffset,
          y: entry.y + chordY * (1 - mergeFraction) + normalY * laneOffset,
        };
        if (clamped <= mergeFraction) {
          const mergeProgress = clamped / mergeFraction;
          return { x: entry.x + (straightStart.x - entry.x) * mergeProgress, y: entry.y + (straightStart.y - entry.y) * mergeProgress };
        }
        if (clamped >= 1 - mergeFraction) {
          const mergeProgress = (clamped - (1 - mergeFraction)) / mergeFraction;
          return { x: straightEnd.x + (exit.x - straightEnd.x) * mergeProgress, y: straightEnd.y + (exit.y - straightEnd.y) * mergeProgress };
        }
        const straightProgress = (clamped - mergeFraction) / (1 - mergeFraction * 2);
        return { x: straightStart.x + (straightEnd.x - straightStart.x) * straightProgress, y: straightStart.y + (straightEnd.y - straightStart.y) * straightProgress };
      }

      DRIVERS.forEach((driver) => {
        const team = TEAM_BY_ID.get(driver.teamId);
        if (!team) return;
        const isPlayer = driver.teamId === playerTeamId;

        const container = new PIXI.Container();
        container.eventMode = "static";
        container.cursor = "pointer";
        container.hitArea = new PIXI.Circle(0, 0, 14);
        container.visible = false;

        const ring = new PIXI.Graphics();
        const motion = new PIXI.Graphics();
        const dot = new PIXI.Graphics()
          .circle(0, 0, isPlayer ? 7 : 5.5)
          .fill({ color: team.primaryColor })
          .stroke({ width: 1.2, color: 0xdbe7ea, alpha: 0.72 });
        dot.circle(0, 0, isPlayer ? 3 : 2.2).fill({ color: 0x061017, alpha: 0.76 });
        const label = new PIXI.Text({
          text: driver.shortName,
          style: {
            fontFamily: "Arial, sans-serif",
            fontSize: isPlayer ? 11 : 9,
            fontWeight: "800",
            fill: 0xf2f7f8,
          },
        }) as Text;
        label.anchor.set(0.5, 1);
        label.position.set(0, isPlayer ? -10 : -8);
        const glyph = new PIXI.Container();
        glyph.addChild(motion, ring, dot);
        container.addChild(glyph, label);
        container.on("pointertap", () => useRaceStore.getState().setSelectedCarId(driver.id));
        markerLayer.addChild(container);
        markers.set(driver.id, {
          container,
          glyph,
          motion,
          ring,
          label,
          isPlayer,
          displayDistance: 0,
          displayRoute: null,
          lastRingKey: "",
          routeBlend: 1,
          routeTransitionStartX: 0,
          routeTransitionStartY: 0,
        });
      });

      function drawTrack() {
        trackBase.clear();
        trackEdge.clear();
        aeroLayer.clear();
        startLine.clear();
        pitLane.clear();
        for (const child of overtakeLayer.removeChildren()) child.destroy({ children: true });
        for (const child of aeroLabelLayer.removeChildren()) child.destroy({ children: true });
        for (const child of cornerLayer.removeChildren()) child.destroy();

        projectedCenterline.forEach((p, index) => {
          if (index === 0) {
            trackBase.moveTo(p.x, p.y);
            trackEdge.moveTo(p.x, p.y);
          } else {
            trackBase.lineTo(p.x, p.y);
            trackEdge.lineTo(p.x, p.y);
          }
        });
        const first = projectedCenterline[0];
        trackBase.closePath().stroke({ width: 20, color: 0x14242d, alpha: 1, join: "round" });
        trackEdge.closePath().stroke({ width: 2, color: 0x4b6572, alpha: 0.72, join: "round" });

        circuit.segments.forEach((segment) => {
          if (!segment.activeAeroAllowed) return;
          const p1 = projectTrackPoint(segment.p1, viewport);
          const p2 = projectTrackPoint(segment.p2, viewport);
          aeroLayer.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ width: 3, color: 0xf4f7f8, alpha: 0.38, cap: "butt" });
        });

        const laneSamples = 28;
        for (let index = 0; index <= laneSamples; index += 1) {
          const point = pitPointAtProgress(index / laneSamples);
          if (index === 0) pitLane.moveTo(point.x, point.y);
          else pitLane.lineTo(point.x, point.y);
        }
        pitLane.stroke({ width: 2, color: 0xf2f5f6, alpha: 0.42, cap: "round", join: "round" });

        // The garages the cars actually stop at, so a stop reads as happening at
        // a specific box rather than somewhere in the lane.
        for (const teamId of PIT_BOX_ORDER) {
          const box = pitPointAtProgress(pitBoxRouteProgressForTeam(teamId, circuit));
          const isPlayerBox = teamId === playerTeamId;
          pitLane
            .circle(box.x, box.y, isPlayerBox ? 2.4 : 1.5)
            .fill({ color: isPlayerBox ? 0xf4f7f8 : 0x8fa6ae, alpha: isPlayerBox ? 0.95 : 0.5 });
        }

        const centre = projectedCenterline.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        centre.x /= projectedCenterline.length;
        centre.y /= projectedCenterline.length;

        circuit.straightZones.forEach((zone) => {
          const distance = ((zone.startRatio + zone.endRatio) / 2) * circuit.lengthMeters;
          const point = projectTrackPoint(pointAtDistance(distance, circuit), viewport);
          const before = projectTrackPoint(pointAtDistance(distance - 5, circuit), viewport);
          const after = projectTrackPoint(pointAtDistance(distance + 5, circuit), viewport);
          const magnitude = Math.max(0.000001, Math.hypot(after.x - before.x, after.y - before.y));
          let normalX = -(after.y - before.y) / magnitude;
          let normalY = (after.x - before.x) / magnitude;
          if (normalX * (point.x - centre.x) + normalY * (point.y - centre.y) < 0) {
            normalX *= -1;
            normalY *= -1;
          }
          const x = point.x + normalX * 13;
          const y = point.y + normalY * 13;
          const plate = new PIXI.Graphics()
            .roundRect(x - 17, y - 6, 34, 12, 5)
            .fill({ color: 0x071015, alpha: 0.94 })
            .stroke({ width: 1, color: 0xf4f7f8, alpha: 0.72 });
          const text = new PIXI.Text({ text: `${zone.id} ↔`, style: { fontFamily: "Arial, sans-serif", fontSize: 7, fontWeight: "900", fill: 0xf4f7f8 } });
          text.anchor.set(0.5);
          text.position.set(x, y + 0.2);
          aeroLabelLayer.addChild(plate, text);
        });

        const drawOvertakeLine = (distance: number, label: string, color: number, outward: boolean) => {
          const point = projectTrackPoint(pointAtDistance(distance, circuit), viewport);
          const before = projectTrackPoint(pointAtDistance(distance - 4, circuit), viewport);
          const after = projectTrackPoint(pointAtDistance(distance + 4, circuit), viewport);
          const magnitude = Math.max(0.000001, Math.hypot(after.x - before.x, after.y - before.y));
          let normalX = -(after.y - before.y) / magnitude;
          let normalY = (after.x - before.x) / magnitude;
          const pointsOutward = normalX * (point.x - centre.x) + normalY * (point.y - centre.y) >= 0;
          if (pointsOutward !== outward) {
            normalX *= -1;
            normalY *= -1;
          }
          const line = new PIXI.Graphics()
            .moveTo(point.x - normalX * 11, point.y - normalY * 11)
            .lineTo(point.x + normalX * 11, point.y + normalY * 11)
            .stroke({ width: label === "DET" ? 3 : 2, color, alpha: 0.96, cap: "butt" });
          const labelX = point.x + normalX * 19;
          const labelY = point.y + normalY * 19;
          const plate = new PIXI.Graphics()
            .roundRect(labelX - 11, labelY - 6, 22, 12, 3)
            .fill({ color: 0x071015, alpha: 0.94 })
            .stroke({ width: 1, color, alpha: 0.82 });
          const text = new PIXI.Text({
            text: label,
            style: { fontFamily: "Arial, sans-serif", fontSize: 7, fontWeight: "900", fill: color, letterSpacing: 0.6 },
          });
          text.anchor.set(0.5);
          text.position.set(labelX, labelY + 0.2);
          overtakeLayer.addChild(line, plate, text);
        };
        drawOvertakeLine(circuit.overtakeZone.detectionDistance, "DET", 0xffd34d, true);
        drawOvertakeLine(circuit.overtakeZone.activationDistance, "OVT", 0xff4d8f, false);

        circuit.corners.forEach((corner) => {
          const point = projectTrackPoint(pointAtDistance(corner.distanceMeters, circuit), viewport);
          const before = projectTrackPoint(pointAtDistance(corner.distanceMeters - 3, circuit), viewport);
          const after = projectTrackPoint(pointAtDistance(corner.distanceMeters + 3, circuit), viewport);
          const magnitude = Math.max(0.000001, Math.hypot(after.x - before.x, after.y - before.y));
          let normalX = -(after.y - before.y) / magnitude;
          let normalY = (after.x - before.x) / magnitude;
          if (normalX * (point.x - centre.x) + normalY * (point.y - centre.y) < 0) {
            normalX *= -1;
            normalY *= -1;
          }
          const labelX = point.x + normalX * 22;
          const labelY = point.y + normalY * 22;
          const connector = new PIXI.Graphics()
            .moveTo(point.x + normalX * 9, point.y + normalY * 9)
            .lineTo(labelX - normalX * 8, labelY - normalY * 8)
            .stroke({ width: 1, color: 0x79909a, alpha: 0.42, cap: "butt" });
          const badge = new PIXI.Graphics()
            .circle(labelX, labelY, 8)
            .fill({ color: 0x071015, alpha: 0.96 })
            .stroke({ width: 1.2, color: 0x91a9b2, alpha: 0.82 });
          const number = new PIXI.Text({
            text: String(corner.number),
            style: { fontFamily: "Arial, sans-serif", fontSize: corner.number >= 10 ? 7 : 8, fontWeight: "700", fill: 0xeaf4f6 },
          });
          number.anchor.set(0.5);
          number.position.set(labelX, labelY + 0.3);
          cornerLayer.addChild(connector, badge, number);
        });

        const next = projectedCenterline[1];
        const dx = next.x - first.x;
        const dy = next.y - first.y;
        const magnitude = Math.max(1, Math.hypot(dx, dy));
        const nx = (-dy / magnitude) * 11;
        const ny = (dx / magnitude) * 11;
        startLine.moveTo(first.x - nx, first.y - ny).lineTo(first.x + nx, first.y + ny).stroke({ width: 3, color: 0xffffff, alpha: 0.92 });
      }

      function resize() {
        if (!app || !host) return;
        const width = Math.max(320, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        app.renderer.resize(width, height);
        viewport = raceMapViewport(app.screen.width, app.screen.height, circuit.points);
        projectedCenterline = circuit.points.map((point) => projectTrackPoint(point, viewport));
        drawTrack();
        lastControlKey = "";
        lastSpatialWeatherKey = "";
      }
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      let lastTime = performance.now();
      function animate(now: number) {
        frame = 0;
        if (!app || destroyed || !mapVisible || document.visibilityState !== "visible") return;
        const delta = Math.min(50, now - lastTime);
        lastTime = now;
        const state = useRaceStore.getState();
        const snapshot = state.snapshot;
        const qualifyingWeekend = qualifyingRef.current;
        const qualifying = qualifyingWeekend?.qualifyingLive;
        if (qualifying && qualifyingWeekend) {
          drawRaceControl("GREEN", null);
          if (lastSpatialWeatherKey !== "QUALIFYING_CLEAR") {
            lastSpatialWeatherKey = "QUALIFYING_CLEAR";
            battleLayer.clear();
            surfaceLayer.clear();
          }
          incidentBadge.visible = false;
          safetyCarBadge.visible = false;
          const qualifyingSnapshotAgeSeconds = qualifying.paused
            ? 0
            : Math.min(
              Math.min(1.15, 1.8 / Math.max(1, qualifying.speed)),
              Math.max(0, (now - qualifyingReceivedAtRef.current) / 1_000),
            );
          let visibleDriverCount = 0;
          for (const driver of DRIVERS) {
            const marker = markers.get(driver.id);
            const car = qualifying.cars[driver.id];
            if (!marker) continue;
            const markerVisible = Boolean(car && car.phase !== "GARAGE");
            if (!markerVisible || !car) {
              marker.container.visible = false;
              marker.displayDistance = 0;
              marker.displayRoute = null;
              marker.routeBlend = 1;
              if ((car?.carId ?? driver.id) === state.selectedCarId) {
                const activeHost = hostRef.current;
                if (activeHost) {
                  delete activeHost.dataset.qualifyingPhase;
                  delete activeHost.dataset.qualifyingProgress;
                  delete activeHost.dataset.qualifyingRoute;
                  delete activeHost.dataset.selectedDistance;
                  delete activeHost.dataset.selectedX;
                  delete activeHost.dataset.selectedY;
                  delete activeHost.dataset.frameStepPx;
                }
              }
              continue;
            }
            visibleDriverCount += 1;
            const extrapolatedCar = car.phase === "GARAGE"
              ? car
              : { ...car, phaseRemainingSeconds: Math.max(0, car.phaseRemainingSeconds - qualifyingSnapshotAgeSeconds * qualifying.speed) };
            const progress = qualifyingCarProgress(extrapolatedCar);
            let route: "TRACK" | "PIT" = "TRACK";
            let targetDistance = 0;
            if (car.phase === "PIT_ENTRY") {
              route = "PIT";
              // PIT_ENTRY starts at the track entry line and finishes at the
              // garage box. Keeping it on the pit route avoids a phase-change
              // teleport back onto the main circuit at high simulation speed.
              targetDistance = pitBoxRouteProgress * pitRouteLengthMeters * progress;
            } else if (car.phase === "OUT_LAP" && progress < 0.12) {
              route = "PIT";
              // Leaving the garage: from the box down the lane to the exit.
              const boxDistance = pitBoxRouteProgress * pitRouteLengthMeters;
              targetDistance = boxDistance + (pitRouteLengthMeters - boxDistance) * (progress / 0.12);
            } else if (car.phase === "OUT_LAP") {
              const trackProgress = (progress - 0.12) / 0.88;
              targetDistance = circuit.pitLane.exitEnd + (circuit.lengthMeters - circuit.pitLane.exitEnd) * trackProgress;
            } else if (car.phase === "IN_LAP" && car.flyingLapsRemaining > 0) {
              // Recovery in-lap: still circulating towards the timing line.
              const trackProgress = car.phaseStartProgress + (1 - car.phaseStartProgress) * progress;
              targetDistance = trackProgress * circuit.lengthMeters;
            } else if (car.phase === "IN_LAP" && progress > 0.86) {
              route = "PIT";
              const pitProgress = (progress - 0.86) / 0.14;
              // Coming in: from the entry line down the lane to the box.
              targetDistance = pitBoxRouteProgress * pitRouteLengthMeters * pitProgress;
            } else {
              const trackProgress = car.phase === "IN_LAP" ? progress / 0.86 : progress;
              targetDistance = trackProgress * (car.phase === "IN_LAP" ? circuit.pitLane.entryStart : circuit.lengthMeters);
            }
            const wasVisible = marker.container.visible;
            const routeChanged = wasVisible && marker.displayRoute !== route;
            marker.container.visible = true;
            const previousX = marker.container.position.x;
            const previousY = marker.container.position.y;
            if (!wasVisible || routeChanged) {
              marker.displayDistance = targetDistance;
              if (routeChanged && wasVisible) {
                marker.routeBlend = 0;
                marker.routeTransitionStartX = previousX;
                marker.routeTransitionStartY = previousY;
              } else {
                marker.routeBlend = 1;
              }
            } else if (!qualifying.paused) {
              if (route === "TRACK") targetDistance = unwrapTrackDistance(marker.displayDistance, targetDistance, circuit.lengthMeters);
              marker.displayDistance = interpolateDisplayDistance(marker.displayDistance, targetDistance, delta, qualifying.speed);
            }
            marker.displayRoute = route;
            const targetPoint = route === "PIT"
              ? pitPointAtProgress(marker.displayDistance / pitRouteLengthMeters)
              : projectTrackPoint(pointAtDistance(marker.displayDistance, circuit), viewport);
            if (marker.routeBlend < 1) {
              marker.routeBlend = Math.min(1, marker.routeBlend + Math.min(1, Math.max(delta, 8) / 160));
            }
            const point = marker.routeBlend < 1
              ? {
                x: marker.routeTransitionStartX + (targetPoint.x - marker.routeTransitionStartX) * marker.routeBlend,
                y: marker.routeTransitionStartY + (targetPoint.y - marker.routeTransitionStartY) * marker.routeBlend,
              }
              : targetPoint;
            marker.container.position.set(point.x, point.y);
            const frameStepPx = wasVisible ? Math.hypot(point.x - previousX, point.y - previousY) : 0;
            marker.glyph.position.set(0, 0);
            marker.glyph.rotation = 0;
            marker.container.zIndex = 40 - (qualifyingPositionsRef.current.get(car.carId) ?? 30);
            const selected = state.selectedCarId === car.carId;
            marker.label.visible = true;
            marker.label.tint = selected ? 0xf4f7f8 : 0xffffff;
            const phaseColor = car.phase === "PUSH_LAP" ? 0xff334f : car.phase === "IN_LAP" ? 0x36dc79 : 0xf4f7f8;
            const ringKey = `${car.phase}:${phaseColor}:${selected}`;
            if (marker.lastRingKey !== ringKey) {
              marker.ring.clear();
              marker.ring.circle(0, 0, marker.isPlayer ? 10 : 8).stroke({ width: selected ? 3 : 1.8, color: phaseColor, alpha: 0.96 });
              marker.lastRingKey = ringKey;
            }
            if (selected) {
              const activeHost = hostRef.current;
              if (activeHost) {
                activeHost.dataset.selectedCar = car.carId;
                activeHost.dataset.selectedX = marker.container.position.x.toFixed(2);
                activeHost.dataset.selectedY = marker.container.position.y.toFixed(2);
                activeHost.dataset.qualifyingPhase = car.phase;
                activeHost.dataset.qualifyingProgress = ((marker.displayDistance / circuit.lengthMeters) % 1).toFixed(4);
                activeHost.dataset.qualifyingRoute = route;
                activeHost.dataset.selectedDistance = marker.displayDistance.toFixed(2);
                activeHost.dataset.frameStepPx = frameStepPx.toFixed(4);
                activeHost.dataset.centerlineErrorPx = route === "TRACK" ? distanceToCenterline(point, projectedCenterline).toFixed(6) : "PIT_LANE";
                activeHost.dataset.indicatorColor = `#${phaseColor.toString(16).padStart(6, "0")}`;
                activeHost.dataset.viewportWidth = viewport.width.toFixed(2);
                activeHost.dataset.viewportHeight = viewport.height.toFixed(2);
                activeHost.dataset.viewportScale = viewport.scale.toFixed(4);
              }
            }
          }
          markerLayer.sortableChildren = true;
          if (hostRef.current) hostRef.current.dataset.visibleDriverCount = String(visibleDriverCount);
        } else if (snapshot) {
          battleLayer.clear();
          drawRaceControl(snapshot.raceControl, snapshot.yellowSector);
          const spatialWeatherKey = `${snapshot.weather.condition}:${snapshot.weather.radarCells?.map((cell) => Math.round(cell.rainIntensity * 20)).join("") ?? ""}:${snapshot.weather.surfaceZones?.map((zone) => Math.round((zone.wetness + zone.standingWater) * 20)).join("") ?? ""}`;
          if (spatialWeatherKey !== lastSpatialWeatherKey) {
            lastSpatialWeatherKey = spatialWeatherKey;
            drawSpatialWeather(snapshot.weather);
          }
          if (snapshot.activeIncident) {
            const incidentPoint = projectTrackPoint(pointAtDistance(snapshot.activeIncident.distanceMeters, circuit), viewport);
            incidentBadge.position.set(incidentPoint.x, incidentPoint.y);
            incidentBadge.visible = true;
          } else {
            incidentBadge.visible = false;
          }
          if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarDistance !== null) {
            const pitReleaseProgress = Math.min(1, snapshot.safetyCarPhaseElapsedSeconds / SAFETY_CAR_PIT_RELEASE_SECONDS);
            const safetyPoint = snapshot.safetyCarInPitLane
              ? pitPointAtProgress(snapshot.safetyCarPhase === "DEPLOYED"
                // The icon starts at the release end of the lane, then joins the track.
                ? SAFETY_CAR_PIT_RELEASE_START_PROGRESS + (1 - SAFETY_CAR_PIT_RELEASE_START_PROGRESS) * pitReleaseProgress
                : pitRouteProgressFor(snapshot.safetyCarDistance, circuit))
              : projectTrackPoint(pointAtDistance(snapshot.safetyCarDistance, circuit), viewport);
            safetyCarBadge.position.set(safetyPoint.x, safetyPoint.y);
            const beaconPulse = 0.72 + Math.sin(performance.now() / 150) * 0.24;
            safetyAura.alpha = 0.08 + beaconPulse * 0.07;
            safetyGlow.alpha = 0.38 + beaconPulse * 0.25;
            safetyRing.alpha = 0.76 + beaconPulse * 0.24;
            safetyRing.scale.set(0.96 + beaconPulse * 0.06);
            safetyRing.rotation = performance.now() / 2_400;
            safetyBeacon.alpha = beaconPulse;
            safetyCarBadge.visible = true;
          } else {
            safetyCarBadge.visible = false;
          }
          const snapshotAgeSeconds = Math.min(0.2, Math.max(0, (Date.now() - state.snapshotReceivedAt) / 1_000));
          const showDriverMarkers = shouldShowDriverMarkers(snapshot.status);
          let visibleDriverCount = 0;
          for (const car of snapshot.cars) {
            const marker = markers.get(car.carId);
            if (!marker) continue;
            const markerVisible = showDriverMarkers && car.incidentStatus !== "RETIRED";
            marker.container.visible = markerVisible;
            if (!markerVisible) continue;
            visibleDriverCount += 1;
            const route: "TRACK" | "PIT" = car.pitStatus === "TRACK" ? "TRACK" : "PIT";
            /*
             * The track and pit routes use different coordinates, so the smoothed
             * value has to be reseeded when a car swaps between them. Interpolating
             * across the change would drag the marker over the infield.
             */
            const routeChanged = marker.displayRoute !== route;
            const liveDistance = route === "PIT" ? pitRouteDistanceFor(car.lapDistance, circuit) : car.totalDistance;
            const travelled = state.paused ? 0 : (car.currentSpeed / 3.6) * snapshotAgeSeconds * state.speed;
            const extrapolatedDistance = route === "PIT"
              // A stationary car in its box must not creep forward.
              ? Math.min(pitRouteLengthMeters, liveDistance + (car.pitStatus === "PIT_STOP" ? 0 : travelled))
              : liveDistance + travelled;
            if (routeChanged || marker.displayDistance === 0) marker.displayDistance = extrapolatedDistance;
            else marker.displayDistance = interpolateDisplayDistance(marker.displayDistance, extrapolatedDistance, delta, state.speed);
            marker.displayRoute = route;
            const p = route === "TRACK"
              ? projectTrackPoint(pointAtDistance(marker.displayDistance, circuit), viewport)
              : pitPointAtProgress(marker.displayDistance / pitRouteLengthMeters);
            let displayX = p.x;
            let displayY = p.y;
            marker.glyph.position.set(0, 0);
            marker.glyph.rotation = 0;
            marker.motion.clear();
            const incidentAge = Math.max(0, snapshot.elapsedTime - (car.incidentStartedAt ?? snapshot.elapsedTime));
            const incidentDirection = car.incidentDirection ?? 1;
            if (car.pitStatus === "TRACK" && car.incidentStatus !== "RUNNING") {
              const before = projectTrackPoint(pointAtDistance(marker.displayDistance - 4, circuit), viewport);
              const after = projectTrackPoint(pointAtDistance(marker.displayDistance + 4, circuit), viewport);
              const magnitude = Math.max(0.000001, Math.hypot(after.x - before.x, after.y - before.y));
              const normalX = -((after.y - before.y) / magnitude);
              const normalY = (after.x - before.x) / magnitude;
              if (car.incidentStatus === "SPUN") {
                const lateral = Math.sin(Math.min(1, incidentAge / 6) * Math.PI) * 18 * incidentDirection;
                displayX += normalX * lateral;
                displayY += normalY * lateral;
                marker.glyph.rotation = incidentAge * 5.2 * incidentDirection;
                marker.motion.arc(0, 0, 10, 0.2, Math.PI * 1.75).stroke({ width: 2, color: 0xffd34d, alpha: 0.88 });
              } else if (car.incidentStatus === "DAMAGED" && incidentAge < 8) {
                const shudder = Math.sin(incidentAge * 19) * 3.5;
                displayX += normalX * shudder;
                displayY += normalY * shudder;
                marker.glyph.rotation = Math.sin(incidentAge * 13) * 0.16;
                marker.motion.moveTo(-11, -5).lineTo(-18, -8).moveTo(-11, 5).lineTo(-18, 8).stroke({ width: 2, color: 0xff9b4a, alpha: 0.9 });
              } else if (car.incidentStatus === "RETIRED") {
                const roadside = Math.min(17, incidentAge * 4) * incidentDirection;
                displayX += normalX * roadside;
                displayY += normalY * roadside;
                marker.motion.moveTo(-8, -8).lineTo(8, 8).moveTo(8, -8).lineTo(-8, 8).stroke({ width: 2.3, color: 0xff5269, alpha: 0.94 });
              }
            }
            marker.container.position.set(displayX, displayY);
            marker.container.zIndex = 30 - car.racePosition;
            const selected = state.selectedCarId === car.carId;
            marker.label.visible = true;
            marker.label.tint = selected ? 0xf4f7f8 : 0xffffff;
            marker.ring.clear();
            const energyIndicator = energyMarkerStateFor(car);
            const energyPulse = energyIndicator.active ? 0.78 + Math.sin(now / 180) * 0.14 : 0.62;
            const energyRadius = marker.isPlayer ? 10 : 8;
            marker.ring.circle(0, 0, energyRadius).stroke({
              width: selected ? 3 : energyIndicator.active ? 2.1 : 1.5,
              color: energyIndicator.color,
              alpha: selected ? 0.98 : energyPulse,
            });
            if (energyIndicator.active) {
              marker.ring.circle(0, 0, energyRadius + 3).stroke({
                width: 1,
                color: energyIndicator.color,
                alpha: selected ? 0.24 : 0.14 + Math.max(0, energyPulse - 0.78) * 0.35,
              });
            }
            if (selected) {
              const activeHost = hostRef.current;
              if (activeHost) {
                activeHost.dataset.selectedCar = car.carId;
                activeHost.dataset.selectedX = p.x.toFixed(2);
                activeHost.dataset.selectedY = p.y.toFixed(2);
                activeHost.dataset.selectedDistance = marker.displayDistance.toFixed(2);
                activeHost.dataset.centerlineErrorPx = distanceToCenterline(p, projectedCenterline).toFixed(6);
                activeHost.dataset.racingLine = car.racingLineMode;
                activeHost.dataset.trackLineOffset = "0.000";
                activeHost.dataset.energyMode = car.energyMode;
                activeHost.dataset.energyFlow = energyIndicator.flow;
                activeHost.dataset.energyStrategy = energyIndicator.strategy;
                activeHost.dataset.energyMarkerLabel = energyIndicator.label;
                activeHost.dataset.indicatorColor = `#${energyIndicator.color.toString(16).padStart(6, "0")}`;
                activeHost.dataset.viewportWidth = viewport.width.toFixed(2);
                activeHost.dataset.viewportHeight = viewport.height.toFixed(2);
                activeHost.dataset.viewportScale = viewport.scale.toFixed(4);
              }
            }
          }
          if (hostRef.current) hostRef.current.dataset.visibleDriverCount = String(visibleDriverCount);
          for (const car of showDriverMarkers ? snapshot.cars : []) {
            if (car.incidentStatus === "RETIRED") continue;
            if (!car.battleCarId || (car.battleStatus !== "ATTACKING" && car.battleStatus !== "SIDE_BY_SIDE")) continue;
            const battleCar = snapshot.cars.find((candidate) => candidate.carId === car.battleCarId);
            if (!battleCar || battleCar.incidentStatus === "RETIRED") continue;
            const attacker = markers.get(car.carId);
            const defender = markers.get(car.battleCarId);
            if (!attacker || !defender) continue;
            battleLayer
              .moveTo(attacker.container.position.x, attacker.container.position.y)
              .lineTo(defender.container.position.x, defender.container.position.y)
              .stroke({ width: car.overtakeActive ? 2.2 : 1.1, color: car.overtakeActive ? 0xff334f : 0x657b84, alpha: car.overtakeActive ? 0.9 : 0.36, cap: "round" });
          }
          markerLayer.sortableChildren = true;
        }
        if (mapVisible && document.visibilityState === "visible") frame = requestAnimationFrame(animate);
      }
      intersectionObserver = typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
          mapVisible = entry?.isIntersecting ?? true;
          if (!mapVisible && frame) {
            cancelAnimationFrame(frame);
            frame = 0;
          } else if (mapVisible && document.visibilityState === "visible" && !frame) {
            frame = requestAnimationFrame(animate);
          }
        }, { threshold: 0.01 });
      intersectionObserver?.observe(host);
      handleVisibility = () => {
        if (document.visibilityState === "visible" && mapVisible && !frame) frame = requestAnimationFrame(animate);
        else if (document.visibilityState !== "visible" && frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);
      frame = requestAnimationFrame(animate);
    }

    void mount();
    return () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      if (handleVisibility) document.removeEventListener("visibilitychange", handleVisibility);
      const canvas = app?.canvas;
      if (canvas?.parentElement === host) canvas.remove();
      if (app) app.destroy(false, { children: true });
    };
  }, [circuit, pitBoxRouteProgress, pitRouteLengthMeters, playerTeamId]);

  const qualifyingClassification = qualifyingState ? liveQualifyingClassification(qualifyingState) : [];
  const qualifyingCut = qualifyingState ? qualifyingCutPosition(qualifyingState) : null;

  return (
    <div className="track-map" data-map-mode={isQualifying ? "QUALIFYING" : "RACE"} ref={hostRef}>
      <div className="track-map__hud track-map__hud--top">
        <span>{isQualifying ? `${qualifyingLive?.session} LIVE CIRCUIT` : "LIVE CIRCUIT"}</span>
        {!isQualifying && snapshot?.raceControl === "SAFETY_CAR" && (
          <strong className="track-map__sc-status" data-phase={snapshot.safetyCarPhase}>
            <i aria-hidden="true" />
            <span>SAFETY CAR</span>
            <b>{snapshot.safetyCarPhase === "DEPLOYED" ? "DEPLOYING" : snapshot.safetyCarPhase === "BUNCHING" ? "BUNCHING" : "RESTART"}</b>
          </strong>
        )}
      </div>
      {!isQualifying && <aside className="track-intelligence-rail" aria-label="Circuit radio, race control and sector rainfall">
        <TeamRadioOverlay />
        <RaceControlsPanel snapshot={snapshot} />
        <div aria-label="Sector rainfall" aria-live="polite" className="track-weather">
          <header className="track-weather__header">
            <span><Droplets aria-hidden="true" size={15} /> WEATHER</span>
            <div><strong>SECTOR RAINFALL</strong></div>
          </header>
          <SectorRainfallBars rainfall={sectorRainfall} />
        </div>
      </aside>}
      {isQualifying && <aside
        aria-label="Qualifying circuit information"
        className="track-intelligence-rail qualifying-map-rail"
        data-qualifying-rail="true"
        data-status={qualifyingLive?.status}
      >
        <section>
          <header>
            <span><i aria-hidden="true" />QUALIFYING LIVE</span>
            <strong aria-label={`${qualifyingLive?.session} qualifying`}>{qualifyingLive?.session}</strong>
          </header>
          <div className="qualifying-map-rail__metrics">
            <span data-metric="track"><small>ON TRACK</small><strong>{Object.values(qualifyingLive?.cars ?? {}).filter((car) => car.phase !== "GARAGE").length}</strong><em>ACTIVE CARS</em></span>
            <span data-metric="cut"><small>CUT LINE</small><strong>{qualifyingCut ? `P${qualifyingCut}` : "POLE"}</strong><em>ADVANCE</em></span>
          </div>
          <ol aria-label="Qualifying phase counts">
            {(["OUT_LAP", "PUSH_LAP", "IN_LAP"] as const).map((phase) => {
              const count = qualifyingClassification.filter((entry) => entry.phase === phase).length;
              return <li data-active={count > 0} data-phase={phase} key={phase}><i aria-hidden="true" /><span>{phase === "PUSH_LAP" ? "FLYING LAP" : phase.replace("_", " ")}</span><strong>{count}</strong></li>;
            })}
          </ol>
        </section>
      </aside>}
      {(startPhase === "LIGHTS" || startPhase === "GO") && <div className={`track-start-sequence ${startPhase === "GO" ? "is-go" : ""}`} data-track-start-phase={startPhase}><div>{Array.from({ length: 5 }, (_, index) => <i className={index < lightsOn ? "is-on" : ""} key={index} />)}</div><span>{startPhase === "GO" ? "LIGHTS OUT" : "START"}</span></div>}
      {!isQualifying && pitTimings.length > 0 && (
        <div className="pit-timing-stack" aria-label="Live pit stop timing">
          {pitTimings.map((entry) => {
            const entryDriver = DRIVER_BY_ID.get(entry.car.driverId);
            const targetSeconds = entry.car.pitTyreServiceTargetSeconds ?? entry.car.pitStopTargetSeconds;
            // The bar gives the blinking clock context: how far through the
            // expected wheel-change the crew actually is.
            const tyreProgress = targetSeconds > 0
              ? Math.min(100, (entry.tyreChangeSeconds / targetSeconds) * 100)
              : 0;
            const issue = entry.car.pitStopIssue !== "NONE" ? entry.car.pitStopIssue.replaceAll("_", " ") : null;
            /*
             * The status line describes where the car actually is. Reporting the
             * crew as being on the car while it is still driving down the lane
             * would misdescribe the stop.
             */
            const status = entry.tyreChangeComplete
              ? "WHEELS ON"
              : entry.servingPenaltyHold
                ? "PENALTY HOLD"
                : entry.car.pitStatus === "PIT_STOP"
                  ? issue ?? "CREW ON CAR"
                  : entry.car.pitStatus === "PIT_ENTRY"
                    ? "ENTERING PIT LANE"
                    : entry.car.pitStatus === "PIT_EXIT" ? "LEAVING PIT LANE" : "IN PIT LANE";
            const state = entry.tyreChangeComplete
              ? "DONE"
              : entry.car.pitStatus === "PIT_STOP" ? (issue ? "ISSUE" : "LIVE") : "APPROACH";
            return (
              <div
                aria-live="assertive"
                className={`pit-timing-live ${entry.tyreChangeComplete ? "is-tyre-complete" : ""}`}
                data-pit-status={entry.tyreChangeComplete ? "TYRE_COMPLETE" : entry.car.pitStatus}
                key={entry.car.carId}
                role="status"
              >
                <header>
                  <b>{entryDriver?.shortName ?? entry.car.carId.toUpperCase()}</b>
                  <span>{entry.tyreChangeComplete ? "STOP COMPLETE" : "LIVE PIT STOP"}</span>
                  <strong>{entry.tyreChangeComplete ? "RELEASED" : entry.car.pitStatus.replace("PIT_", "")}</strong>
                </header>

                {/* The wheel-change clock is the number the pit wall watches, so
                    it is the hero of the card and blinks red while the crew is
                    physically on the car. */}
                <div className="pit-timing-live__hero" data-running={entry.tyreChangeRunning}>
                  <small>TYRE CHANGE</small>
                  <strong>{entry.tyreChangeSeconds.toFixed(2)}<em>s</em></strong>
                  <i aria-hidden="true"><b style={{ width: `${tyreProgress}%` }} /></i>
                </div>

                <div className="pit-timing-live__rows">
                  <span><small>TOTAL PIT</small><strong>{entry.pitLaneSeconds.toFixed(1)}<em>s</em></strong></span>
                  <span><small>TARGET</small><strong>{targetSeconds.toFixed(2)}<em>s</em></strong></span>
                </div>

                <footer data-state={state}>
                  <i aria-hidden="true" />
                  <span>{status}</span>
                </footer>
              </div>
            );
          })}
        </div>
      )}
      {!isQualifying && selectedCar && servingPenaltyHold && <div aria-live="assertive" className="penalty-service-live" role="timer" style={{ "--penalty-progress": `${penaltyHoldTarget > 0 ? Math.min(100, penaltyHoldElapsed / penaltyHoldTarget * 100) : 0}%` } as CSSProperties}>
        <header><span>STEWARDS PENALTY</span><strong>CAR UNTOUCHED</strong></header>
        <div><span><small>SERVING</small><strong>{penaltyHoldElapsed.toFixed(1)}</strong></span><i /><span><small>TARGET</small><strong>{penaltyHoldTarget.toFixed(1)}</strong></span><em>s</em></div>
        <progress aria-label={`Penalty service ${penaltyHoldElapsed.toFixed(1)} of ${penaltyHoldTarget.toFixed(1)} seconds`} max={Math.max(0.1, penaltyHoldTarget)} value={penaltyHoldElapsed} />
        <footer>{(selectedCar.penaltyServiceIds?.length ?? 0) > 1 ? `${selectedCar.penaltyServiceIds?.length} PENALTIES · COMBINED HOLD` : selectedCar.penaltyServiceType === "STOP_GO_10" ? "10 SECOND STOP-AND-GO" : "TIME PENALTY HOLD"}</footer>
      </div>}
      <div className="track-map__legend">
        <span><i className="legend-dot legend-dot--player" />PLAYER</span>
        {isQualifying && <><span><i className="legend-dot legend-dot--qualifying-push" />FLYING LAP</span><span><i className="legend-dot legend-dot--qualifying-in" />COOL / IN</span></>}
        {!isQualifying && <><span><i className="legend-dot legend-dot--energy-deploy" />BATTERY DEPLOY</span><span><i className="legend-dot legend-dot--energy-harvest" />BATTERY HARVEST</span></>}
        <span><i className="legend-line" />STRAIGHT MODE · WING OPEN</span>
        <span><i className="legend-line legend-line--detection" />OVERTAKE DET.</span>
        <span><i className="legend-line legend-line--pit" />PIT LANE</span>
      </div>
    </div>
  );
}
