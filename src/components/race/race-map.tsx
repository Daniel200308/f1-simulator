"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Application, Container, Graphics, Text } from "pixi.js";
import { CloudRain, Radar } from "lucide-react";

import { DEFAULT_PLAYER_TEAM_ID, DRIVERS, TEAM_BY_ID } from "@/fixtures/grid";
import { TeamRadioOverlay } from "@/components/race/team-radio-overlay";
import { createTrackViewport, distanceToCenterline, projectTrackPoint } from "@/components/race/track-viewport";
import { PIT_BOX_DISTANCE, PIT_ENTRY_START, PIT_EXIT_END } from "@/simulation/engine";
import { shouldShowDriverMarkers } from "@/simulation/race-finish";
import {
  pointAtDistance,
  sectorAtDistance,
  SILVERSTONE_CIRCUIT,
  SILVERSTONE_CORNERS,
  SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE,
  SILVERSTONE_OVERTAKE_DETECTION_DISTANCE,
  SILVERSTONE_STRAIGHT_MODE_ZONES,
} from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";
import { liveQualifyingClassification, qualifyingCarProgress, qualifyingCutPosition, type WeekendState } from "@/simulation/weekend";

interface MarkerParts {
  container: Container;
  glyph: Container;
  motion: Graphics;
  ring: Graphics;
  label: Text;
  isPlayer: boolean;
  displayDistance: number;
  displayRoute: "TRACK" | "PIT" | null;
}

function interpolateDisplayDistance(current: number, target: number, deltaMs: number, speed: number): number {
  const smoothing = Math.min(1, deltaMs / (speed >= 8 ? 18 : 42));
  return current + (target - current) * smoothing;
}

function surfaceConditionAt(wetness: number, standingWater = 0): "DRY" | "DAMP" | "WET" | "HEAVY_WET" {
  const effectiveWater = Math.min(1, wetness + standingWater * 0.35);
  if (effectiveWater > 0.64) return "HEAVY_WET";
  if (effectiveWater > 0.28) return "WET";
  if (effectiveWater > 0.05) return "DAMP";
  return "DRY";
}

