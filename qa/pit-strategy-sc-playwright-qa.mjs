import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.QA_URL ?? "http://127.0.0.1:3000";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function enterRace(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
  for (const session of ["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "ACKNOWLEDGE REPORT" }).click();
  }
  await page.getByRole("button", { name: "START RACE" }).click();
  await page.getByRole("button", { name: "Pause race" }).waitFor({ state: "visible", timeout: 12_000 });
  await page.waitForTimeout(900);
}

async function inspectLayout(page, name) {
  const result = await page.evaluate((viewportName) => {
    const root = document.documentElement;
    const map = document.querySelector(".track-map");
    const rail = document.querySelector(".track-intelligence-rail");
    const energyButtons = [...document.querySelectorAll('[aria-label^="Set energy "]')];
    const energyRects = energyButtons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute("aria-label"), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const mapRect = map?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    const radioText = document.querySelector(".track-radio__message p");
    const radioRect = radioText?.getBoundingClientRect();
    return {
      viewportName,
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: root.scrollWidth, height: root.scrollHeight },
      map: mapRect ? { left: mapRect.left, top: mapRect.top, right: mapRect.right, bottom: mapRect.bottom, width: mapRect.width, height: mapRect.height } : null,
      rail: railRect ? { left: railRect.left, top: railRect.top, right: railRect.right, bottom: railRect.bottom, width: railRect.width, height: railRect.height } : null,
      selectedMarker: {
        x: Number(map?.getAttribute("data-selected-x")),
        y: Number(map?.getAttribute("data-selected-y")),
        centerlineError: Number(map?.getAttribute("data-centerline-error-px")),
      },
      canvasLabel: map?.querySelector("canvas")?.getAttribute("aria-label") ?? "",
      legend: document.querySelector(".track-map__legend")?.textContent ?? "",
      energyRects,
      radio: radioText && radioRect ? {
        text: radioText.textContent,
        right: radioRect.right,
        bottom: radioRect.bottom,
        scrollWidth: radioText.scrollWidth,
        clientWidth: radioText.clientWidth,
        scrollHeight: radioText.scrollHeight,
        clientHeight: radioText.clientHeight,
      } : null,
      bottomDebugBar: Boolean(document.querySelector(".debug-bar")),
    };
  }, name);

  assert(result.document.width <= result.viewport.width + 1, `${name}: horizontal overflow`);
  assert(result.document.height <= result.viewport.height + 1, `${name}: vertical overflow`);
  assert(result.map && result.map.left >= -1 && result.map.right <= result.viewport.width + 1, `${name}: circuit panel clipped horizontally`);
  assert(result.map && result.map.top >= -1 && result.map.bottom <= result.viewport.height + 1, `${name}: circuit panel clipped vertically`);
  assert(result.rail && result.rail.left >= result.map.left && result.rail.right <= result.map.right + 1, `${name}: radio rail outside circuit panel`);
  assert(Number.isFinite(result.selectedMarker.x) && result.selectedMarker.x >= 0 && result.selectedMarker.x <= result.map.width - result.rail.width + 2, `${name}: selected car projected beneath the radio rail`);
  assert(result.selectedMarker.centerlineError <= 0.001, `${name}: selected car is off the circuit centerline`);
  assert(/Four wing-open Straight Mode sections/i.test(result.canvasLabel), `${name}: missing Silverstone Straight Mode description`);
  assert(result.legend.includes("STRAIGHT MODE · WING OPEN"), `${name}: missing wing-open legend`);
  assert(result.energyRects.length === 6, `${name}: expected six energy tendencies`);
  assert(Math.max(...result.energyRects.map((rect) => rect.y)) - Math.min(...result.energyRects.map((rect) => rect.y)) <= 2, `${name}: energy controls are not linear`);
  assert(result.energyRects.every((rect, index, list) => index === 0 || rect.x > list[index - 1].x), `${name}: energy controls are not ordered left-to-right`);
  assert(!result.bottomDebugBar, `${name}: removed bottom debug bar is still rendered`);
  if (result.radio && result.rail) {
    assert(result.radio.right <= result.rail.right + 1 && result.radio.bottom <= result.rail.bottom + 1, `${name}: radio copy clips outside its rail`);
  }
  return result;
}

async function inspectPitStop(page) {
  await page.getByRole("button", { name: /Box for SOFT/ }).click();
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  const overlay = page.locator(".pit-timing-live");
  await overlay.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Set simulation speed to 4 times" }).click();
  await page.locator('.pit-timing-live[data-pit-status="PIT_STOP"]').waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Set simulation speed to 1 times" }).click();
  await page.locator('.pit-timing-live[data-pit-status="TYRE_COMPLETE"]').waitFor({ state: "visible", timeout: 8_000 });
  const evidence = await page.evaluate(() => {
    const overlay = document.querySelector(".pit-timing-live");
    const rail = document.querySelector(".track-intelligence-rail");
    const overlayRect = overlay?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    const text = overlay?.textContent ?? "";
    return {
      status: overlay?.getAttribute("data-pit-status"),
      text,
      animationName: overlay ? getComputedStyle(overlay).animationName : "",
      overlay: overlayRect ? { left: overlayRect.left, right: overlayRect.right, top: overlayRect.top, bottom: overlayRect.bottom } : null,
      rail: railRect ? { left: railRect.left, right: railRect.right, top: railRect.top, bottom: railRect.bottom } : null,
      tyreTime: Number(text.match(/TYRE CHANGE([0-9]+\.[0-9]{2})s/)?.[1]),
    };
  });
  assert(evidence.status === "TYRE_COMPLETE", "pit: completion state was not exposed");
  assert(evidence.text.includes("TYRE CHANGE COMPLETE") && evidence.text.includes("WHEELS ON"), "pit: completion callout missing");
  assert(evidence.text.includes("2025 BENCH 2.08s"), "pit: 2025 benchmark missing");
  assert(evidence.animationName.includes("pit-stop-complete"), "pit: completion pulse missing");
  assert(Number.isFinite(evidence.tyreTime) && evidence.tyreTime >= 2.1 && evidence.tyreTime < 6, `pit: invalid tyre time ${evidence.tyreTime}`);
  assert(evidence.overlay && evidence.rail && evidence.overlay.right <= evidence.rail.left + 1, "pit: timer overlaps the radio/surface rail");
  return evidence;
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, viewport, pitStop] of [["1600x900", { width: 1600, height: 900 }, true], ["1280x720", { width: 1280, height: 720 }, false]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("React DevTools")) errors.push(`console: ${message.text()}`); });
    page.on("response", (response) => { if (response.status() >= 400) errors.push(`http: ${response.status()} ${response.url()}`); });
    await enterRace(page);
    const layout = await inspectLayout(page, name);
    const pit = pitStop ? await inspectPitStop(page) : null;
    await page.screenshot({ path: resolve(`qa/pit-strategy-sc-${name}.jpg`), type: "jpeg", quality: 90, fullPage: true });
    assert(errors.length === 0, `${name}: ${errors.join(" | ")}`);
    results.push({ name, layout, pit, errors });
    await context.close();
  }
  await writeFile(resolve("qa/pit-strategy-sc-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, results: results.map(({ name, pit }) => ({ name, pit })) }, null, 2));
} finally {
  await browser.close();
}
