import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3001";
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

async function enterRacePreparation(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /ENTER WEEKEND/i }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await clickReportAction(page, /ACKNOWLEDGE REPORT/i);
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await clickReportAction(page, /START Q1/i);
  for (const session of ["Q1", "Q2", "Q3"]) {
    await page.getByRole("button", { name: `SKIP ${session}` }).click();
    await clickReportAction(page, session === "Q3" ? /ACKNOWLEDGE REPORT/i : new RegExp(`START Q${Number(session[1]) + 1}`, "i"));
  }
  await page.getByText("RACE PREPARATION", { exact: true }).first().waitFor();
}

async function viewportMetrics(page, selector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    const rect = root?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      root: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
    };
  }, selector);
}

async function containment(page, selectors) {
  return page.evaluate((targets) => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect ? { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    return targets.map(box);
  }, selectors);
}

async function checkRacePreparation(page, label, screenshot) {
  const gridSection = page.getByText("STARTING GRID", { exact: true }).locator("xpath=ancestor::section[1]");
  const gridCars = gridSection.locator("article");
  check(await gridCars.count() === 22, `${label} renders all 22 grid cars`);
  const finalGridCarVisible = await gridCars.nth(21).isVisible();
  check(finalGridCarVisible, `${label} keeps P22 visible`);

  /*
   * Compounds are browsed through per-driver tabs, and the sets of the selected
   * compound are chosen directly. The previous layout offered a compound row plus
   * fixed "new"/"used" buttons instead.
   */
  const compoundTabs = page.getByRole("group", { name: /compound$/ });
  check(await compoundTabs.count() === 2, `${label} gives each player car its own compound tabs`);
  check(await compoundTabs.first().getByRole("button").count() === 5, `${label} exposes five compounds for both player cars`);

  const softTab = compoundTabs.first().getByRole("button", { name: /show SOFT sets/i });
  check(await softTab.isEnabled(), `${label} allows a Soft race start`);
  await softTab.click();
  check(await softTab.getAttribute("aria-pressed") === "true", `${label} applies the Soft selection immediately`);

  const setButtons = page.locator("button[data-start-set-choice='true']");
  check(await setButtons.count() > 0, `${label} lists the selected compound's sets`);
  const setText = await setButtons.allInnerTexts();
  check(setText.every((text) => /\d+%/.test(text)), `${label} reports remaining life on every selectable set`, setText.slice(0, 4));
  const firstSet = setButtons.first();
  await firstSet.click();
  check(await firstSet.getAttribute("aria-pressed") === "true", `${label} can select an exact starting set`);

  const startWeather = page.getByLabel("Race start conditions");
  check(await startWeather.isVisible(), `${label} shows the conditions the race starts in`);

  // Each driver now has its own plan block, so both are asserted.
  const planBlocks = page.locator("[class*='preRacePlanRows']");
  check(await planBlocks.count() === 2, `${label} shows a plan block for each player car`);
  const planRows = planBlocks.first().locator("article");
  check(await planRows.count() === 3, `${label} displays Plan A, Plan B and Plan C`);
  const planFacts = await planRows.evaluateAll((rows) => rows.map((row) => ({
    label: row.textContent?.replace(/\s+/g, " ").trim(),
    stints: row.querySelectorAll("[class*='preRacePlanStint']").length,
    compounds: new Set(Array.from(row.querySelectorAll("[data-compound]"), (stint) => stint.getAttribute("data-compound"))).size,
  })));
  check(planFacts.every((plan) => plan.stints >= 2 && plan.compounds >= 2 && /STOP/.test(plan.label ?? "")), `${label} plans show legal multi-compound stint graphics and stop counts`, planFacts);

  const bounds = await containment(page, [
    "[class*='gridPair']:last-child article:last-child",
    // Second driver band, addressed by its own type rather than sibling index:
    // the conditions panel now sits between the header and the first band.
    "[class*='driverStrategyRow']:last-of-type",
    "[class*='preRacePlanRows'] > article:nth-child(3)",
    "[class*='raceDebriefArea'] button",
  ]);
  check(bounds.every((box) => box && box.left >= 0 && box.top >= 0 && box.right <= page.viewportSize().width && box.bottom <= page.viewportSize().height), `${label} keeps P22, car two, Plan C and START RACE inside the viewport`, bounds);
  const metrics = await viewportMetrics(page, "main");
  check(metrics.document.width <= metrics.viewport.width && metrics.document.height <= metrics.viewport.height, `${label} has no document overflow`, metrics);
  results.viewports[`${label} prep`] = { metrics, bounds, planFacts };
  await page.screenshot({ path: resolve(screenshot), type: "png" });
}

