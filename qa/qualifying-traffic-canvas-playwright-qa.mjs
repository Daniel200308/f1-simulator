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

async function assertViewportFit(page, label) {
  const metrics = await page.evaluate(() => {
    const box = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const root = document.querySelector("main[data-qualifying-session='Q1']");
    const tower = root?.querySelector("[aria-label='Qualifying leaderboard']");
    const map = root?.querySelector("[data-traffic-overview='true']");
    const controls = root?.querySelector("[aria-label='Qualifying driver control']");
    const controlSections = Array.from(controls?.querySelectorAll("section[class*='controlSection']") ?? [], box);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      root: box(root),
      tower: box(tower),
      map: box(map),
      controls: box(controls),
      controlSections,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check(metrics.root && metrics.root.left >= 0 && metrics.root.top >= 0 && metrics.root.right <= metrics.innerWidth && metrics.root.bottom <= metrics.innerHeight, `${label} qualifying shell fits the viewport`, metrics);
  check(metrics.tower && metrics.map && metrics.controls && metrics.tower.right < metrics.map.left && metrics.map.right < metrics.controls.left, `${label} preserves leaderboard, centre circuit and right controls`, metrics);
  check(metrics.map && metrics.map.width > metrics.tower.width && metrics.map.width > metrics.controls.width && metrics.map.height > 500, `${label} keeps the circuit as the dominant visual focus`, metrics);
  check(metrics.controls && metrics.controls.top >= 0 && metrics.controls.bottom <= metrics.innerHeight, `${label} keeps the entire control rail above the fold`, metrics);
  check(metrics.controlSections.length === 6 && metrics.controlSections.every((section) => section.top >= metrics.controls.top && section.bottom <= metrics.controls.bottom), `${label} keeps all six control groups inside the rail`, metrics);
  results.viewports[label] = metrics;
}

async function assertControlLabelsFit(controls, label) {
  const clipped = await controls.locator("button span").evaluateAll((nodes) => nodes
    .filter((node) => node.offsetParent !== null)
    .filter((node) => node.scrollWidth > node.clientWidth + 1)
    .map((node) => ({ text: node.textContent?.trim(), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })));
  check(clipped.length === 0, `${label} keeps visible control labels unclipped`, clipped);
}

async function checkQualifyingWorkspace(page, label, screenshotPrefix) {
  const panel = page.locator("[data-traffic-overview='true']");
  const canvas = panel.locator("canvas[data-renderer='SINGLE_CANVAS']");
  const tower = page.getByRole("complementary", { name: "Qualifying leaderboard" });
  const controls = page.getByLabel("Qualifying driver control");
  const tabs = page.getByRole("navigation", { name: "Player driver selection" });

  check(await panel.isVisible(), `${label} centre Circuit Detail is visible`);
  check(await canvas.count() === 1 && await panel.locator("svg[class*='circuitBackdrop']").count() === 1, `${label} separates one animated canvas from the static circuit`);
  check(await canvas.getAttribute("data-label-anchoring") === "PERSISTENT_OFFSETS", `${label} uses persistent driver-label anchors`);
  check(await canvas.getAttribute("data-marker-language") === "PHASE_CODED", `${label} uses phase-coded map markers`);
  check(await panel.getByLabel("Live circuit marker legend").getByText(/Flying Lap/i).count() === 1, `${label} shows the compact map legend`);
  check(await panel.getByLabel("Live circuit marker legend").locator("span").count() === 7, `${label} legend covers flying, out, in, pit-entry, cool-down, yielding and player states`);
  check(await tower.locator("[data-sector-cell='true']").count() === 66, `${label} keeps S1 S2 S3 for all 22 drivers in the leaderboard`);

  check(await tabs.getByRole("button").count() === 2, `${label} exposes two compact player-driver tabs`);
  check(await controls.locator("[data-car-id]").count() === 0, `${label} does not duplicate large driver control rows`);
  for (const group of ["RELEASE", "OUT LAP PACE", "FLYING LAP ATTACK", "FUEL PLAN", "LAP ACTION", "ENERGY MODE"]) {
    check(await controls.getByText(group, { exact: true }).count() === 1, `${label} shows one compact ${group} control group`);
  }
  await assertControlLabelsFit(controls, label);

  const initialCarId = await controls.getAttribute("data-car-id");
  const charge = controls.getByRole("button", { name: /set energy mode CHARGE/i });
  await charge.click();
  check(await charge.getAttribute("aria-pressed") === "true", `${label} energy selector gives strong selected-state feedback`);
  const attack = controls.getByRole("button", { name: /set flying lap attack Attack/i });
  await attack.click();
  check(await attack.getAttribute("aria-pressed") === "true", `${label} flying attack selector updates the active driver`);
  const fuel = controls.getByRole("button", { name: /set fuel plan 2 Flying Laps/i });
  await fuel.click();
  check(await fuel.getAttribute("aria-pressed") === "true", `${label} fuel selector updates before release`);
  await controls.getByRole("button", { name: /Release Now/i }).click();

  const otherTab = tabs.getByRole("button", { pressed: false });
  await otherTab.click();
  const switchedCarId = await controls.getAttribute("data-car-id");
  check(Boolean(initialCarId && switchedCarId && initialCarId !== switchedCarId), `${label} switches LEC and HAM through compact tabs`, { initialCarId, switchedCarId });
  await controls.getByRole("button", { name: /Release Now/i }).click();

  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.waitForTimeout(8_200);
  const active = Number(await canvas.getAttribute("data-active-cars") ?? 0);
  const labelled = Number(await canvas.getAttribute("data-labelled-cars") ?? 0);
  const flying = Number(await canvas.getAttribute("data-flying-cars") ?? 0);
  check(active >= 2 && active <= 14, `${label} spreads the early qualifying field instead of releasing one continuous train`, { active });
  check(labelled === active, `${label} labels every active car with stable canvas labels`, { active, labelled });
  check(flying >= 1, `${label} reaches a visible pulsing flying-lap state`, { flying });

  await page.getByRole("button", { name: "Pause qualifying" }).click();
  await page.waitForTimeout(220);
  const firstFrame = await canvas.evaluate((element) => element.toDataURL());
  await page.waitForTimeout(220);
  const secondFrame = await canvas.evaluate((element) => element.toDataURL());
  check(firstFrame === secondFrame, `${label} stops marker and label animation while paused`);
  await assertViewportFit(page, label);
  await page.screenshot({ path: resolve(`${screenshotPrefix}.png`), type: "png" });
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
    await checkQualifyingWorkspace(page, label, `qa/qualifying-right-rail-${label}`);
    await context.close();
  }
  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-traffic-canvas-playwright-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
