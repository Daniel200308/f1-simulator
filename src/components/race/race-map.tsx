"use client";

import { useEffect, useRef } from "react";
import type { Application, Container, Graphics, Text } from "pixi.js";

import { DEFAULT_PLAYER_TEAM_ID, DRIVERS, TEAM_BY_ID } from "@/fixtures/grid";
import { createTrackViewport, distanceToCenterline, projectTrackPoint } from "@/components/race/track-viewport";
import { PIT_ENTRY_START, PIT_EXIT_END } from "@/simulation/engine";
import { pointAtDistance, sectorAtDistance, SILVERSTONE_CIRCUIT, SILVERSTONE_CORNERS } from "@/simulation/track";
import { useRaceStore } from "@/store/race-store";

interface MarkerParts {
  container: Container;
  ring: Graphics;
  label: Text;
  isPlayer: boolean;
  displayDistance: number;
}

function surfaceConditionAt(wetness: number, standingWater = 0): "DRY" | "DAMP" | "WET" | "HEAVY_WET" {
  const effectiveWater = Math.min(1, wetness + standingWater * 0.35);
  if (effectiveWater > 0.64) return "HEAVY_WET";
  if (effectiveWater > 0.28) return "WET";
  if (effectiveWater > 0.05) return "DAMP";
  return "DRY";
}