async function checkRaceHud(page, label, screenshot) {
  await page.getByRole("button", { name: "START RACE" }).click();
  await page.waitForTimeout(4_900);
  const headers = page.locator(".timing-head > span");
  const headerFacts = await headers.evaluateAll((cells) => cells.slice(0, 5).map((cell) => ({ text: cell.textContent?.trim(), fits: cell.scrollWidth <= cell.clientWidth + 1, width: cell.clientWidth })));
  check(headerFacts.map((item) => item.text).join(",") === "P,DRIVER,TYRE,LIFE,GAP" && headerFacts.every((item) => item.fits), `${label} shows every Leader Board heading without clipping`, headerFacts);

  const orderButtons = page.locator(".team-order-rail button");
  const orderFacts = await orderButtons.evaluateAll((buttons) => buttons.map((button) => {
    const icon = button.querySelector("svg")?.getBoundingClientRect();
    const labelBox = button.querySelector("span")?.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return {
      text: button.textContent?.trim(),
      icon: Boolean(icon),
      iconOffset: icon ? Math.abs((icon.left + icon.width / 2) - (box.left + box.width / 2)) : 99,
      labelOffset: labelBox ? Math.abs((labelBox.left + labelBox.width / 2) - (box.left + box.width / 2)) : 99,
    };
  }));
  check(orderFacts.length === 3 && orderFacts.every((item) => item.icon && item.iconOffset <= 2 && item.labelOffset <= 2), `${label} centers FREE, HOLD and SWAP icons`, orderFacts);

  await page.getByRole("button", { name: "Set pace ATTACK" }).click();
  await page.waitForTimeout(250);
  const radio = page.locator(".track-radio");
  check(await radio.locator("[data-source='DRIVER']").count() === 1, `${label} gives the latest driver message the primary radio slot`);
  check(await radio.locator("[data-source='ENGINEER']").count() === 1, `${label} shows one compact engineer command response`);
  const radioFit = await radio.evaluate((root) => {
    const messages = root.querySelector(".track-radio__messages");
    const engineerMeta = root.querySelector(".track-radio__message--engineer small");
    const weather = root.closest(".track-intelligence-rail")?.querySelector(".track-weather");
    if (!messages || !engineerMeta || !weather) return null;
    const weatherBefore = weather.getBoundingClientRect();
    const driverCopy = root.querySelector(".track-radio__message--driver p");
    if (driverCopy) driverCopy.textContent = "The rear is moving through the high-speed change of direction and I can feel drops at the far end of the circuit. ".repeat(6);
    const weatherAfter = weather.getBoundingClientRect();
    messages.scrollTop = messages.scrollHeight;
    return {
      metaFits: engineerMeta.scrollWidth <= engineerMeta.clientWidth + 1 || getComputedStyle(engineerMeta).whiteSpace === "normal",
      overflowY: getComputedStyle(messages).overflowY,
      endReachable: messages.scrollHeight <= messages.clientHeight + 1 || Math.abs(messages.scrollTop + messages.clientHeight - messages.scrollHeight) <= 2,
      weatherStable: Math.abs(weatherBefore.top - weatherAfter.top) <= 1 && Math.abs(weatherBefore.height - weatherAfter.height) <= 1,
    };
  });
  check(Boolean(radioFit) && radioFit.metaFits && radioFit.endReachable && radioFit.weatherStable && ["auto", "scroll"].includes(radioFit.overflowY), `${label} keeps long radio and blue engineer metadata inside the radio panel`, radioFit);
  const metrics = await viewportMetrics(page, "main.pitwall-shell");
  check(metrics.document.width <= metrics.viewport.width && metrics.document.height <= metrics.viewport.height, `${label} race HUD has no document overflow`, metrics);
  results.viewports[`${label} race`] = { metrics, headerFacts, orderFacts, radioFit };
  await page.screenshot({ path: resolve(screenshot), type: "png" });
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    const label = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage({ viewport });
    page.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(`${label}: ${message.text()}`); });
    await enterRacePreparation(page);
    await checkRacePreparation(page, label, `qa/race-preparation-strategy-${label}.png`);
    await checkRaceHud(page, label, `qa/race-hud-strategy-${label}.png`);
    await page.close();
  }
  check(results.consoleErrors.length === 0, "browser console has no uncaught errors", results.consoleErrors);
} finally {
  await browser.close();
}

await writeFile(resolve("qa/race-preparation-strategy-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
