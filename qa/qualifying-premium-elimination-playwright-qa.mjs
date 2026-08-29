import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const results = { passed: [], sessions: {}, viewports: {}, consoleErrors: [], failure: null };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function reportAction(page, label) {
  const button = page.getByRole("dialog").getByRole("button", { name: label });
  await button.waitFor({ timeout: 15_000 });
  await button.click();
}

async function enterAstonQ1(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("option", { name: /Aston Martin/i }).click();
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await reportAction(page, /ACKNOWLEDGE REPORT/i);
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await reportAction(page, /START Q1/i);
  await page.locator("main[data-qualifying-session='Q1']").waitFor();
}

async function activeCarIds(page) {
  return page.locator("[aria-label='Qualifying leaderboard'] [data-car-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-car-id")));
}

async function activeDriverCodes(page) {
  return page.locator("[aria-label='Qualifying leaderboard'] [data-driver-code]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-driver-code")));
}

async function eliminatedCodes(page, session) {
  const classification = page.getByLabel(`${session} final classification`);
  await classification.waitFor({ timeout: 15_000 });
  const footer = classification.locator("footer");
  if (!await footer.count()) return [];
  return footer.locator("b").allTextContents();
}

async function qualifyingReportMetrics(page, session) {
  const dialog = page.getByRole("dialog");
  const metrics = await dialog.evaluate((root, classificationLabel) => {
    const classificationNode = root.querySelector(`[aria-label="${classificationLabel} final classification"]`);
    const driverReports = [...root.querySelectorAll("strong")].filter((node) => node.textContent?.trim() === "DRIVER REPORT");
    const engineerReports = [...root.querySelectorAll("strong")].filter((node) => node.textContent?.trim() === "ENGINEER REPORT");
    const reportParagraphs = driverReports.map((heading) => heading.parentElement?.querySelector("p")).filter(Boolean);
    const sampleTime = classificationNode?.querySelector("time");
    const classificationRect = classificationNode?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      driverReports: driverReports.length,
      engineerReports: engineerReports.length,
      clippedReports: reportParagraphs.filter((paragraph) => paragraph.scrollWidth > paragraph.clientWidth + 1 || paragraph.scrollHeight > paragraph.clientHeight + 1).map((paragraph) => paragraph.textContent?.trim()),
      timeFontSize: sampleTime ? Number.parseFloat(getComputedStyle(sampleTime).fontSize) : 0,
      classificationWidthRatio: classificationRect && rootRect ? classificationRect.width / rootRect.width : 0,
    };
  }, session);
  check(metrics.driverReports === 2, `${session} result shows both player-driver reactions`, metrics);
  check(metrics.engineerReports === 0, `${session} result removes engineer reports`, metrics);
  check(metrics.clippedReports.length === 0, `${session} driver reactions wrap without clipping or ellipsis`, metrics.clippedReports);
  check(metrics.timeFontSize >= 12, `${session} classification timing remains at least 12px`, metrics);
  check(metrics.classificationWidthRatio >= 0.62, `${session} classification uses the majority of result width`, metrics);
  return metrics;
}

async function chequeredTopbarMetrics(page, label) {
  const metrics = await page.locator(".track-flag-panel.status--chequered").evaluate((panel) => {
    const style = getComputedStyle(panel);
    const title = document.querySelector(".control-message-title");
    const detail = document.querySelector(".control-message-detail");
    return {
      label: panel.querySelector("strong")?.textContent?.trim(),
      backgroundImage: style.backgroundImage,
      animationName: style.animationName,
      title: title?.textContent?.trim(),
      detail: detail?.textContent?.trim(),
      titleClipped: title ? title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1 : true,
      detailClipped: detail ? detail.scrollWidth > detail.clientWidth + 1 || detail.scrollHeight > detail.clientHeight + 1 : true,
    };
  });
  check(metrics.label === "CHEQUERED", `${label} uses the full chequered label`, metrics);
  check(metrics.backgroundImage.includes("conic-gradient"), `${label} renders a chequerboard flag pattern`, metrics);
  check(metrics.animationName.includes("chequered-panel-flash"), `${label} keeps the chequered flag blinking`, metrics);
  check(metrics.title === "CHEQUERED FLAG" && !metrics.titleClipped && !metrics.detailClipped, `${label} keeps both chequered control lines fully visible`, metrics);
  return metrics;
}

