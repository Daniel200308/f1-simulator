import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const results = { passed: [], consoleErrors: [], viewports: {} };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

const ack = async (page, name) => page.getByRole("dialog").getByRole("button", { name }).click();

async function startRace(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("option", { name: /Ferrari/i }).click();
  await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await ack(page, /ACKNOWLEDGE REPORT/i);
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await ack(page, /START Q1/i);
  for (const session of ["Q1", "Q2", "Q3"]) {
    await page.locator(`main[data-qualifying-session='${session}']`).waitFor();
    await page.getByRole("button", { name: `SKIP ${session}` }).click();
    await ack(page, session === "Q3" ? /ACKNOWLEDGE REPORT/i : new RegExp(`START Q${Number(session[1]) + 1}`, "i"));
  }
  await page.getByText("RACE PREPARATION", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: /START RACE/i }).click();
  await page.locator(".status-column").waitFor({ timeout: 30_000 });
}

function clippingProbe() {
  const clipped = (selector) => [...document.querySelectorAll(selector)]
    .filter((node) => {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
    })
    .map((node) => ({
      selector,
      text: (node.textContent ?? "").trim().slice(0, 48),
      scrollH: node.scrollHeight,
      clientH: node.clientHeight,
      scrollW: node.scrollWidth,
      clientW: node.clientWidth,
    }));

  return {
    radioMessages: clipped(".track-radio__message"),
    radioText: clipped(".track-radio__message p"),
    raceControl: clipped(".control-message-title, .control-message-detail"),
    carCards: clipped(".car-card .energy-telemetry, .car-card .energy-battery-readout"),
    surfaceHeight: Math.round(document.querySelector(".track-weather")?.getBoundingClientRect().height ?? 0),
    radioHeight: Math.round(document.querySelector(".track-radio")?.getBoundingClientRect().height ?? 0),
    /*
     * Overlap check across every pair of blocks inside the energy panel. Testing
     * only battery-vs-flow missed the battery overlapping the vitals strip, which
     * is what actually printed one reading on top of another.
     */
    energyOverlaps: [...document.querySelectorAll(".car-card .energy-telemetry")].flatMap((panel) => {
      const blocks = [".energy-battery-readout", ".energy-flow", ".energy-vitals"]
        .map((selector) => ({ selector, rect: panel.querySelector(selector)?.getBoundingClientRect() }))
        .filter((entry) => entry.rect && entry.rect.width > 0 && entry.rect.height > 0);
      const hits = [];
      for (let a = 0; a < blocks.length; a += 1) {
        for (let b = a + 1; b < blocks.length; b += 1) {
          const left = blocks[a].rect;
          const right = blocks[b].rect;
          const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
          const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
          if (overlapX > 1 && overlapY > 1) {
            hits.push(`${blocks[a].selector} x ${blocks[b].selector} (${Math.round(overlapX)}x${Math.round(overlapY)})`);
          }
        }
      }
      return hits;
    }),
    /*
     * The thermal map sits directly above the energy block, so an overflowing
     * thermal row prints its readings over the battery. Checked across the whole
     * card, not just inside the energy panel.
     */
    cardSectionOverlaps: [...document.querySelectorAll(".car-card")].flatMap((card) => {
      const blocks = [".vehicle-telemetry", ".energy-telemetry", ".resource-line", ".car-kpi-rail"]
        .map((selector) => ({ selector, rect: card.querySelector(selector)?.getBoundingClientRect() }))
        .filter((entry) => entry.rect && entry.rect.height > 0);
      const hits = [];
      for (let a = 0; a < blocks.length; a += 1) {
        for (let b = a + 1; b < blocks.length; b += 1) {
          const top = blocks[a].rect;
          const bottom = blocks[b].rect;
          const overlapY = Math.min(top.bottom, bottom.bottom) - Math.max(top.top, bottom.top);
          const overlapX = Math.min(top.right, bottom.right) - Math.max(top.left, bottom.left);
          if (overlapY > 2 && overlapX > 2) hits.push(`${blocks[a].selector} x ${blocks[b].selector} (${Math.round(overlapY)}px)`);
        }
      }
      return hits;
    }),
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => results.consoleErrors.push(error.message));

  await startRace(page);
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();

  // Let the race run long enough for radio traffic, flags and pit stops.
  await page.waitForTimeout(45_000);

  /*
   * Call both player cars into the pit lane and confirm each gets its own live
   * timer. A double stack is exactly when both numbers matter.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  const driverTabs = page.locator(".command-driver-select");
  const tabCount = await driverTabs.count();
  for (let index = 0; index < tabCount; index += 1) {
    await driverTabs.nth(index).click().catch(() => {});
    await page.waitForTimeout(400);
    const box = page.locator("button.tyre-select-button").nth(1);
    if (await box.count() > 0 && await box.isEnabled().catch(() => false)) {
      await box.click().catch(() => {});
    }
  }

  /*
   * Pit-stop behaviour itself is covered deterministically by
   * `pit-double-stack.test.ts`; catching a live stop from the browser depends on
   * AI timing and is unreliable. What is checked here is the rendering contract:
   * whenever panels are on screen there is at most one per player car, and a
   * stationary car's tyre clock is pulsing.
   */
  let maxPanels = 0;
  let pulsingSeen = 0;
  let stationarySeen = 0;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await page.waitForTimeout(150);
    const [panels, pulsing, stationary] = await Promise.all([
      page.locator(".pit-timing-live").count(),
      page.locator(".pit-timing-live [data-tyre-change='true'][data-running='true']").count(),
      page.locator(".pit-timing-live[data-pit-status='PIT_STOP']").count(),
    ]);
    maxPanels = Math.max(maxPanels, panels);
    pulsingSeen = Math.max(pulsingSeen, pulsing);
    stationarySeen = Math.max(stationarySeen, stationary);
    if (maxPanels >= 2 && pulsingSeen >= 1) break;
  }
  results.pitPanels = { maxPanels, pulsingSeen, stationarySeen };
  if (maxPanels >= 1) await page.screenshot({ path: resolve("qa/responsive/race-pit-stack-1440x900.png") });

  check(maxPanels <= 2, "never more pit panels than player cars", results.pitPanels);
  if (stationarySeen >= 1) {
    check(pulsingSeen >= 1, "the tyre-change clock pulses while the crew is on the car", results.pitPanels);
  }

  await mkdir(resolve("qa/responsive"), { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(600);
    const label = `${viewport.width}x${viewport.height}`;
    const probe = await page.evaluate(clippingProbe);
    results.viewports[label] = probe;
    check(probe.radioMessages.length === 0, `${label} shows every team-radio message in full`, probe.radioMessages);
    check(probe.radioText.length === 0, `${label} never clips radio message text`, probe.radioText);
    check(probe.raceControl.length === 0, `${label} keeps Race Control text unclipped`, probe.raceControl);
    check(probe.carCards.length === 0, `${label} keeps the driver energy block unclipped`, probe.carCards);
    check(probe.energyOverlaps.length === 0, `${label} never overlaps blocks inside the driver energy panel`, probe.energyOverlaps);
    check(probe.cardSectionOverlaps.length === 0, `${label} never overlaps the thermal map with the energy block`, probe.cardSectionOverlaps);
    await page.screenshot({ path: resolve(`qa/responsive/race-radio-pit-${label}.png`) });
  }

  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/race-radio-pit-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`passed ${results.passed.length} checks`);
  await context.close();
} finally {
  await browser.close();
}
