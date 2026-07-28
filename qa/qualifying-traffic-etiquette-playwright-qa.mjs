import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const results = { passed: [], viewports: {}, consoleErrors: [] };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function clickReportAction(page, name) {
  const button = page.getByRole("dialog").getByRole("button", { name });
  await button.waitFor({ timeout: 15_000 });
  await button.click();
}

async function enterQ1(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await clickReportAction(page, /ACKNOWLEDGE REPORT/i);
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await clickReportAction(page, /START Q1/i);
  await page.locator("main[data-qualifying-session='Q1']").waitFor();
}

async function waitUntil(predicate, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
  }
  throw new Error(message);
}

async function inspectStaticMap(page, label) {
  const map = page.locator("[data-traffic-overview='true']");
  const canvas = map.locator("canvas[data-renderer='SINGLE_CANVAS']");
  const sectors = map.locator("path[class*='sectorPath']");
  const sectorLabels = map.locator("[data-sector-label]");
  const mapLabels = map.locator("[data-map-label]");
  check(await sectors.count() === 3, `${label} divides the centreline into exactly three sector paths`);
  check(await sectorLabels.count() === 3, `${label} keeps S1, S2 and S3 labels visible on the circuit`);
  check(await map.locator("line[class*='sectorBoundary']").count() === 2, `${label} renders two sector timing boundaries`);
  check(await map.locator("[data-start-finish='true']").count() === 1, `${label} renders a distinct start-finish line`);
  check(await mapLabels.count() === 3, `${label} labels start-finish, pit entry and pit exit`);
  const sectorStyles = await sectors.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).stroke));
  check(new Set(sectorStyles).size === 3, `${label} uses three restrained but distinct sector tones`, sectorStyles);
  const visibleLabels = await sectorLabels.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { text: node.textContent, width: rect.width, height: rect.height };
  }));
  check(visibleLabels.every((item) => item.width >= 12 && item.height >= 12), `${label} sector labels are large enough to scan`, visibleLabels);
  check(await canvas.getAttribute("data-ai-label-size") === "10" && await canvas.getAttribute("data-player-label-size") === "12.5", `${label} uses larger driver abbreviations with player emphasis`);
  check(await canvas.getAttribute("data-label-treatment") === "WHITE_DARK_PLATE", `${label} uses high-contrast white labels with dark plates`);
  check(await canvas.getAttribute("data-label-anchoring") === "PERSISTENT_OFFSETS", `${label} preserves stable driver label directions`);
  const legend = map.getByLabel("Live circuit marker legend");
  check(await legend.locator("span").count() === 8 && await legend.getByText("Yielding", { exact: true }).count() === 1 && await legend.getByText("Aborted", { exact: true }).count() === 1, `${label} legend matches all eight live marker states`);
  check(await map.locator("svg[class*='circuitBackdrop']").count() === 1 && await canvas.count() === 1, `${label} keeps one memoised SVG and one animated Canvas`);
}

async function createYieldingTraffic(page, label) {
  const controls = page.getByLabel("Qualifying driver control");
  const tabs = page.getByRole("navigation", { name: "Player driver selection" }).getByRole("button");
  const canvas = page.locator("canvas[data-renderer='SINGLE_CANVAS']");

  await tabs.nth(0).click();
  await controls.getByRole("button", { name: /set out lap pace Gentle/i }).click();
  await controls.getByRole("button", { name: /Release Now/i }).click();
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.waitForTimeout(3_800);

  await tabs.nth(1).click();
  await controls.getByRole("button", { name: /set out lap pace Aggressive Warm-up/i }).click();
  const release = controls.getByRole("button", { name: /Release Now/i });
  await waitUntil(async () => await release.isEnabled(), 4_000, `${label} second player car never received a safe pit-release window`);
  await release.click();

  await waitUntil(async () => Number(await canvas.getAttribute("data-yielding-cars") ?? 0) > 0, 15_000, `${label} did not expose a visible qualifying yield sequence`);
  await page.getByRole("button", { name: "Pause qualifying" }).click();
  await page.waitForTimeout(180);
  const yieldingCars = Number(await canvas.getAttribute("data-yielding-cars") ?? 0);
  const overlaps = Number(await canvas.getAttribute("data-marker-overlap-pairs") ?? 0);
  const activeCars = Number(await canvas.getAttribute("data-active-cars") ?? 0);
  check(yieldingCars >= 1, `${label} renders an amber YIELD state for at least one slower car`, { yieldingCars });
  check(activeCars >= 3, `${label} exercises the map with a realistic multi-car traffic field`, { activeCars });
  check(overlaps === 0, `${label} avoids almost-identical live marker positions during the pass`, { overlaps });

  const firstFrame = await canvas.evaluate((element) => element.toDataURL());
  await page.waitForTimeout(180);
  const secondFrame = await canvas.evaluate((element) => element.toDataURL());
  check(firstFrame === secondFrame, `${label} fully freezes Canvas motion and YIELD pulses when paused`);
  return { yieldingCars, overlaps, activeCars, minimumProgressGap: await canvas.getAttribute("data-minimum-progress-gap") };
}

async function inspectViewport(page, label) {
  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      map: rect("[data-traffic-overview='true']"),
      controls: rect("[aria-label='Qualifying driver control']"),
      tower: rect("[aria-label='Qualifying leaderboard']"),
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check(metrics.map?.bottom <= metrics.innerHeight && metrics.controls?.bottom <= metrics.innerHeight && metrics.tower?.bottom <= metrics.innerHeight, `${label} keeps all three primary work areas inside the viewport`, metrics);
  results.viewports[label] = { ...(results.viewports[label] ?? {}), ...metrics };
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => results.consoleErrors.push(error.message));
    await enterQ1(page);
    const label = `${viewport.width}x${viewport.height}`;
    await inspectStaticMap(page, label);
    results.viewports[label] = { ...(results.viewports[label] ?? {}), traffic: await createYieldingTraffic(page, label) };
    await inspectViewport(page, label);
    await page.screenshot({ path: resolve(`qa/qualifying-traffic-etiquette-${label}.png`), type: "png" });
    await context.close();
  }
  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-traffic-etiquette-playwright-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
