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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
  }
  throw new Error(message);
}

async function viewportMetrics(page, label) {
  const metrics = await page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
    };
    const clipped = [...document.querySelectorAll("[aria-label='Qualifying driver control'] button span, [aria-label='Qualifying driver control'] button b, [aria-label='Qualifying driver control'] button small")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.textContent?.trim());
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      tower: bounds("[aria-label='Qualifying leaderboard']"),
      map: bounds("[data-traffic-overview='true']"),
      controls: bounds("[aria-label='Qualifying driver control']"),
      tyreConsole: bounds("[class*='tyreConsole']"),
      clipped,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check([metrics.tower, metrics.map, metrics.controls].every((item) => item && item.left >= 0 && item.top >= 0 && item.right <= metrics.innerWidth && item.bottom <= metrics.innerHeight), `${label} keeps leaderboard, circuit and control rail in the viewport`, metrics);
  check(metrics.tyreConsole && metrics.tyreConsole.bottom <= metrics.controls.bottom && metrics.tyreConsole.height >= 72, `${label} keeps the tyre-set console visible`, metrics.tyreConsole);
  check(metrics.clipped.length === 0, `${label} control labels are not clipped`, metrics.clipped);
  results.viewports[label] = metrics;
}

async function exerciseControls(page, label, completeRun) {
  const rail = page.getByLabel("Qualifying driver control");
  const canvas = page.locator("canvas[data-renderer='SINGLE_CANVAS']");

  const release = rail.getByRole("button", { name: /LEC Release Now/i });
  const waitGap = rail.getByRole("button", { name: /LEC Wait for Gap/i });
  check(await release.isDisabled() && await waitGap.isDisabled(), `${label} blocks release until a physical tyre set is selected`);
  check(await rail.getByText("Select a tyre set before release", { exact: true }).isVisible(), `${label} explains the missing tyre selection`);

  for (const compound of ["MEDIUM", "HARD", "INTERMEDIATE", "WET", "SOFT"]) {
    const choice = rail.getByRole("button", { name: new RegExp(`LEC ${compound},`) });
    await choice.click();
    check(await choice.getAttribute("aria-pressed") === "true", `${label} selects ${compound} from the compound sidewalls`);
  }
  const setButtons = rail.getByRole("button", { name: /Select SOFT set/i });
  check(await setButtons.count() === 6, `${label} exposes all six allocated Soft physical sets`);
  check(await setButtons.first().getAttribute("aria-pressed") === "true", `${label} highlights the exact selected set`);
  check(await release.isEnabled() && await waitGap.isEnabled(), `${label} enables release and gap queue after selecting a set`);

  await page.getByRole("button", { name: "Pause qualifying" }).click();
  await waitGap.click();
  check(await waitGap.getAttribute("aria-pressed") === "true", `${label} arms Wait for Gap while the session is paused`);
  const hold = rail.getByRole("button", { name: /LEC Hold in Garage/i });
  await hold.click();
  check(await hold.getAttribute("aria-pressed") === "true", `${label} restores Hold in Garage`);
  await page.getByRole("button", { name: "Resume qualifying" }).click();
  await waitUntil(async () => await release.isEnabled(), 5_000, `${label} did not reopen a safe release window`);
  await release.click();
  await waitUntil(async () => await rail.getAttribute("data-lap-status") === "OUTLAP", 2_000, `${label} release did not enter OUT LAP`);
  check(await rail.getAttribute("data-lap-status") === "OUTLAP", `${label} releases the selected set onto an out lap`);

  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.waitForTimeout(7_000);
  check(Number(await canvas.getAttribute("data-active-cars") ?? 0) >= 2, `${label} exercises a multi-car live circuit`);
  check(await page.getByLabel("Live circuit marker legend").getByText("Aborted", { exact: true }).isVisible(), `${label} exposes the Aborted marker language`);
  check(await canvas.getAttribute("data-renderer") === "SINGLE_CANVAS", `${label} retains the lightweight single-Canvas renderer`);

  if (completeRun) {
    await waitUntil(async () => await rail.getAttribute("data-lap-status") === "GARAGE", 22_000, `${label} player car did not return to the garage`);
    const usedSet = rail.getByRole("button", { name: /Select SOFT set .* USED/i }).first();
    await usedSet.waitFor({ timeout: 3_000 });
    check(await usedSet.isVisible(), `${label} keeps the completed qualifying set available as USED`);
    check((await usedSet.getAttribute("aria-label"))?.includes("life"), `${label} reports the used set's remaining life`);
  }
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
    await exerciseControls(page, label, viewport.width === 1440);
    await page.screenshot({ path: resolve(`qa/qualifying-ai-tyres-${label}.png`), type: "png" });
    await viewportMetrics(page, label);
    await context.close();
  }
  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-ai-tyres-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
