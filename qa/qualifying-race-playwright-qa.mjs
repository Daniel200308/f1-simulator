import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = "http://127.0.0.1:3000";
const results = { passed: [], viewports: {}, phases: [], map: {} };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function enterQ1(page, capturePractice = false) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  await page.getByRole("button", { name: "RUN FP1" }).waitFor();
  if (capturePractice) await page.screenshot({ path: resolve("qa/qualifying-race-fp1-1600x900.png"), type: "png" });
  for (const session of ["FP1", "FP2", "FP3"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await page.getByRole("button", { name: /ACKNOWLEDGE REPORT/i }).click();
  }
  await page.locator('main[data-qualifying-session="Q1"]').waitFor();
  await page.locator('.track-map[data-map-mode="QUALIFYING"] canvas').waitFor();
}

async function fitMetrics(page, label, requireAllRows = false) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector("main[data-qualifying-session]");
    const strip = shell?.querySelector(".command-strip");
    const stripRect = strip?.getBoundingClientRect();
    const tower = shell?.querySelector('[aria-label="Qualifying leaderboard"]');
    const rows = tower?.lastElementChild;
    const lastRow = rows?.lastElementChild?.getBoundingClientRect();
    const timer = shell?.querySelector('[aria-label$="remaining"] strong');
    const regions = [shell?.querySelector("header.topbar"), shell?.querySelector("section.race-grid"), tower, shell?.querySelector("section.map-column"), shell?.querySelector("aside.status-column"), strip].filter(Boolean).map((element) => {
      const rect = element.getBoundingClientRect();
      return { className: element.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    return {
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      regions,
      commandStrip: stripRect ? { left: stripRect.left, top: stripRect.top, right: stripRect.right, bottom: stripRect.bottom } : null,
      commandButtons: strip ? [...strip.querySelectorAll("button")].map((button) => { const rect = button.getBoundingClientRect(); return { name: button.textContent?.trim(), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; }) : [],
      rowArea: rows ? { scrollHeight: rows.scrollHeight, clientHeight: rows.clientHeight } : null,
      lastRow: lastRow ? { left: lastRow.left, top: lastRow.top, right: lastRow.right, bottom: lastRow.bottom } : null,
      towerBounds: tower ? (() => { const rect = tower.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })() : null,
      timerFontSize: timer ? parseFloat(getComputedStyle(timer).fontSize) : 0,
      timingTypography: rows?.firstElementChild ? (() => { const row = rows.firstElementChild; return { driver: parseFloat(getComputedStyle(row.querySelector("strong")).fontSize), best: parseFloat(getComputedStyle(row.querySelector("time")).fontSize), gap: parseFloat(getComputedStyle(row.querySelector("em")).fontSize) }; })() : null,
      clippedTimingCells: rows ? [...rows.querySelectorAll("strong, small, time, em")].filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => ({ text: cell.textContent, scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth })) : [],
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check(metrics.regions.length === 6 && metrics.regions.every((region) => region.left >= 0 && region.top >= 0 && region.right <= metrics.innerWidth && region.bottom <= metrics.innerHeight), `${label} primary race regions fit the viewport`, metrics.regions);
  check(Boolean(metrics.commandStrip) && metrics.commandButtons.every((button) => button.left >= metrics.commandStrip.left && button.right <= metrics.commandStrip.right && button.top >= metrics.commandStrip.top && button.bottom <= metrics.commandStrip.bottom), `${label} race-style command buttons are not clipped`, { strip: metrics.commandStrip, buttons: metrics.commandButtons });
  if (requireAllRows) check(Boolean(metrics.lastRow && metrics.towerBounds) && metrics.lastRow.bottom <= metrics.towerBounds.bottom, `${label} shows all 22 leaderboard rows without cutting the last row`, { lastRow: metrics.lastRow, tower: metrics.towerBounds, rowArea: metrics.rowArea });
  check(metrics.timerFontSize >= 27, `${label} session timer is a large topbar readout`, metrics.timerFontSize);
  check(Boolean(metrics.timingTypography) && metrics.timingTypography.driver >= 13 && metrics.timingTypography.best >= 11 && metrics.timingTypography.gap >= 12, `${label} leaderboard timing text is enlarged`, metrics.timingTypography);
  check(metrics.clippedTimingCells.length === 0, `${label} leaderboard text is not clipped`, metrics.clippedTimingCells);
  results.viewports[label] = metrics;
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await enterQ1(desktop, true);

  const mapFacts = await desktop.locator('.track-map[data-map-mode="QUALIFYING"]').evaluate((map) => ({
    renderer: map.dataset.trackRenderer,
    pitLane: map.dataset.pitLaneRenderer,
    corners: Number(map.dataset.cornerCount),
    canvasCount: map.querySelectorAll("canvas").length,
    svgCount: map.querySelectorAll("svg").length,
    wetSurfaceCount: map.querySelectorAll(".track-weather").length,
  }));
  results.map = mapFacts;
  check(mapFacts.renderer === "PIXI_RACE_MAP" && mapFacts.canvasCount === 1 && mapFacts.svgCount === 0, "qualifying directly reuses the race Pixi map renderer", mapFacts);
  check(mapFacts.corners === 18, "the shared race map renders all 18 Silverstone corners", mapFacts);
  check(mapFacts.pitLane === "RACE_SHARED", "the shared race pit entry, lane, boxes, and exit renderer is active", mapFacts);
  check(mapFacts.wetSurfaceCount === 0, "qualifying has no rain or wet-surface panel", mapFacts);
  check(await desktop.getByRole("heading", { name: "Leader Board" }).isVisible(), "the enlarged qualifying leaderboard is visible");
  check(await desktop.getByText("18:00", { exact: true }).first().isVisible(), "Q1 opens with the full 18-minute timer");
  check(await desktop.getByText("OUT LAP PREP", { exact: true }).isVisible() && await desktop.getByText("LAP ENERGY", { exact: true }).isVisible(), "qualifying controls use the race command-console surface");
  await fitMetrics(desktop, "1600x900 ready", true);
  await desktop.screenshot({ path: resolve("qa/qualifying-race-q1-ready-1600x900.png"), type: "png" });

  for (const speed of [1, 2, 4, 8, 16]) {
    const control = desktop.getByRole("button", { name: `Set simulation speed to ${speed} times` });
    await control.click();
    check(await control.getAttribute("aria-pressed") === "true", `${speed}x qualifying speed matches the race transport control`);
  }
  await desktop.getByRole("button", { name: "Set simulation speed to 1 times" }).click();
  await desktop.getByRole("button", { name: "Select MEDIUM" }).click();
  await desktop.getByRole("button", { name: "Set out lap preparation AGGRESSIVE" }).click();
  await desktop.getByRole("button", { name: "Set qualifying energy QUALI" }).click();
  await desktop.getByRole("button", { name: "START Q1", exact: true }).click();
  await desktop.getByRole("button", { name: "SEND OUT", exact: true }).click();
  await desktop.locator('.track-map[data-qualifying-phase="OUT_LAP"]').waitFor();
  await desktop.waitForTimeout(250);
  const pitStart = await desktop.locator('.track-map[data-qualifying-phase="OUT_LAP"]').evaluate((map) => ({ x: Number(map.dataset.selectedX), y: Number(map.dataset.selectedY), route: map.dataset.qualifyingRoute }));
  await desktop.waitForTimeout(1_200);
  const pitMove = await desktop.locator('.track-map[data-qualifying-phase="OUT_LAP"]').evaluate((map) => ({ x: Number(map.dataset.selectedX), y: Number(map.dataset.selectedY), route: map.dataset.qualifyingRoute }));
  check(pitStart.route === "PIT" && pitMove.route === "PIT" && Math.hypot(pitMove.x - pitStart.x, pitMove.y - pitStart.y) > 1, "the player car visibly leaves through the shared pit lane", { pitStart, pitMove });

  await desktop.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await desktop.locator('.track-map[data-qualifying-phase="PUSH_LAP"]').waitFor({ timeout: 12_000 });
  const pushMap = await desktop.locator('.track-map[data-qualifying-phase="PUSH_LAP"]').evaluate((map) => ({ route: map.dataset.qualifyingRoute, error: Number(map.dataset.centerlineErrorPx), visible: Number(map.dataset.visibleDriverCount) }));
  results.phases.push("OUT_LAP", "PUSH_LAP");
  check(pushMap.route === "TRACK" && pushMap.error <= 0.001 && pushMap.visible > 0, "push-lap markers stay exactly on the shared race centerline", pushMap);
  await desktop.screenshot({ path: resolve("qa/qualifying-race-q1-live-1600x900.png"), type: "png" });
  await desktop.locator('.track-map[data-qualifying-phase="IN_LAP"]').waitFor({ timeout: 12_000 });
  results.phases.push("IN_LAP");
  check(await desktop.locator("aside.timing-panel time").filter({ hasText: /\d:\d{2}\.\d{3}/ }).count() > 0, "best lap updates after the push lap");
  await fitMetrics(desktop, "1600x900 live", true);

  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await enterQ1(compact);
  await fitMetrics(compact, "1280x720 ready", true);
  check(await compact.locator('.track-map[data-map-mode="QUALIFYING"] canvas').isVisible(), "1280x720 keeps the full race map canvas visible");
  await compact.screenshot({ path: resolve("qa/qualifying-race-q1-ready-1280x720.png"), type: "png" });
} finally {
  await browser.close();
}

await writeFile(resolve("qa/qualifying-race-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
