import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = "http://127.0.0.1:3000";
const results = { passed: [], viewports: {}, motion: {}, phases: [], map: {} };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function enterQ1(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  for (const session of ["FP1", "FP2", "FP3"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await page.getByRole("button", { name: /ACKNOWLEDGE REPORT/i }).click();
  }
  await page.locator('main[data-qualifying-session="Q1"]').waitFor();
  await page.locator('.track-map[data-map-mode="QUALIFYING"] canvas').waitFor();
}

async function fitMetrics(page, label) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector("main[data-qualifying-session]");
    const strip = shell?.querySelector(".command-strip");
    const stripRect = strip?.getBoundingClientRect();
    const tower = shell?.querySelector('[aria-label="Qualifying leaderboard"]');
    const rows = tower?.lastElementChild;
    const lastRow = rows?.lastElementChild?.getBoundingClientRect();
    const firstRow = rows?.firstElementChild;
    const timer = shell?.querySelector('[aria-label$="remaining"] strong');
    const regions = [shell?.querySelector("header.topbar"), shell?.querySelector("section.race-grid"), tower, shell?.querySelector("section.map-column"), shell?.querySelector("aside.status-column"), strip].filter(Boolean).map((element) => {
      const rect = element.getBoundingClientRect();
      return { className: element.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const columns = firstRow ? getComputedStyle(firstRow).gridTemplateColumns.split(" ").map((value) => parseFloat(value)) : [];
    return {
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      regions,
      commandStrip: stripRect ? { left: stripRect.left, top: stripRect.top, right: stripRect.right, bottom: stripRect.bottom } : null,
      commandButtons: strip ? [...strip.querySelectorAll("button")].map((button) => { const rect = button.getBoundingClientRect(); return { name: button.textContent?.trim(), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; }) : [],
      commandTransform: strip?.firstElementChild ? getComputedStyle(strip.firstElementChild).transform : null,
      rowArea: rows ? { scrollHeight: rows.scrollHeight, clientHeight: rows.clientHeight } : null,
      lastRow: lastRow ? { left: lastRow.left, top: lastRow.top, right: lastRow.right, bottom: lastRow.bottom } : null,
      towerBounds: tower ? (() => { const rect = tower.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })() : null,
      timerFontSize: timer ? parseFloat(getComputedStyle(timer).fontSize) : 0,
      columnGap: firstRow ? parseFloat(getComputedStyle(firstRow).columnGap) : 0,
      columns,
      clippedTimingCells: rows ? [...rows.querySelectorAll("strong, small, time, em")].filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => ({ text: cell.textContent, scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth })) : [],
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check(metrics.regions.length === 6 && metrics.regions.every((region) => region.left >= 0 && region.top >= 0 && region.right <= metrics.innerWidth && region.bottom <= metrics.innerHeight), `${label} primary regions fit the viewport`, metrics.regions);
  check(Boolean(metrics.commandStrip) && metrics.commandButtons.every((button) => button.left >= metrics.commandStrip.left && button.right <= metrics.commandStrip.right && button.top >= metrics.commandStrip.top && button.bottom <= metrics.commandStrip.bottom), `${label} operations controls are not clipped`, { strip: metrics.commandStrip, buttons: metrics.commandButtons });
  check(metrics.commandTransform === "none", `${label} command surface is not scale-compressed`, metrics.commandTransform);
  check(Boolean(metrics.lastRow && metrics.towerBounds) && metrics.lastRow.bottom <= metrics.towerBounds.bottom, `${label} shows all 22 leaderboard rows`, { lastRow: metrics.lastRow, tower: metrics.towerBounds, rowArea: metrics.rowArea });
  check(metrics.clippedTimingCells.length === 0, `${label} leaderboard text is not clipped`, metrics.clippedTimingCells);
  check(metrics.columns.length === 5 && metrics.columns[2] <= 30 && metrics.columns[3] <= 70 && metrics.columns[4] <= 56 && metrics.columnGap <= 3.1, `${label} uses compact race-like TYRE / TIME / GAP spacing`, { columns: metrics.columns, columnGap: metrics.columnGap });
  check(metrics.timerFontSize >= 27, `${label} keeps the large topbar timer`, metrics.timerFontSize);
  results.viewports[label] = metrics;
}

async function sampleMotion(page, durationMs) {
  return page.evaluate(async (duration) => {
    const map = document.querySelector('.track-map[data-map-mode="QUALIFYING"]');
    const samples = [];
    const started = performance.now();
    await new Promise((resolve) => {
      const frame = () => {
        samples.push({
          at: performance.now() - started,
          x: Number(map.dataset.selectedX),
          y: Number(map.dataset.selectedY),
          step: Number(map.dataset.frameStepPx),
          phase: map.dataset.qualifyingPhase,
          route: map.dataset.qualifyingRoute,
          progress: Number(map.dataset.qualifyingProgress),
          distance: Number(map.dataset.selectedDistance),
          centerlineError: map.dataset.centerlineErrorPx === "PIT_LANE" ? null : Number(map.dataset.centerlineErrorPx),
        });
        if (performance.now() - started >= duration) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const deltas = samples.slice(1).map((sample, index) => Math.hypot(sample.x - samples[index].x, sample.y - samples[index].y));
    const maxDelta = Math.max(0, ...deltas);
    const maxDeltaIndex = deltas.indexOf(maxDelta);
    return {
      samples: samples.length,
      movingFrames: deltas.filter((delta) => delta > 0.015).length,
      maxCoordinateDelta: maxDelta,
      maxDeltaTransition: maxDeltaIndex >= 0 ? { before: samples[maxDeltaIndex], after: samples[maxDeltaIndex + 1] } : null,
      maxRendererStep: Math.max(0, ...samples.map((sample) => sample.step)),
      phases: [...new Set(samples.map((sample) => sample.phase))],
      routes: [...new Set(samples.map((sample) => sample.route))],
      maxCenterlineError: Math.max(0, ...samples.map((sample) => sample.centerlineError ?? 0)),
    };
  }, durationMs);
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await enterQ1(desktop);

  const mapFacts = await desktop.locator('.track-map[data-map-mode="QUALIFYING"]').evaluate((map) => ({
    renderer: map.dataset.trackRenderer,
    pitLane: map.dataset.pitLaneRenderer,
    corners: Number(map.dataset.cornerCount),
    canvasCount: map.querySelectorAll("canvas").length,
    wetSurfaceCount: map.querySelectorAll(".track-weather").length,
  }));
  results.map = mapFacts;
  check(mapFacts.renderer === "PIXI_RACE_MAP" && mapFacts.canvasCount === 1, "qualifying reuses the race Pixi map");
  check(mapFacts.pitLane === "RACE_SHARED" && mapFacts.corners === 18, "qualifying reuses the race pit lane and all 18 corners", mapFacts);
  check(mapFacts.wetSurfaceCount === 0, "qualifying remains dry");
  check(await desktop.getByRole("button", { name: "Release Car Now" }).isDisabled(), "Release Car is disabled before the session starts");
  check(await desktop.getByRole("button", { name: "Abort Lap and Cool Down" }).isDisabled(), "Abort Lap is disabled outside a flying lap");
  check(await desktop.getByText("FLYING", { exact: true }).first().isVisible(), "release forecast shows the flying-lap ETA");
  check(await desktop.getByText("FINISH", { exact: true }).first().isVisible(), "release forecast shows chequered-flag feasibility");
  await fitMetrics(desktop, "1600x900 ready");
  await desktop.screenshot({ path: resolve("qa/qualifying-operations-ready-1600x900.png"), type: "png" });

  await desktop.getByRole("button", { name: "Set out lap pace FAST" }).click();
  await desktop.getByRole("button", { name: "Set flying lap attack MAXIMUM" }).click();
  check(await desktop.getByRole("button", { name: "Set out lap pace FAST" }).getAttribute("aria-pressed") === "true", "Fast Preparation can be selected");
  check(await desktop.getByRole("button", { name: "Set flying lap attack MAXIMUM" }).getAttribute("aria-pressed") === "true", "Maximum flying-lap attack can be selected");

  await desktop.getByRole("button", { name: "START Q1", exact: true }).click();
  for (const speed of [1, 2, 4, 8, 16]) {
    const control = desktop.getByRole("button", { name: `Set simulation speed to ${speed} times` });
    await control.click();
    check(await control.getAttribute("aria-pressed") === "true", `${speed}x qualifying speed works`);
  }
  await desktop.getByRole("button", { name: "Set simulation speed to 1 times" }).click();
  await desktop.getByRole("button", { name: "Wait for Gap" }).click();
  await desktop.locator('.track-map[data-qualifying-phase="OUT_LAP"]').waitFor({ timeout: 3_000 });
  check(await desktop.locator('[data-car-id="ferrari-1"][data-lap-status="OUT LAP"]').isVisible(), "Wait for Gap releases the first player car into an out lap");
  const normalSpeedMotion = await sampleMotion(desktop, 1_300);
  results.motion.normalSpeed = normalSpeedMotion;
  check(normalSpeedMotion.movingFrames / Math.max(1, normalSpeedMotion.samples - 1) > 0.68, "1x out-lap movement is continuous instead of updating once per second", normalSpeedMotion);
  check(normalSpeedMotion.maxCoordinateDelta < 5 && normalSpeedMotion.maxRendererStep < 5, "1x marker motion has no visible step jump", normalSpeedMotion);

  await desktop.getByRole("button", { name: "Control Lewis Hamilton, car 44" }).click();
  await desktop.getByRole("button", { name: "Release Car Now" }).click();
  await desktop.locator('[data-car-id="ferrari-2"][data-lap-status="OUT LAP"]').waitFor({ timeout: 3_000 });
  check(true, "Release Now independently releases the second player car");
  await desktop.getByRole("button", { name: "Control Charles Leclerc, car 16" }).click();
  await desktop.getByRole("button", { name: "Set simulation speed to 16 times" }).click();

  const outLapMotion = await sampleMotion(desktop, 4_200);
  results.motion.outLap = outLapMotion;
  check(outLapMotion.samples > 120 && outLapMotion.movingFrames / Math.max(1, outLapMotion.samples - 1) > 0.72, "out-lap marker moves continuously between simulation updates", outLapMotion);
  check(outLapMotion.maxCoordinateDelta < 14 && outLapMotion.maxRendererStep < 14, "out-lap and pit-exit transitions have no marker jump", outLapMotion);
  check(outLapMotion.maxCenterlineError <= 0.001, "track-route samples stay on the race centerline", outLapMotion);

  await desktop.locator('.track-map[data-qualifying-phase="PUSH_LAP"]').waitFor({ timeout: 8_000 });
  results.phases.push("OUT LAP", "FLYING LAP");
  const flyingMotion = await sampleMotion(desktop, 1_600);
  results.motion.flyingLap = flyingMotion;
  check(flyingMotion.movingFrames / Math.max(1, flyingMotion.samples - 1) > 0.78, "flying-lap marker movement remains continuous", flyingMotion);
  check(flyingMotion.maxCoordinateDelta < 14 && flyingMotion.maxRendererStep < 14, "flying-lap marker does not jump backward or teleport", flyingMotion);
  check(flyingMotion.maxCenterlineError <= 0.001, "flying lap follows the exact race line", flyingMotion);
  check(await desktop.getByRole("button", { name: "Abort Lap and Cool Down" }).isEnabled(), "Abort Lap becomes available on a flying lap");
  const batteryBeforeAbort = Number(await desktop.locator('[data-car-id="ferrari-1"]').getAttribute("data-battery-percent"));
  await desktop.getByRole("button", { name: "Abort Lap and Cool Down" }).click();
  await desktop.locator('.track-map[data-qualifying-phase="COOL_DOWN"]').waitFor();
  results.phases.push("COOL DOWN");
  await desktop.waitForTimeout(700);
  const batteryAfterAbort = Number(await desktop.locator('[data-car-id="ferrari-1"]').getAttribute("data-battery-percent"));
  check(batteryAfterAbort > batteryBeforeAbort, "cool-down lap recovers battery energy", { batteryBeforeAbort, batteryAfterAbort });
  check(await desktop.locator('[data-car-id="ferrari-1"][data-lap-status="COOL DOWN"]').isVisible(), "aborting a flying lap changes the live status to COOL DOWN");
  await fitMetrics(desktop, "1600x900 live");
  await desktop.screenshot({ path: resolve("qa/qualifying-operations-live-1600x900.png"), type: "png" });

  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await enterQ1(compact);
  await fitMetrics(compact, "1280x720 ready");
  await compact.screenshot({ path: resolve("qa/qualifying-operations-ready-1280x720.png"), type: "png" });
} finally {
  await browser.close();
}

await writeFile(resolve("qa/qualifying-operations-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
