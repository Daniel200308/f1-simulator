import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.QA_URL ?? "http://127.0.0.1:3000";
const outputDirectory = resolve("qa");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function enterRace(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const enterWeekend = page.getByRole("button", { name: "ENTER WEEKEND" });
  await enterWeekend.click();
  const firstSession = page.getByRole("button", { name: "RUN FP1" });
  try {
    await firstSession.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    // A development HMR rebuild can replace the server-rendered button before
    // hydration. Replaying the same explicit user action is safe and deterministic.
    await enterWeekend.click();
    await firstSession.waitFor({ state: "visible", timeout: 10_000 });
  }
  for (const session of ["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "ACKNOWLEDGE REPORT" }).click();
  }
  await page.getByRole("button", { name: "START RACE" }).click();
  await page.getByRole("button", { name: "Pause race" }).waitFor({ state: "visible", timeout: 12_000 });
  await page.waitForTimeout(900);
}

async function inspectLayout(page, label) {
  const result = await page.evaluate(() => {
    const selectors = [".race-grid", ".timing-panel", ".map-column", ".track-map", ".status-column", ".command-console"];
    const rects = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }];
    }));
    const telemetry = [...document.querySelectorAll(".energy-telemetry")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, flow: element.getAttribute("data-flow"), label: element.getAttribute("aria-label") };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      rects,
      telemetry,
      carHealthGridCount: document.querySelectorAll(".car-card__health-grid").length,
      legacyLapPercentText: [...document.querySelectorAll(".car-card")].some((element) => /CAR\s+NOMINAL|LAP\s+PROGRESS/i.test(element.textContent ?? "")),
      energyButtonCount: document.querySelectorAll(".visual-control--energy button").length,
      trackPlanSegmentCount: document.querySelectorAll(".energy-track-plan i").length,
    };
  });

  invariant(result.document.width <= result.viewport.width + 1, `${label}: horizontal document overflow`);
  invariant(result.document.height <= result.viewport.height + 1, `${label}: vertical document overflow`);
  invariant(result.telemetry.length === 2, `${label}: expected two player energy telemetry surfaces`);
  invariant(result.energyButtonCount === 6, `${label}: expected six energy controls`);
  invariant(result.trackPlanSegmentCount === 24, `${label}: expected twelve plan segments per car`);
  invariant(result.carHealthGridCount === 0 && !result.legacyLapPercentText, `${label}: legacy Car Nominal/Lap progress UI remains`);

  for (const [selector, rect] of Object.entries(result.rects)) {
    invariant(rect, `${label}: missing ${selector}`);
    invariant(rect.width > 0 && rect.height > 0, `${label}: ${selector} has no visible size`);
    invariant(rect.x >= -1 && rect.right <= result.viewport.width + 1, `${label}: ${selector} is horizontally clipped`);
    invariant(rect.y >= -1 && rect.bottom <= result.viewport.height + 1, `${label}: ${selector} is vertically clipped`);
  }
  for (const [index, rect] of result.telemetry.entries()) {
    invariant(rect.width > 210 && rect.height >= 55, `${label}: telemetry ${index + 1} is too small`);
    invariant(rect.right <= result.viewport.width + 1 && rect.bottom <= result.viewport.height + 1, `${label}: telemetry ${index + 1} is clipped`);
    invariant(/state of charge.+megajoules.+kilowatts deployed.+kilowatts recovered.+degrees/i.test(rect.label ?? ""), `${label}: telemetry ${index + 1} is missing accessible units`);
  }
  return result;
}

async function cycleControls(page) {
  await page.getByRole("button", { name: "Pause race" }).click();
  await page.getByRole("button", { name: "Resume race" }).click();
  await page.getByRole("button", { name: "Set simulation speed to 4 times" }).click();
  await page.getByRole("button", { name: "Set simulation speed to 1 times" }).click();

  const drivers = page.getByRole("group", { name: "Select driver to control" }).getByRole("button");
  invariant(await drivers.count() === 2, "Expected two player driver controls");
  await drivers.nth(1).click();
  invariant(await drivers.nth(1).getAttribute("aria-pressed") === "true", "Second driver was not selected");
  await drivers.nth(0).click();

  for (const mode of ["HARVEST", "CONSERVE", "BALANCED", "ATTACK", "BOOST", "BALANCED"]) {
    const button = page.getByRole("button", { name: `Set energy ${mode}`, exact: true });
    await button.click();
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true", `Set energy ${mode}`);
    await page.waitForTimeout(160);
  }
  const overtake = page.getByRole("button", { name: /Set energy OVERTAKE/ });
  if (await overtake.isEnabled()) {
    await overtake.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Set energy OVERTAKE"]')?.getAttribute("aria-pressed") === "true");
    await page.getByRole("button", { name: "Set energy BALANCED" }).click();
  } else {
    invariant((await overtake.getAttribute("aria-label"))?.includes("unavailable"), "Disabled OVERTAKE control must explain its unavailable state");
  }
}

async function runViewport(browser, viewport, name, exerciseControls = false) {
  const context = await browser.newContext(viewport
    ? { viewport, deviceScaleFactor: 1, reducedMotion: "reduce" }
    : { viewport: null, reducedMotion: "reduce" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
  try {
    await enterRace(page);
    if (exerciseControls) await cycleControls(page);
    await page.waitForTimeout(1_200);
    const layout = await inspectLayout(page, name);
    await page.screenshot({ path: resolve(outputDirectory, `energy-2026-final-${name}.jpg`), type: "jpeg", quality: 88 });
    invariant(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(" | ")}`);
    invariant(httpErrors.length === 0, `${name}: HTTP errors: ${httpErrors.join(" | ")}`);
    invariant(consoleErrors.filter((message) => !message.text.includes("Download the React DevTools") && !message.text.includes("Failed to load resource")).length === 0, `${name}: console errors: ${consoleErrors.map((message) => `${message.text} @ ${message.location.url}`).join(" | ")}`);
    return { name, layout, consoleErrors, pageErrors, httpErrors };
  } finally {
    await context.close();
  }
}

async function runDebugScenario(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await enterRace(page);
    await page.evaluate(() => history.replaceState(null, "", "/?energyDebug=1"));
    const panel = page.getByRole("complementary", { name: "Energy development debug panel" });
    await panel.waitFor({ state: "visible" });
    const playerRow = page.locator(".energy-debug-table > div").filter({ hasText: "LEC" });
    await playerRow.getByRole("button", { name: "CLIPPING" }).click();
    await page.waitForTimeout(500);
    invariant((await playerRow.textContent())?.includes("CLIP"), "Debug clipping state was not applied");
    await page.screenshot({ path: resolve(outputDirectory, "energy-2026-debug-clipping.jpg"), type: "jpeg", quality: 88 });
    return { debugClipping: true };
  } finally {
    await context.close();
  }
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ["--window-size=1680,960"] });
try {
  const results = [];
  results.push(await runViewport(browser, { width: 1600, height: 900 }, "1600x900", true));
  results.push(await runViewport(browser, { width: 1280, height: 720 }, "1280x720"));
  results.push(await runViewport(browser, null, "native"));
  results.push(await runDebugScenario(browser));
  await writeFile(resolve(outputDirectory, "energy-2026-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, passes: results.map((result) => result.name ?? "debug-clipping") }, null, 2));
} finally {
  await browser.close();
}
