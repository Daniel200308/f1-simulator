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
    const elementBounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, clientHeight: element.clientHeight };
    };
    const bounds = (selector) => elementBounds(document.querySelector(selector));
    const controls = document.querySelector("[aria-label='Qualifying driver control']");
    const controlCore = controls?.querySelector("[class*='controlCore']");
    const coreBox = elementBounds(controlCore);
    const coreSections = [...(controlCore?.querySelectorAll(":scope > section[class*='controlSection']") ?? [])].map(elementBounds).filter(Boolean);
    const coreTopSpace = coreBox && coreSections.length > 0 ? Math.min(...coreSections.map((section) => section.top)) - coreBox.top : null;
    const coreBottomSpace = coreBox && coreSections.length > 0 ? coreBox.bottom - Math.max(...coreSections.map((section) => section.bottom)) : null;
    const coreBalance = coreTopSpace !== null && coreBottomSpace !== null ? Math.abs(coreTopSpace - coreBottomSpace) : null;
    const operationControls = [...(controlCore?.querySelectorAll("[class*='segmentOptions'], [class*='orbOptions']") ?? [])].map((control) => {
      const controlBox = elementBounds(control);
      const sectionBox = elementBounds(control.closest("section"));
      const buttonWidths = [...control.querySelectorAll("button")].map((button) => button.getBoundingClientRect().width);
      return controlBox && sectionBox ? { ...controlBox, maxButtonWidth: Math.max(...buttonWidths), centreOffset: Math.abs((controlBox.left + controlBox.right) / 2 - (sectionBox.left + sectionBox.right) / 2) } : null;
    }).filter(Boolean);
    const clipped = [...document.querySelectorAll("[aria-label='Qualifying driver control'] button span, [aria-label='Qualifying driver control'] button b, [aria-label='Qualifying driver control'] button small, [aria-label='Live tyre temperatures'] em")]
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
      tyreSection: bounds("[aria-label='Qualifying driver control'] [data-control='tyres']"),
      controlCore: coreBox,
      coreBalance,
      operationControls,
      clipped,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check([metrics.tower, metrics.map, metrics.controls].every((item) => item && item.left >= 0 && item.top >= 0 && item.right <= metrics.innerWidth && item.bottom <= metrics.innerHeight), `${label} keeps leaderboard, circuit and control rail in the viewport`, metrics);
  check(metrics.tyreSection && metrics.tyreSection.bottom <= metrics.controls.bottom && metrics.tyreSection.height <= 140, `${label} keeps compound and physical-set selectors visible at the bottom`, metrics.tyreSection);
  check(metrics.controlCore && metrics.coreBalance !== null && metrics.coreBalance <= 5, `${label} centres the operation controls vertically`, { core: metrics.controlCore, balance: metrics.coreBalance });
  check(metrics.operationControls.length === 5
    && metrics.operationControls.every((control) => control.centreOffset <= 3 && control.maxButtonWidth < metrics.controlCore.width * .46),
  `${label} keeps centred operation buttons narrower than the rail`, metrics.operationControls);
  check(metrics.clipped.length === 0, `${label} control labels are not clipped`, metrics.clipped);
  results.viewports[label] = metrics;
}

async function exerciseControls(page, label, completeRun) {
  const rail = page.getByLabel("Qualifying driver control");
  const canvas = page.locator("canvas[data-renderer='SINGLE_CANVAS']");

  const release = rail.getByRole("button", { name: /LEC Release Now/i });
  check(await release.isDisabled(), `${label} blocks release until a physical tyre set is selected`);
  check(await rail.getByRole("button", { name: /Wait for Gap|Hold in Garage/i }).count() === 0, `${label} exposes only the Release action`);
  const tyreChoices = rail.locator("button[data-tyre-choice='true']");
  check(await tyreChoices.count() === 5, `${label} exposes exactly five combined tyre choices`);
  check(await rail.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 0, `${label} begins without inventing a selected physical set`);
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
  `${label} exposes the compound name and actual set id, number and status on every available tyre choice`, tyreMetadata);
  check(await rail.locator("button[data-tyre-set-choice='true']").count() >= 2, `${label} directly exposes the selected compound's physical tyre sets`);
  check(await rail.getByRole("button", { name: /Release Now/i }).count() === 1, `${label} renders exactly one Release control`);

  for (const compound of ["MEDIUM", "HARD", "INTERMEDIATE", "WET", "SOFT"]) {
    const choice = rail.locator(`button[data-tyre-choice='true'][data-compound='${compound}']`);
    await choice.click();
    check(await choice.getAttribute("aria-pressed") === "true", `${label} selects ${compound} from the compound sidewalls`);
  }
  const softChoice = rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  const firstSoftSetId = await softChoice.getAttribute("data-set-id");
  await softChoice.click();
  const cycledSoftSetId = await softChoice.getAttribute("data-set-id");
  check(Boolean(firstSoftSetId && cycledSoftSetId && firstSoftSetId !== cycledSoftSetId), `${label} cycles through exact Soft sets when the selected button is pressed again`, { firstSoftSetId, cycledSoftSetId });
  check(await rail.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 1, `${label} highlights exactly one selected physical set`);
  check(await release.isEnabled(), `${label} enables release after selecting a set`);

  await rail.getByRole("button", { name: "Control Lewis Hamilton, car 44" }).click();
  const secondDriverChoices = rail.locator("button[data-tyre-choice='true']");
  check(await secondDriverChoices.count() === 5, `${label} keeps five tyre choices after switching drivers`);
  const secondDriverSoft = rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await secondDriverSoft.click();
  check(await secondDriverSoft.getAttribute("aria-pressed") === "true" && Boolean(await secondDriverSoft.getAttribute("data-set-id")), `${label} lets the second driver select an exact physical set`);
  await rail.getByRole("button", { name: "Control Charles Leclerc, car 16" }).click();
  check(await rail.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 1, `${label} preserves the first driver's exact tyre selection after switching back`);

  await page.getByRole("button", { name: "Pause qualifying" }).click();
  check(await rail.locator("[role='status'][data-mode]").count() === 0, `${label} keeps the removed battery strategy out of the command rail while paused`);
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
    const usedSet = rail.locator("button[data-tyre-set-choice='true'][data-status='USED']").first();
    await usedSet.waitFor({ timeout: 3_000 });
    const usedSetData = { life: await usedSet.innerText(), setId: await usedSet.getAttribute("data-set-id"), setNumber: await usedSet.getAttribute("data-set-number") };
    check(Boolean(usedSetData.setId && usedSetData.setNumber && /\d+%/.test(usedSetData.life)), `${label} directly exposes the completed qualifying set as USED with remaining life`, usedSetData);
    await usedSet.click();
    check(await usedSet.getAttribute("aria-pressed") === "true", `${label} lets the player reselect the used physical set directly`);
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
