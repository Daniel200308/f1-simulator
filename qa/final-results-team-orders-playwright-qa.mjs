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
  await page.getByRole("button", { name: "Pause race" }).click();
}

async function inspect(page, name) {
  await page.getByRole("button", { name: "HOLD", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".team-order-rail button:nth-child(2)")?.getAttribute("aria-pressed") === "true");
  await page.getByRole("button", { name: "SWAP", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".team-order-rail button:nth-child(3)")?.getAttribute("aria-pressed") === "true");

  const workspace = await page.evaluate(() => {
    const root = document.documentElement;
    const consoleElement = document.querySelector(".command-console");
    const rect = consoleElement?.getBoundingClientRect();
    const teamButtons = [...document.querySelectorAll(".team-order-rail button")].map((button) => {
      const buttonRect = button.getBoundingClientRect();
      return { text: button.textContent, width: buttonRect.width, height: buttonRect.height, right: buttonRect.right };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: root.scrollWidth, height: root.scrollHeight },
      console: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      teamButtons,
    };
  });
  assert(workspace.document.width <= workspace.viewport.width + 1, `${name}: workspace horizontal overflow`);
  assert(workspace.document.height <= workspace.viewport.height + 1, `${name}: workspace vertical overflow`);
  assert(workspace.console && workspace.console.right <= workspace.viewport.width + 1 && workspace.console.bottom <= workspace.viewport.height + 1, `${name}: command console clipped`);
  assert(workspace.teamButtons.length === 3 && workspace.teamButtons.every((button) => button.width >= 24 && button.height >= 20), `${name}: team order controls are not legible`);

  await page.getByRole("button", { name: "Open race report" }).click();
  await page.getByRole("dialog", { name: /Race review|Official classification/ }).waitFor({ state: "visible" });
  const report = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    const panelRect = panel?.getBoundingClientRect();
    const rows = [...document.querySelectorAll('[class*="classificationRow"]')];
    const firstRow = rows[0]?.getBoundingClientRect();
    return {
      title: document.querySelector('[role="dialog"] h2')?.textContent,
      panel: panelRect ? { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom, width: panelRect.width, height: panelRect.height } : null,
      rows: rows.length,
      firstRow: firstRow ? { width: firstRow.width, height: firstRow.height } : null,
      columns: document.querySelector('[class*="tableHead"]')?.textContent,
      stewards: document.querySelector('[class*="stewards"]')?.textContent,
    };
  });
  assert(report.panel && report.panel.left >= 0 && report.panel.right <= workspace.viewport.width && report.panel.top >= 0 && report.panel.bottom <= workspace.viewport.height, `${name}: report panel clipped`);
  assert(report.rows === 22, `${name}: expected 22 classification rows`);
  assert(report.firstRow && report.firstRow.width > 400 && report.firstRow.height >= 36, `${name}: classification row collapsed`);
  assert(report.columns?.includes("GAP / STATUS") && report.columns.includes("STRATEGY") && report.columns.includes("PEN"), `${name}: official classification columns missing`);
  assert(report.stewards?.includes("FIA STEWARDS"), `${name}: steward sheet missing`);
  await page.screenshot({ path: resolve(`qa/final-results-team-orders-${name}.jpg`), type: "jpeg", quality: 90, fullPage: true });
  return { name, workspace, report };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, viewport] of [["1600x900", { width: 1600, height: 900 }], ["1280x720", { width: 1280, height: 720 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("React DevTools")) errors.push(`console: ${message.text()}`); });
    await enterRace(page);
    results.push(await inspect(page, name));
    assert(errors.length === 0, `${name}: ${errors.join(" | ")}`);
    await context.close();
  }
  await writeFile(resolve("qa/final-results-team-orders-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
}