export function RaceMap({ startPhase, lightsOn }: { startPhase: "MENU" | "LIGHTS" | "GO" | "RACING"; lightsOn: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const snapshot = useRaceStore((state) => state.snapshot);
  const selectedCarId = useRaceStore((state) => state.selectedCarId);
  const playerTeamId = snapshot?.playerTeamId ?? DEFAULT_PLAYER_TEAM_ID;
  const selectedCar = snapshot?.cars.find((car) => car.carId === selectedCarId);
  const sectorSurface = ([1, 2, 3] as const).map((sector) => {
    const state = snapshot?.weather.sectors?.find((candidate) => candidate.sector === sector);
    const wetness = state?.wetness ?? snapshot?.weather.trackWetness ?? 0;
    return { sector, wetness, condition: surfaceConditionAt(wetness, state?.standingWater) };
  });
  const surfaceConditions = new Set(sectorSurface.map((sector) => sector.condition));
  const surfaceSummary = surfaceConditions.size > 1 ? "MIXED" : sectorSurface[0].condition.replace("_", " ");

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
        height: Math.max(360, host.clientHeight),
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
      app.canvas.setAttribute("aria-label", "Silverstone Circuit live track map");
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
      const cornerLayer = new PIXI.Container();
      trackLayer.addChild(trackBase, surfaceLayer, aeroLayer, pitLane, trackEdge, controlOverlay, startLine, cornerLayer);
      let viewport = createTrackViewport(SILVERSTONE_CIRCUIT.points, app.screen.width, app.screen.height);
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
        const point = projectTrackPoint(pointAtDistance(distance), viewport);
        const before = projectTrackPoint(pointAtDistance(distance - 2), viewport);
        const after = projectTrackPoint(pointAtDistance(distance + 2), viewport);
        const magnitude = Math.max(0.000001, Math.hypot(after.x - before.x, after.y - before.y));
        return { x: point.x - ((after.y - before.y) / magnitude) * 9, y: point.y + ((after.x - before.x) / magnitude) * 9 };
      }
      DRIVERS.forEach((driver) => {
        const team = TEAM_BY_ID.get(driver.teamId);
        if (!team) return;
        const isPlayer = driver.teamId === playerTeamId;

        const container = new PIXI.Container();
        container.eventMode = "static";
        container.cursor = "pointer";
        container.hitArea = new PIXI.Circle(0, 0, 14);

        const ring = new PIXI.Graphics();
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
        container.addChild(ring, dot, label);
        container.on("pointertap", () => useRaceStore.getState().setSelectedCarId(driver.id));
        markerLayer.addChild(container);
        markers.set(driver.id, { container, ring, label, isPlayer, displayDistance: 0 });
      });

      function drawTrack() {
        trackBase.clear();
        trackEdge.clear();
        aeroLayer.clear();
        startLine.clear();
        pitLane.clear();
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
        const height = Math.max(360, host.clientHeight);
        app.renderer.resize(width, height);
        viewport = createTrackViewport(SILVERSTONE_CIRCUIT.points, app.screen.width, app.screen.height);
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
        if (snapshot) {
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
            const safetyPoint = snapshot.safetyCarInPitLane
              ? projectPitPoint(snapshot.safetyCarDistance)
              : projectTrackPoint(pointAtDistance(snapshot.safetyCarDistance), viewport);
            safetyCarBadge.position.set(safetyPoint.x, safetyPoint.y);
            safetyCarBadge.visible = true;
          } else {
            safetyCarBadge.visible = false;
          }
          const snapshotAgeSeconds = Math.min(0.2, Math.max(0, (Date.now() - state.snapshotReceivedAt) / 1_000));
          for (const car of snapshot.cars) {
            const marker = markers.get(car.carId);
            if (!marker) continue;
            if (marker.displayDistance === 0) marker.displayDistance = car.totalDistance;
            const extrapolatedDistance = car.totalDistance + (state.paused ? 0 : (car.currentSpeed / 3.6) * snapshotAgeSeconds * state.speed);
            const smoothing = Math.min(1, delta / (state.speed >= 8 ? 18 : 42));
            marker.displayDistance += (extrapolatedDistance - marker.displayDistance) * smoothing;
            const p = car.pitStatus === "TRACK" ? projectTrackPoint(pointAtDistance(marker.displayDistance), viewport) : projectPitPoint(marker.displayDistance);
            marker.container.position.set(p.x, p.y);
            marker.container.zIndex = 30 - car.racePosition;
            const selected = state.selectedCarId === car.carId;
            marker.label.visible = true;
            marker.label.tint = selected ? 0x20d7e7 : 0xffffff;
            marker.ring.clear();
            const energyColor = car.energyMode === "ATTACK" ? 0xff334f : car.energyMode === "DEFEND" ? 0x398cff : car.energyMode === "RECHARGE" ? 0x36dc79 : null;
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
          for (const car of snapshot.cars) {
            if (!car.battleCarId || (car.battleStatus !== "ATTACKING" && car.battleStatus !== "SIDE_BY_SIDE")) continue;
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
      if (app) app.destroy(true, { children: true });
      host.replaceChildren();
    };
  }, [playerTeamId]);

  return (
    <div className="track-map" ref={hostRef}>
      <div className="track-map__hud track-map__hud--top">
        <span>LIVE CIRCUIT</span>
      </div>
      {(startPhase === "LIGHTS" || startPhase === "GO") && <div className={`track-start-sequence ${startPhase === "GO" ? "is-go" : ""}`} data-track-start-phase={startPhase}><div>{Array.from({ length: 5 }, (_, index) => <i className={index < lightsOn ? "is-on" : ""} key={index} />)}</div><span>{startPhase === "GO" ? "LIGHTS OUT" : "START"}</span></div>}
      {selectedCar && selectedCar.pitStatus !== "TRACK" && (
        <div className="pit-timing-live" data-pit-status={selectedCar.pitStatus} role="status">
          <header><span>LIVE PIT STOP</span><strong>{selectedCar.pitStatus.replace("PIT_", "")}</strong></header>
          <div><span><small>TOTAL PIT</small><strong>{selectedCar.pitLaneTimer.toFixed(1)}<em>s</em></strong></span><i /><span><small>TYRE CHANGE</small><strong>{selectedCar.pitTimer.toFixed(2)}<em>s</em></strong></span></div>
          <footer><span>STOP TARGET {selectedCar.pitStopTargetSeconds.toFixed(2)}s</span><b>{selectedCar.pitStopIssue.replace("_", " ")}</b></footer>
        </div>
      )}
      <div className="track-weather">
        <div className="track-weather__title"><span>LOCAL SURFACE</span><strong>{surfaceSummary}</strong></div>
        <div className="track-weather__sectors">{sectorSurface.map((sector) => <span className={`is-${sector.condition.toLowerCase().replace("_", "-")}`} key={sector.sector} title={`Sector ${sector.sector}: ${Math.round(sector.wetness * 100)}% wet`}><i /><b>S{sector.sector}</b><em>{sector.condition.replace("_", " ")}</em></span>)}</div>
        <small>{snapshot?.weather.rainIntensity ? `RADAR · RAIN ${Math.round(snapshot.weather.rainIntensity * 100)}%` : snapshot?.weather.forecastRainInMinutes != null ? `RADAR · ARRIVAL ${snapshot.weather.forecastRainInMinutes} MIN` : "RADAR · CLEAR"}</small>
      </div>
      <div className="track-map__legend">
        <span><i className="legend-dot legend-dot--player" />PLAYER</span>
        <span><i className="legend-line" />ACTIVE AERO</span>
        <span><i className="legend-line legend-line--pit" />PIT LANE</span>
      </div>
    </div>
  );
}
