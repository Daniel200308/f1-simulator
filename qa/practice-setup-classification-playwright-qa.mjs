import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = "http://127.0.0.1:3000";
const results = { passed: [], viewports: {} };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function enterWeekend(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  await page.getByRole("button", { name: "RUN FP1" }).waitFor();
}

async function completeSession(page, session) {
  await page.getByRole("button", { name: `RUN ${session}` }).click();
  await page.getByRole("button", { name: /ACKNOWLEDGE REPORT/i }).click();
}

function visibleTimingPanel(page, session) {
  return page.getByText(`${session} CLASSIFICATION`, { exact: true }).locator("xpath=ancestor::section[1]");
}

async function checkViewportFit(page, label) {
  const metrics = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("RUN "));
    const shell = button?.closest("main");
    const shellRect = shell?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      shell: shellRect ? { left: shellRect.left, top: shellRect.top, right: shellRect.right, bottom: shellRect.bottom } : null,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth, `${label} has no document-level horizontal overflow`, metrics);
  check(metrics.scrollHeight <= metrics.innerHeight, `${label} has no document-level vertical overflow`, metrics);
  check(Boolean(metrics.shell) && metrics.shell.left >= 0 && metrics.shell.top >= 0 && metrics.shell.right <= metrics.innerWidth && metrics.shell.bottom <= metrics.innerHeight, `${label} practice shell fits the viewport`, metrics);
  results.viewports[label] = metrics;
}

const browser = await chromium.launch({ headless: true });

try {
  const desktop = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await enterWeekend(desktop);

  const sliders = desktop.locator('input[type="range"]');
  check(await sliders.count() === 12, "both player cars expose all 12 setup controls");
  const sliderAttributes = await sliders.evaluateAll((items) => items.map((item) => ({ min: item.min, max: item.max, step: item.step })));
  check(sliderAttributes.every((attributes) => attributes.min === "-50" && attributes.max === "50" && attributes.step === "1"), "all setup sliders use -50 to 50 with integer steps", sliderAttributes);

  const firstSlider = sliders.first();
  const displayedValue = firstSlider.locator("xpath=ancestor::label[1]").locator(":scope > span > strong");
  await firstSlider.fill("-50");
  check(await displayedValue.textContent() === "-50", "negative endpoint is displayed without clipping");
  await firstSlider.fill("50");
  check(await displayedValue.textContent() === "+50", "positive endpoint is displayed with a clear sign");
  await firstSlider.fill("0");
  check(await displayedValue.textContent() === "0", "neutral setup value remains available");
  await checkViewportFit(desktop, "1600x900 baseline");
  await desktop.screenshot({ path: resolve("qa/practice-setup-baseline-1600x900.png"), type: "png" });

  await completeSession(desktop, "FP1");
  const fp1Ranges = await desktop.getByText(/FP1 RANGE/).allTextContents();
  check(fp1Ranges.length === 12 && fp1Ranges.every((label) => {
    const values = label.match(/-?\d+/g)?.map(Number) ?? [];
    return values.length >= 3 && values.at(-1) - values.at(-2) === 40;
  }), "FP1 recommendation bands retain 40 setup points", fp1Ranges);

  const fp1Panel = visibleTimingPanel(desktop, "FP1");
  const fp1Rows = fp1Panel.locator(":scope > div > div > div");
  check(await fp1Rows.count() === 22, "FP1 Classification renders all 22 drivers");
  const typeScale = await fp1Rows.first().evaluate((row) => {
    const style = (selector) => getComputedStyle(row.querySelector(selector));
    return {
      position: style(":scope > b").fontSize,
      driver: style(":scope > span > strong").fontSize,
      best: style(":scope > time").fontSize,
      gap: style(":scope > small").fontSize,
      gapColor: style(":scope > small").color,
    };
  });
  check(parseFloat(typeScale.position) >= 14 && parseFloat(typeScale.driver) >= 14, "Classification position and driver typography is enlarged", typeScale);
  check(parseFloat(typeScale.gap) >= 14 && typeScale.gapColor === "rgb(241, 246, 247)", "Classification GAP is large and high contrast", typeScale);
  await checkViewportFit(desktop, "1600x900 classification");
  await desktop.screenshot({ path: resolve("qa/practice-classification-1600x900.png"), type: "png" });

  await completeSession(desktop, "FP2");
  const fp2Ranges = await desktop.getByText(/FP2 RANGE/).allTextContents();
  check(fp2Ranges.length === 12 && fp2Ranges.every((label) => {
    const values = label.match(/-?\d+/g)?.map(Number) ?? [];
    return values.length >= 3 && values.at(-1) - values.at(-2) === 30;
  }), "FP2 recommendation bands narrow to 30 setup points", fp2Ranges);

  await completeSession(desktop, "FP3");
  const fp3Ranges = await desktop.getByText(/FP3 RANGE/).allTextContents();
  check(fp3Ranges.length === 12 && fp3Ranges.every((label) => {
    const values = label.match(/-?\d+/g)?.map(Number) ?? [];
    return values.length >= 3 && values.at(-1) - values.at(-2) === 22;
  }), "FP3 recommendation bands remain a non-trivial 22 setup points", fp3Ranges);

  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await enterWeekend(compact);
  await completeSession(compact, "FP1");
  const compactPanel = visibleTimingPanel(compact, "FP1");
  const compactBox = await compactPanel.boundingBox();
  check(Boolean(compactBox) && compactBox.x >= 0 && compactBox.x + compactBox.width <= 1280 && compactBox.y >= 0 && compactBox.y + compactBox.height <= 720, "1280x720 Classification panel remains inside the viewport", compactBox);
  await checkViewportFit(compact, "1280x720 classification");
  await compact.screenshot({ path: resolve("qa/practice-classification-1280x720.png"), type: "png" });
} finally {
  await browser.close();
}

await writeFile(resolve("qa/practice-setup-classification-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
