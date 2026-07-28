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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
  }
  throw new Error(message);
}

async function inspectLayout(page, label) {
  const metrics = await page.evaluate(() => {
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const root = document.querySelector("main[data-qualifying-session='Q1']");
    const controls = root?.querySelector("[aria-label='Qualifying driver control']");
    const map = root?.querySelector("[data-traffic-overview='true']");
    const tyres = Array.from(root?.querySelectorAll("[data-tyre-position]") ?? [], (element) => ({
      text: element.textContent?.replace(/\s+/g, " ").trim(),
      rect: rect(element),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    const trackLine = root?.querySelector("path[class*='trackLine']");
    const trackHalo = root?.querySelector("path[class*='trackHalo']");
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      root: rect(root),
      controls: rect(controls),
      map: rect(map),
      tyres,
      trackStroke: trackLine ? getComputedStyle(trackLine).strokeWidth : null,
      haloStroke: trackHalo ? getComputedStyle(trackHalo).strokeWidth : null,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check(metrics.root?.bottom <= metrics.innerHeight && metrics.controls?.bottom <= metrics.innerHeight, `${label} keeps the qualifying shell and controls above the fold`, metrics);
  check(metrics.tyres.length === 4 && metrics.tyres.every((tyre) => tyre.scrollWidth <= tyre.clientWidth + 1 && tyre.scrollHeight <= tyre.clientHeight + 1), `${label} keeps all four tyre labels and values unclipped`, metrics.tyres);
  check(metrics.tyres.map((tyre) => tyre.text).join("|").includes("FLFront Left") && metrics.tyres.map((tyre) => tyre.text).join("|").includes("RRRear Right"), `${label} exposes persistent FL/FR/RL/RR wheel names`, metrics.tyres);
  check(parseFloat(metrics.trackStroke ?? "99") <= 5 && parseFloat(metrics.haloStroke ?? "99") <= 12, `${label} uses a proportionate thin circuit line and halo`, metrics);
  results.viewports[label] = metrics;
}

async function exercisePhysicalReturns(page, label, screenshotPrefix) {
  const controls = page.getByLabel("Qualifying driver control");
  const tabs = page.getByRole("navigation", { name: "Player driver selection" }).getByRole("button");
  const canvas = page.locator("canvas[data-renderer='SINGLE_CANVAS']");

  check(await controls.getByText("ERS", { exact: true }).count() === 0, `${label} removes the ERS readout from driver telemetry`);
  check(await page.locator("svg[class*='circuitBackdrop'] path[class*='pitLine']").count() === 1, `${label} renders one dedicated straight pit path`);
  check(await page.locator("svg[class*='circuitBackdrop'] circle[class*='pitBox']").count() === 1, `${label} marks the garage pit-box endpoint`);
  check(await page.getByLabel("Live circuit marker legend").getByText("Pit Entry", { exact: true }).count() === 1, `${label} explains the pit-entry marker state`);

  await tabs.nth(0).click();
  await controls.getByRole("button", { name: /Release Now/i }).click();
  await controls.getByRole("button", { name: /Return to Pits/i }).click();
  check(await controls.getAttribute("data-lap-status") === "INLAP", `${label} Return changes to INLAP instead of teleporting`);
  check(Number(await canvas.getAttribute("data-active-cars")) >= 1, `${label} keeps a returning car visible on the live circuit`);
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await waitUntil(async () => Number(await canvas.getAttribute("data-pit-entry-cars")) > 0, 8_000, `${label} did not reach visible pit entry`);
  check(await controls.getAttribute("data-lap-status") === "PIT ENTRY", `${label} exposes the PIT ENTRY phase before garage`);
  await page.screenshot({ path: resolve(`${screenshotPrefix}-pit-entry.png`), type: "png" });
  await waitUntil(async () => await controls.getAttribute("data-lap-status") === "GARAGE", 3_000, `${label} did not reach garage after pit entry`);

  await tabs.nth(1).click();
  await controls.getByRole("button", { name: /Release Now/i }).click();
  const abort = controls.getByRole("button", { name: /Abort Lap/i });
  await waitUntil(async () => await abort.isEnabled(), 10_000, `${label} did not begin a flying lap`);
  await abort.click();
  check(await controls.getAttribute("data-lap-status") === "INLAP", `${label} Abort cancels the attempt into a physical INLAP`);
  check(Number(await canvas.getAttribute("data-active-cars")) >= 1, `${label} keeps an aborted car visible while returning`);
  await page.screenshot({ path: resolve(`${screenshotPrefix}-abort-return.png`), type: "png" });
  await waitUntil(async () => Number(await canvas.getAttribute("data-pit-entry-cars")) > 0, 8_000, `${label} aborted car did not reach visible pit entry`);
  await waitUntil(async () => await controls.getAttribute("data-lap-status") === "GARAGE", 3_000, `${label} aborted car did not reach garage`);
  check(true, `${label} completes Abort through IN LAP and PIT ENTRY before GARAGE`);
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
    await inspectLayout(page, label);
    await exercisePhysicalReturns(page, label, `qa/qualifying-return-${label}`);
    await context.close();
  }
  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-return-pit-playwright-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
