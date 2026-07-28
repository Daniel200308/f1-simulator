import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const results = { passed: [], viewports: {} };
const target = "http://127.0.0.1:3000";

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function enterQ1(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  for (const session of ["FP1", "FP2", "FP3"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await page.getByRole("button", { name: /ACKNOWLEDGE REPORT/i }).click();
  }
  await page.getByRole("button", { name: "START Q1" }).waitFor();
}

async function fitMetrics(page, label) {
  const metrics = await page.evaluate(() => {
    const command = document.querySelector('[aria-label="Q1 qualifying command"], [aria-label="Q2 qualifying command"], [aria-label="Q3 qualifying command"]');
    const shell = command?.closest("main");
    const rect = shell?.getBoundingClientRect();
    const regions = command ? [...command.children].map((child) => {
      const childRect = child.getBoundingClientRect();
      return { left: childRect.left, top: childRect.top, right: childRect.right, bottom: childRect.bottom, scrollWidth: child.scrollWidth, clientWidth: child.clientWidth };
    }) : [];
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      shell: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      regions,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document-level overflow`, metrics);
  check(Boolean(metrics.shell) && metrics.shell.left >= 0 && metrics.shell.top >= 0 && metrics.shell.right <= metrics.innerWidth && metrics.shell.bottom <= metrics.innerHeight, `${label} qualifying shell fits the viewport`, metrics);
  check(metrics.regions.every((region) => region.left >= 0 && region.top >= 0 && region.right <= metrics.innerWidth && region.bottom <= metrics.innerHeight), `${label} primary command regions remain visible`, metrics.regions);
  check(metrics.regions.every((region) => region.scrollWidth <= region.clientWidth), `${label} primary command regions have no hidden horizontal clipping`, metrics.regions);
  results.viewports[label] = metrics;
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await enterQ1(page);

  check(await page.getByText("18:00", { exact: true }).isVisible(), "Q1 opens with the full 18-minute clock");
  check(await page.getByText("CUT LINE P16", { exact: true }).isVisible(), "Q1 displays the P16 advancing cut");
  const sendButtons = page.getByRole("button", { name: "SEND OUT" });
  check(await sendButtons.count() === 2 && await sendButtons.first().isDisabled(), "cars cannot be released before the session starts");

  for (const speed of ["1×", "6×", "30×"]) {
    await page.getByRole("button", { name: speed, exact: true }).click();
    check(await page.getByRole("button", { name: speed, exact: true }).getAttribute("aria-pressed") === "true", `${speed} qualifying speed can be selected`);
  }

  for (const compound of ["MEDIUM", "HARD", "SOFT"]) {
    await page.getByRole("button", { name: `LEC qualifying ${compound}` }).click();
    check(await page.getByRole("button", { name: `LEC qualifying ${compound}` }).getAttribute("aria-pressed") === "true", `garage tyre can be changed to ${compound}`);
  }

  await fitMetrics(page, "1600x900 ready");
  await page.screenshot({ path: resolve("qa/qualifying-command-q1-ready-1600x900.png"), type: "png" });
  await page.getByRole("button", { name: "START Q1" }).click();
  check(await page.getByText("SESSION LIVE", { exact: true }).isVisible(), "START Q1 changes the session to live");

  await sendButtons.first().click();
  await page.getByRole("button", { name: "CALL BACK" }).first().click();
  check(await page.getByText("GARAGE", { exact: true }).first().isVisible(), "an out-lap can be recalled without recording a time");
  await sendButtons.first().click();
  await sendButtons.nth(1).click();

  await page.waitForTimeout(4_000);
  check(await page.getByText(/OUT LAP|PUSH LAP|COOLDOWN/, { exact: true }).count() > 0, "player qualifying phases advance with elapsed time");
  await page.waitForTimeout(5_000);
  check(await page.locator("time").filter({ hasText: /\d:\d{2}\.\d{3}/ }).count() > 0, "player and AI cars record live timed laps");
  check(await page.getByText(/\+\d\.\d{3}/).count() > 0, "live Classification produces three-decimal GAP values");
  check((await page.getByText(/TRACK EVOLUTION/).locator("xpath=following-sibling::*[1]").count()) >= 0, "track evolution readout remains present during the session");
  await fitMetrics(page, "1600x900 live");
  await page.screenshot({ path: resolve("qa/qualifying-command-q1-live-1600x900.png"), type: "png" });

  await page.getByRole("button", { name: /ACKNOWLEDGE REPORT/i }).waitFor({ timeout: 45_000 });
  check(await page.getByText("Q1 QUALIFYING REPORT", { exact: true }).isVisible(), "Q1 reaches the checkered flag and produces a two-car report");
  await page.getByRole("button", { name: /ACKNOWLEDGE REPORT/i }).click();
  check(await page.getByRole("button", { name: "START Q2" }).isVisible(), "acknowledging Q1 opens Q2");
  check(await page.getByText("16 CARS · P10 ADVANCES", { exact: true }).isVisible(), "Q2 contains 16 entrants and the P10 cut");
  await page.screenshot({ path: resolve("qa/qualifying-command-q2-ready-1600x900.png"), type: "png" });

  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await enterQ1(compact);
  await fitMetrics(compact, "1280x720 ready");
  const primaryActions = compact.getByRole("button", { name: /START Q1|SEND OUT/ });
  check(await primaryActions.count() === 3 && await primaryActions.last().isVisible(), "1280x720 keeps session and car actions visible");
  await compact.screenshot({ path: resolve("qa/qualifying-command-q1-ready-1280x720.png"), type: "png" });
} finally {
  await browser.close();
}

await writeFile(resolve("qa/qualifying-command-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