function raceMapViewport(width: number, height: number) {
  const intelligenceRailReserve = Math.min(320, Math.max(230, width * 0.29));
  const drawableWidth = Math.max(260, width - intelligenceRailReserve - 8);
  const padding = Math.max(20, Math.min(34, height * 0.1));
  return createTrackViewport(SILVERSTONE_CIRCUIT.points, drawableWidth, height, padding);
}

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
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
  const tyreChangeComplete = Boolean(selectedCar?.lastPitStopTime !== null
    && selectedCar?.lastPitStopCompletedAt != null
    && snapshot
    && snapshot.elapsedTime - selectedCar.lastPitStopCompletedAt < 4.5);
  const showPitTiming = Boolean(selectedCar && (selectedCar.pitStatus !== "TRACK" || tyreChangeComplete));
  const displayedTyreChangeSeconds = tyreChangeComplete
    ? selectedCar?.lastPitStopTime ?? 0
    : selectedCar?.pitTyreServiceElapsedSeconds ?? selectedCar?.pitTimer ?? 0;
  const servingPenaltyHold = selectedCar?.pitServicePhase === "PENALTY_HOLD" || selectedCar?.pitServicePhase === "STOP_GO_HOLD";
  const penaltyHoldElapsed = selectedCar?.penaltyHoldElapsedSeconds ?? 0;
  const penaltyHoldTarget = selectedCar?.penaltyHoldSeconds ?? 0;
  const displayedPitLaneSeconds = selectedCar?.pitStatus === "TRACK"
    ? selectedCar.lastPitLaneTime ?? 0
    : selectedCar?.pitLaneTimer ?? 0;
  const sectorSurface = ([1, 2, 3] as const).map((sector) => {
    const state = snapshot?.weather.sectors?.find((candidate) => candidate.sector === sector);
    const wetness = state?.wetness ?? snapshot?.weather.trackWetness ?? 0;
    return { sector, wetness, condition: surfaceConditionAt(wetness, state?.standingWater) };
  });
  const surfaceConditions = new Set(sectorSurface.map((sector) => sector.condition));
  const surfaceSummary = surfaceConditions.size > 1 ? "MIXED" : sectorSurface[0].condition.replace("_", " ");

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
        resolution: Math.min(window.devicePixelRatio, 2),
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }

      host.appendChild(app.canvas);
      host.dataset.overtakeDetectionDistance = SILVERSTONE_OVERTAKE_DETECTION_DISTANCE.toFixed(1);
      host.dataset.overtakeActivationDistance = SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE.toFixed(1);
      host.dataset.cornerCount = String(SILVERSTONE_CORNERS.length);
      host.dataset.pitLaneRenderer = "RACE_SHARED";
      host.dataset.trackRenderer = "PIXI_RACE_MAP";
      host.dataset.motionModel = "RACE_SHARED_INTERPOLATION";
      host.dataset.snapshotAgeCapSeconds = "0.2";
      app.canvas.setAttribute("aria-label", "Silverstone Circuit live track map. Four wing-open Straight Mode sections, Overtake detection after Turn 17 and activation before Turn 18.");
      app.canvas.setAttribute("role", "img");

      const trackLayer = new PIXI.Container();
      const battleLayer = new PIXI.Graphics();
      const markerLayer = new PIXI.Container();
      const alertLayer = new PIXI.Container();
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
      let viewport = raceMapViewport(app.screen.width, app.screen.height);
      let projectedCenterline = SILVERSTONE_CIRCUIT.points.map((point) => projectTrackPoint(point, viewport));

      const markers = new Map<string, MarkerParts>();
      const incidentBadge = new PIXI.Container();
      const incidentShape = new PIXI.Graphics().circle(0, 0, 11).fill({ color: 0x251007, alpha: 0.96 }).stroke({ width: 2, color: 0xffc84a });
      const incidentText = new PIXI.Text({ text: "!", style: { fontFamily: "Arial, sans-serif", fontSize: 13, fontWeight: "900", fill: 0xffd46b } });
      incidentText.anchor.set(0.5);
      incidentBadge.addChild(incidentShape, incidentText);
      incidentBadge.visible = false;
      const safetyCarBadge = new PIXI.Container();
      const safetyShape = new PIXI.Graphics().roundRect(-16, -9, 32, 18, 4).fill({ color: 0xf4d35e }).stroke({ width: 2, color: 0x231f08 });
      const safetyText = new PIXI.Text({ text: "SC", style: { fontFamily: "Arial, sans-serif", fontSize: 9, fontWeight: "900", fill: 0x181505 } });
      safetyText.anchor.set(0.5);
      safetyCarBadge.addChild(safetyShape, safetyText);
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
        SILVERSTONE_CIRCUIT.segments.forEach((segment) => {
          if (control === "YELLOW" && sectorAtDistance(segment.startDistance) !== yellowSector) return;
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
          const color = effectiveWater > 0.64 ? 0x245bff : effectiveWater > 0.27 ? 0x398cff : 0x20d7e7;
          const samples = Math.max(2, Math.ceil((zone.endDistance - zone.startDistance) / 24));
          for (let index = 0; index <= samples; index += 1) {
            const distance = zone.startDistance + ((zone.endDistance - zone.startDistance) * index) / samples;
            const point = projectTrackPoint(pointAtDistance(distance), viewport);
            if (index === 0) surfaceLayer.moveTo(point.x, point.y);
            else surfaceLayer.lineTo(point.x, point.y);
          }
          surfaceLayer.stroke({ width: 6, color, alpha: 0.22 + effectiveWater * 0.58, cap: "round", join: "round" });
        });
      }

      function projectPitPoint(distance: number) {
        const routeStart = PIT_ENTRY_START;
        const routeEnd = SILVERSTONE_CIRCUIT.lengthMeters + PIT_EXIT_END;
        const progress = Math.min(1, Math.max(0, (distance - routeStart) / Math.max(1, routeEnd - routeStart)));
        const entry = projectTrackPoint(pointAtDistance(routeStart), viewport);
        const exit = projectTrackPoint(pointAtDistance(PIT_EXIT_END), viewport);
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
        if (progress <= mergeFraction) {
          const mergeProgress = progress / mergeFraction;
          return { x: entry.x + (straightStart.x - entry.x) * mergeProgress, y: entry.y + (straightStart.y - entry.y) * mergeProgress };
        }
        if (progress >= 1 - mergeFraction) {
          const mergeProgress = (progress - (1 - mergeFraction)) / mergeFraction;
          return { x: straightEnd.x + (exit.x - straightEnd.x) * mergeProgress, y: straightEnd.y + (exit.y - straightEnd.y) * mergeProgress };
        }
        const straightProgress = (progress - mergeFraction) / (1 - mergeFraction * 2);
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
        markers.set(driver.id, { container, glyph, motion, ring, label, isPlayer, displayDistance: 0, displayRoute: null });
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

        SILVERSTONE_CIRCUIT.segments.forEach((segment) => {
          if (!segment.activeAeroAllowed) return;
          const p1 = projectTrackPoint(segment.p1, viewport);
          const p2 = projectTrackPoint(segment.p2, viewport);
          aeroLayer.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ width: 3, color: 0x20d7e7, alpha: 0.38, cap: "butt" });
        });

        for (let distance = PIT_ENTRY_START; distance <= SILVERSTONE_CIRCUIT.lengthMeters + PIT_EXIT_END; distance += 12) {
          const point = projectPitPoint(distance);
          if (distance === PIT_ENTRY_START) pitLane.moveTo(point.x, point.y);
          else pitLane.lineTo(point.x, point.y);
        }
        pitLane.stroke({ width: 2, color: 0xf2f5f6, alpha: 0.42, cap: "round", join: "round" });

        const centre = projectedCenterline.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        centre.x /= projectedCenterline.length;
        centre.y /= projectedCenterline.length;

        SILVERSTONE_STRAIGHT_MODE_ZONES.forEach((zone) => {
          const distance = ((zone.startRatio + zone.endRatio) / 2) * SILVERSTONE_CIRCUIT.lengthMeters;
          const point = projectTrackPoint(pointAtDistance(distance), viewport);
          const before = projectTrackPoint(pointAtDistance(distance - 5), viewport);
          const after = projectTrackPoint(pointAtDistance(distance + 5), viewport);
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
            .stroke({ width: 1, color: 0x20d7e7, alpha: 0.72 });
          const text = new PIXI.Text({ text: `${zone.id} ↔`, style: { fontFamily: "Arial, sans-serif", fontSize: 7, fontWeight: "900", fill: 0x20d7e7 } });
          text.anchor.set(0.5);
          text.position.set(x, y + 0.2);
          aeroLabelLayer.addChild(plate, text);
        });

        const drawOvertakeLine = (distance: number, label: string, color: number, outward: boolean) => {
          const point = projectTrackPoint(pointAtDistance(distance), viewport);
          const before = projectTrackPoint(pointAtDistance(distance - 4), viewport);
          const after = projectTrackPoint(pointAtDistance(distance + 4), viewport);
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
        drawOvertakeLine(SILVERSTONE_OVERTAKE_DETECTION_DISTANCE, "DET", 0xffd34d, true);
        drawOvertakeLine(SILVERSTONE_OVERTAKE_ACTIVATION_DISTANCE, "OVT", 0xff4d8f, false);

        SILVERSTONE_CORNERS.forEach((corner) => {
          const point = projectTrackPoint(pointAtDistance(corner.distanceMeters), viewport);
          const before = projectTrackPoint(pointAtDistance(corner.distanceMeters - 3), viewport);
          const after = projectTrackPoint(pointAtDistance(corner.distanceMeters + 3), viewport);
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
        viewport = raceMapViewport(app.screen.width, app.screen.height);
        projectedCenterline = SILVERSTONE_CIRCUIT.points.map((point) => projectTrackPoint(point, viewport));
        drawTrack();
        lastControlKey = "";
        lastSpatialWeatherKey = "";
      }
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      let lastTime = performance.now();
      function animate(now: number) {
        if (!app) return;
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
            : Math.min(0.2, Math.max(0, (now - qualifyingReceivedAtRef.current) / 1_000));
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
              continue;
            }
            visibleDriverCount += 1;
            const extrapolatedCar = car.phase === "GARAGE"
              ? car
              : { ...car, phaseRemainingSeconds: Math.max(0, car.phaseRemainingSeconds - qualifyingSnapshotAgeSeconds * qualifying.speed) };
            const progress = qualifyingCarProgress(extrapolatedCar);
            let route: "TRACK" | "PIT" = "TRACK";
            let targetDistance = 0;
            if (car.phase === "OUT_LAP" && progress < 0.12) {
              route = "PIT";
              targetDistance = PIT_BOX_DISTANCE + (SILVERSTONE_CIRCUIT.lengthMeters + PIT_EXIT_END - PIT_BOX_DISTANCE) * (progress / 0.12);
            } else if (car.phase === "OUT_LAP") {
              const trackProgress = (progress - 0.12) / 0.88;
              targetDistance = PIT_EXIT_END + (SILVERSTONE_CIRCUIT.lengthMeters - PIT_EXIT_END) * trackProgress;
            } else if (car.phase === "COOL_DOWN") {
              const trackProgress = car.phaseStartProgress + (1 - car.phaseStartProgress) * progress;
              targetDistance = trackProgress * SILVERSTONE_CIRCUIT.lengthMeters;
            } else if (car.phase === "IN_LAP" && progress > 0.86) {
              route = "PIT";
              const pitProgress = (progress - 0.86) / 0.14;
              targetDistance = PIT_ENTRY_START + (PIT_BOX_DISTANCE - PIT_ENTRY_START) * pitProgress;
            } else {
              const trackProgress = car.phase === "IN_LAP" ? progress / 0.86 : progress;
              targetDistance = trackProgress * (car.phase === "IN_LAP" ? PIT_ENTRY_START : SILVERSTONE_CIRCUIT.lengthMeters);
            }
            const wasVisible = marker.container.visible;
            const routeChanged = wasVisible && marker.displayRoute !== route;
            marker.container.visible = true;
            const previousX = marker.container.position.x;
            const previousY = marker.container.position.y;
            if (!wasVisible || routeChanged) {
              marker.displayDistance = targetDistance;
            } else if (!qualifying.paused) {
              while (route === "TRACK" && targetDistance + SILVERSTONE_CIRCUIT.lengthMeters / 2 < marker.displayDistance) {
                targetDistance += SILVERSTONE_CIRCUIT.lengthMeters;
              }
              marker.displayDistance = interpolateDisplayDistance(marker.displayDistance, targetDistance, delta, qualifying.speed);
            }
            marker.displayRoute = route;
            const point = route === "PIT"
              ? projectPitPoint(marker.displayDistance)
              : projectTrackPoint(pointAtDistance(marker.displayDistance), viewport);
            marker.container.position.set(point.x, point.y);
            const frameStepPx = wasVisible ? Math.hypot(point.x - previousX, point.y - previousY) : 0;
            marker.glyph.position.set(0, 0);
            marker.glyph.rotation = 0;
            marker.motion.clear();
            marker.container.zIndex = 40 - (qualifyingPositionsRef.current.get(car.carId) ?? 30);
            const selected = state.selectedCarId === car.carId;
            marker.label.visible = true;
            marker.label.tint = selected ? 0x20d7e7 : 0xffffff;
            marker.ring.clear();
            const phaseColor = car.phase === "PUSH_LAP" ? 0xff334f : car.phase === "IN_LAP" || car.phase === "COOL_DOWN" ? 0x36dc79 : 0x20d7e7;
            marker.ring.circle(0, 0, marker.isPlayer ? 10 : 8).stroke({ width: selected ? 3 : 1.8, color: phaseColor, alpha: 0.96 });
            if (selected) {
              const activeHost = hostRef.current;
              if (activeHost) {
                activeHost.dataset.selectedCar = car.carId;
                activeHost.dataset.selectedX = marker.container.position.x.toFixed(2);
                activeHost.dataset.selectedY = marker.container.position.y.toFixed(2);
                activeHost.dataset.qualifyingPhase = car.phase;
                activeHost.dataset.qualifyingProgress = progress.toFixed(4);
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
            const incidentPoint = projectTrackPoint(pointAtDistance(snapshot.activeIncident.distanceMeters), viewport);
            incidentBadge.position.set(incidentPoint.x, incidentPoint.y);
            incidentBadge.visible = true;
          } else {
            incidentBadge.visible = false;
          }
          if (snapshot.raceControl === "SAFETY_CAR" && snapshot.safetyCarDistance !== null) {
            const pitReleaseProgress = Math.min(1, snapshot.safetyCarPhaseElapsedSeconds / 3.2);
            const safetyCarDisplayDistance = snapshot.safetyCarPhase === "DEPLOYED" && snapshot.safetyCarInPitLane
              ? PIT_BOX_DISTANCE + (SILVERSTONE_CIRCUIT.lengthMeters + PIT_EXIT_END - PIT_BOX_DISTANCE) * pitReleaseProgress
              : snapshot.safetyCarDistance;
            const safetyPoint = snapshot.safetyCarInPitLane
              ? projectPitPoint(safetyCarDisplayDistance)
              : projectTrackPoint(pointAtDistance(safetyCarDisplayDistance), viewport);
            safetyCarBadge.position.set(safetyPoint.x, safetyPoint.y);
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
            if (marker.displayDistance === 0) marker.displayDistance = car.totalDistance;
            const extrapolatedDistance = car.totalDistance + (state.paused ? 0 : (car.currentSpeed / 3.6) * snapshotAgeSeconds * state.speed);
            marker.displayDistance = interpolateDisplayDistance(marker.displayDistance, extrapolatedDistance, delta, state.speed);
            const p = car.pitStatus === "TRACK" ? projectTrackPoint(pointAtDistance(marker.displayDistance), viewport) : projectPitPoint(marker.displayDistance);
            let displayX = p.x;
            let displayY = p.y;
            marker.glyph.position.set(0, 0);
            marker.glyph.rotation = 0;
            marker.motion.clear();
            const incidentAge = Math.max(0, snapshot.elapsedTime - (car.incidentStartedAt ?? snapshot.elapsedTime));
            const incidentDirection = car.incidentDirection ?? 1;
            if (car.pitStatus === "TRACK" && car.incidentStatus !== "RUNNING") {
              const before = projectTrackPoint(pointAtDistance(marker.displayDistance - 4), viewport);
              const after = projectTrackPoint(pointAtDistance(marker.displayDistance + 4), viewport);
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
            marker.label.tint = selected ? 0x20d7e7 : 0xffffff;
            marker.ring.clear();
            const energyColor = car.energyMode === "ATTACK" || car.energyMode === "BOOST" || car.energyMode === "OVERTAKE"
              ? 0xff334f
              : car.energyMode === "HARVEST" || car.energyMode === "CONSERVE" ? 0x36dc79 : null;
            if (energyColor !== null) {
              marker.ring.circle(0, 0, 9).stroke({
                width: 1.8,
                color: energyColor,
                alpha: 0.95,
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
                activeHost.dataset.indicatorColor = energyColor === null ? "none" : `#${energyColor.toString(16).padStart(6, "0")}`;
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
        frame = requestAnimationFrame(animate);
      }
      frame = requestAnimationFrame(animate);
    }

    void mount();
    return () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      const canvas = app?.canvas;
      if (canvas?.parentElement === host) canvas.remove();
      if (app) app.destroy(false, { children: true });
    };
  }, [playerTeamId]);

  const qualifyingClassification = qualifyingState ? liveQualifyingClassification(qualifyingState) : [];
  const qualifyingCut = qualifyingState ? qualifyingCutPosition(qualifyingState) : null;

  return (
    <div className="track-map" data-map-mode={isQualifying ? "QUALIFYING" : "RACE"} ref={hostRef}>
      <div className="track-map__hud track-map__hud--top">
        <span>{isQualifying ? `${qualifyingLive?.session} LIVE CIRCUIT` : "LIVE CIRCUIT"}</span>
      </div>
      {!isQualifying && <aside className="track-intelligence-rail" aria-label="Circuit radio and local surface information">
        <TeamRadioOverlay />
        <div aria-live="polite" className="track-weather">
          <div className="track-weather__title"><span><CloudRain aria-hidden="true" size={15} /> LOCAL SURFACE</span><strong>{surfaceSummary}</strong></div>
          <div className="track-weather__sectors">{sectorSurface.map((sector) => <span className={`is-${sector.condition.toLowerCase().replace("_", "-")}`} key={sector.sector} title={`Sector ${sector.sector}: ${Math.round(sector.wetness * 100)}% wet`}><b>S{sector.sector}</b><strong>{Math.round(sector.wetness * 100)}%</strong><i style={{ "--wetness": `${Math.max(4, sector.wetness * 100)}%` } as CSSProperties} /><em>{sector.condition.replace("_", " ")}</em></span>)}</div>
          <small><Radar aria-hidden="true" size={13} />{snapshot?.weather.rainIntensity ? `RAIN CELL ${Math.round(snapshot.weather.rainIntensity * 100)}%` : snapshot?.weather.forecastRainInMinutes != null ? `ARRIVAL ${snapshot.weather.forecastRainInMinutes} MIN` : "RADAR CLEAR"}</small>
        </div>
      </aside>}
      {isQualifying && <aside className="track-intelligence-rail qualifying-map-rail" aria-label="Qualifying circuit information">
        <section>
          <header><span>QUALIFYING LIVE</span><strong>{qualifyingLive?.session}</strong></header>
          <div><span><small>ON TRACK</small><strong>{Object.values(qualifyingLive?.cars ?? {}).filter((car) => car.phase !== "GARAGE").length}</strong></span><span><small>CUT LINE</small><strong>{qualifyingCut ? `P${qualifyingCut}` : "POLE"}</strong></span></div>
          <ol>{(["OUT_LAP", "PUSH_LAP", "COOL_DOWN", "IN_LAP"] as const).map((phase) => <li key={phase}><i data-phase={phase} /><span>{phase === "PUSH_LAP" ? "FLYING LAP" : phase.replace("_", " ")}</span><strong>{qualifyingClassification.filter((entry) => entry.phase === phase).length}</strong></li>)}</ol>
          <footer>DRY QUALIFYING · PIT LANE OPEN</footer>
        </section>
      </aside>}
      {(startPhase === "LIGHTS" || startPhase === "GO") && <div className={`track-start-sequence ${startPhase === "GO" ? "is-go" : ""}`} data-track-start-phase={startPhase}><div>{Array.from({ length: 5 }, (_, index) => <i className={index < lightsOn ? "is-on" : ""} key={index} />)}</div><span>{startPhase === "GO" ? "LIGHTS OUT" : "START"}</span></div>}
      {!isQualifying && selectedCar && showPitTiming && (
        <div aria-live="assertive" className={`pit-timing-live ${tyreChangeComplete ? "is-tyre-complete" : ""}`} data-pit-status={tyreChangeComplete ? "TYRE_COMPLETE" : selectedCar.pitStatus} role="status">
          <header><span>{tyreChangeComplete ? "TYRE CHANGE COMPLETE" : "LIVE PIT STOP"}</span><strong>{tyreChangeComplete ? "RELEASED" : selectedCar.pitStatus.replace("PIT_", "")}</strong></header>
          <div><span><small>TOTAL PIT</small><strong>{displayedPitLaneSeconds.toFixed(1)}<em>s</em></strong></span><i /><span><small>TYRE CHANGE</small><strong>{displayedTyreChangeSeconds.toFixed(2)}<em>s</em></strong></span></div>
          <footer><span>2025 BENCH 2.08s · TYRE TARGET {(selectedCar.pitTyreServiceTargetSeconds ?? selectedCar.pitStopTargetSeconds).toFixed(2)}s</span><b>{tyreChangeComplete ? "WHEELS ON" : servingPenaltyHold ? "WAITING" : selectedCar.pitStopIssue.replace("_", " ")}</b></footer>
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
        <span><i className="legend-line" />STRAIGHT MODE · WING OPEN</span>
        <span><i className="legend-line legend-line--detection" />OVERTAKE DET.</span>
        <span><i className="legend-line legend-line--pit" />PIT LANE</span>
      </div>
    </div>
  );
}