async function fitMetrics(page, label) {
  const metrics = await page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const clipped = [...document.querySelectorAll("[aria-label='Qualifying driver control'] button span, [aria-label='Qualifying driver control'] button b, [aria-label='Qualifying driver control'] button small, [data-traffic-overview='true'] strong, [data-traffic-overview='true'] em")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.textContent?.trim());
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      tower: bounds("[aria-label='Qualifying leaderboard']"),
      map: bounds("[data-traffic-overview='true']"),
      rail: bounds("[aria-label='Qualifying driver control'], [data-team-eliminated='true']"),
      clipped,
    };
  });
  check(metrics.scrollWidth <= metrics.width && metrics.scrollHeight <= metrics.height, `${label} has no document overflow`, metrics);
  check([metrics.tower, metrics.map, metrics.rail].every((region) => region && region.left >= 0 && region.top >= 0 && region.right <= metrics.width && region.bottom <= metrics.height), `${label} keeps every qualifying region in view`, metrics);
  check(metrics.clipped.length === 0, `${label} has no clipped control or circuit labels`, metrics.clipped);
  results.viewports[label] = metrics;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => results.consoleErrors.push(error.message));
  await enterAstonQ1(page);

  const q1Ids = await activeCarIds(page);
  check(q1Ids.length === 22, "Q1 starts with all 22 classified entrants", q1Ids);
  const rail = page.getByLabel("Qualifying driver control");
  const driverTabs = rail.getByRole("button", { name: /Control (Fernando Alonso|Lance Stroll)/i });
  check(await driverTabs.count() === 2, "both player-driver tabs are available in Q1");
  await driverTabs.nth(1).click();
  const secondDriverTyres = rail.locator("button[data-tyre-choice='true']");
  check(await secondDriverTyres.count() === 5, "second player driver exposes exactly five combined tyre choices");
  const secondDriverSoft = rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await secondDriverSoft.click();
  check(await secondDriverSoft.getAttribute("aria-pressed") === "true"
    && Boolean(await secondDriverSoft.getAttribute("data-set-id"))
    && Boolean(await secondDriverSoft.getAttribute("data-set-number"))
    && /^(NEW|USED)$/.test(await secondDriverSoft.getAttribute("data-status") ?? ""),
  "second player driver can select one exact physical tyre set");
  await driverTabs.nth(0).click();

  const selectionGroups = [
    [/set out lap pace Gentle/i, /set out lap pace Balanced/i, /set out lap pace Aggressive Warm-up/i],
    [/set flying lap attack Safe/i, /set flying lap attack Push/i, /set flying lap attack Attack/i, /set flying lap attack Maximum/i],
    [/set fuel plan 1 Flying Lap/i, /set fuel plan 2 Flying Laps$/i, /set fuel plan 2 Laps \+ Margin/i],
  ];
  for (const group of selectionGroups) {
    for (const name of group) {
      const button = rail.getByRole("button", { name });
      await button.click();
      check(await button.getAttribute("aria-pressed") === "true", `control selection ${name} exposes an active state`);
    }
  }
  check(await rail.getByRole("button", { name: /set energy mode/i }).count() === 0, "qualifying removes manual energy-mode controls");
  check(await rail.locator("[role='status'][data-mode]").count() === 0, "qualifying removes the battery strategy status block");
  const tyreChoices = rail.locator("button[data-tyre-choice='true']");
  check(await tyreChoices.count() === 5, "first player driver exposes exactly five combined tyre choices");
  check(await rail.locator("button[data-tyre-set-choice='true']").count() >= 2, "first player driver can see the selected compound's physical tyre sets");
  const tyreMetadata = await tyreChoices.evaluateAll((buttons) => buttons.map((button) => ({
    life: button.textContent?.trim() ?? "",
    setCount: Number(button.getAttribute("data-set-count") ?? 0),
    setId: button.getAttribute("data-set-id") ?? "",
    setNumber: button.getAttribute("data-set-number") ?? "",
    status: button.getAttribute("data-status") ?? "",
  })));
  // Compound buttons name their compound; remaining life is shown on the
  // physical-set row, which is where a set is actually selected.
  check(tyreMetadata.every((choice) => choice.setCount === 0 || (/[A-Z]{3,}/.test(choice.life)
    && !/\d+%/.test(choice.life)
    && choice.setId.length > 0
    && /^\d+$/.test(choice.setNumber)
    && /^(NEW|USED)$/.test(choice.status))),
  "every available combined tyre choice exposes its compound name and exact physical-set metadata", tyreMetadata);
  const soft = rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await soft.click();
  const firstSoftSetId = await soft.getAttribute("data-set-id");
  await soft.click();
  const cycledSoftSetId = await soft.getAttribute("data-set-id");
  check(Boolean(firstSoftSetId && cycledSoftSetId && firstSoftSetId !== cycledSoftSetId), "reselecting Soft cycles to another exact physical tyre set", { firstSoftSetId, cycledSoftSetId });
  check(await rail.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 1, "physical tyre selection keeps exactly one combined button active");
  const visiblePhysicalSets = rail.locator("button[data-tyre-set-choice='true']");
  check(await visiblePhysicalSets.count() >= 2 && /\d+%/.test(await visiblePhysicalSets.first().innerText()), "physical sets display remaining life directly");
  check(await page.getByLabel("Session best sector times").isVisible(), "circuit shows the session-best sector ribbon");
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.waitForTimeout(30_000);
  const liveCanvas = page.locator("canvas[data-renderer='SINGLE_CANVAS']");
  check(Number(await liveCanvas.getAttribute("data-active-cars") ?? 0) >= 2, "30-second exploratory run reaches a dense live-traffic state");
  check(await page.getByLabel("Session best sector times").locator("[data-set='true']").count() >= 1, "live sector feedback updates during the exploratory run");
  await page.getByRole("button", { name: "Pause qualifying" }).click();
  check(await page.getByRole("button", { name: "Resume qualifying" }).getAttribute("aria-pressed") === "true", "pause exposes a clear active transport state");
  await page.getByRole("button", { name: "Resume qualifying" }).click();
  await page.screenshot({ path: resolve("qa/qualifying-premium-1440x900.png"), type: "png" });
  await fitMetrics(page, "Q1 1440x900");

  await page.locator("main[data-qualifying-status='CHECKERED']").waitFor({ timeout: 55_000 });
  const q1Chequered = await chequeredTopbarMetrics(page, "Q1 topbar");
  await page.screenshot({ path: resolve("qa/qualifying-chequered-1440x900.png"), type: "png" });
  await page.getByLabel("Q1 final classification").waitFor({ timeout: 20_000 });
  const q1Eliminated = await eliminatedCodes(page, "Q1");
  check(q1Eliminated.length === 6, "Q1 report marks exactly six timed AI-simulated drivers as eliminated", q1Eliminated);
  const q1Classification = page.getByLabel("Q1 final classification");
  check(await q1Classification.locator("[data-result-status='ADV']").count() === 16, "Q1 report labels all sixteen advancing drivers explicitly");
  check(await q1Classification.locator("[data-result-status='OUT']").count() === 6, "Q1 report labels all six eliminated drivers explicitly");
  check(await q1Classification.locator("[data-cut-boundary='true']").count() === 1, "Q1 report draws one cut boundary above the first eliminated driver");
  const q1Report = await qualifyingReportMetrics(page, "Q1");
  await page.screenshot({ path: resolve("qa/qualifying-strategy-q1-report-1440x900.png"), type: "png" });
  await reportAction(page, /START Q2/i);
  await page.locator("main[data-qualifying-session='Q2']").waitFor();
  const q2Ids = await activeCarIds(page);
  const q2Codes = await activeDriverCodes(page);
  check(q2Ids.length === 16, "Q2 entry list contains only the 16 Q1 qualifiers", q2Ids);
  check(q1Eliminated.every((code) => !q2Codes.includes(code)), "Q1 eliminated codes are absent from the active Q2 field", { q1Eliminated, q2Codes });
  const eliminatedPlayerCodes = ["ALO", "STR"].filter((code) => q1Eliminated.includes(code));
  if (eliminatedPlayerCodes.length === 2) {
    check(await page.locator("[data-team-eliminated='true']").isVisible(), "a fully eliminated player team retains a visible non-interactive status rail");
    check(await page.getByText("NO ACTIVE CARS", { exact: true }).isVisible(), "the eliminated team rail clearly explains that no controls remain");
  } else {
    for (const code of eliminatedPlayerCodes) {
      const eliminatedTab = page.getByRole("button", { name: new RegExp(`${code === "ALO" ? "Fernando Alonso" : "Lance Stroll"} eliminated in Q1`, "i") });
      check(await eliminatedTab.isDisabled(), `${code} remains visibly eliminated and cannot receive Q2 controls`);
    }
  }
  check(await page.locator("[aria-label='Qualifying leaderboard'] [data-car-id]").filter({ hasText: "NO LAP" }).count() === 16, "Q2 resets all session-specific lap records");
  const q2SectorSet = await page.getByLabel("Session best sector times").locator("[data-set='true']").count();
  check(q2SectorSet === 0, "Q2 resets session-best sector data");
  results.sessions.Q1 = { entrants: q1Ids.length, eliminated: q1Eliminated, q2Entrants: q2Ids.length, report: q1Report, chequered: q1Chequered };

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: resolve("qa/qualifying-premium-q2-1920x1080.png"), type: "png" });
  await fitMetrics(page, "Q2 1920x1080");

  await page.getByRole("button", { name: "SKIP Q2" }).click();
  const q2Eliminated = await eliminatedCodes(page, "Q2");
  check(q2Eliminated.length === 6, "Q2 report marks exactly six drivers as eliminated", q2Eliminated);
  const q2Classification = page.getByLabel("Q2 final classification");
  check(await q2Classification.locator("[data-result-status='ADV']").count() === 10, "Q2 report labels the ten Q3 qualifiers explicitly");
  check(await q2Classification.locator("[data-result-status='OUT']").count() === 6, "Q2 report preserves six eliminated states");
  const q2Report = await qualifyingReportMetrics(page, "Q2");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: resolve("qa/qualifying-strategy-q2-report-1280x720.png"), type: "png" });
  await reportAction(page, /START Q3/i);
  await page.locator("main[data-qualifying-session='Q3']").waitFor();
  const q3Ids = await activeCarIds(page);
  check(q3Ids.length === 10, "Q3 entry list contains only the 10 Q2 qualifiers", q3Ids);
  check(await page.locator("[aria-label='Qualifying leaderboard'] [data-car-id]").filter({ hasText: "NO LAP" }).count() === 10, "Q3 starts with clean segment-specific timing data");
  results.sessions.Q2 = { entrants: q2Ids.length, eliminated: q2Eliminated, q3Entrants: q3Ids.length, report: q2Report };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: resolve("qa/qualifying-strategy-q3-ready-1920x1080.png"), type: "png" });

  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-premium-elimination-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  await context.close();
} catch (error) {
  results.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await writeFile(resolve("qa/qualifying-premium-elimination-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
