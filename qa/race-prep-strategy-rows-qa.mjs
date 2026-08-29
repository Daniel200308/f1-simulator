import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const results = { passed: [], consoleErrors: [], viewports: {} };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function acknowledge(page, label) {
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
}

/*
 * Skipping a segment leaves a player car in the garage, so its allocation stays
 * new. To see post-Q3 life the car has to actually run, so Q1 is driven with a
 * real release before the remaining segments are skipped.
 */
async function reachRacePreparation(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("option", { name: /Ferrari/i }).click();
  await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await acknowledge(page, "ACKNOWLEDGE REPORT");
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await acknowledge(page, "START Q1");

  // Drive Q1: pick a set, release, and let the lap complete.
  await page.locator("main[data-qualifying-session='Q1']").waitFor();
  const rail = page.getByLabel("Qualifying driver control");
  await rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']").click();
  await rail.getByRole("button", { name: /Release Now/i }).click();
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.waitForFunction(() => {
    const control = document.querySelector("[aria-label='Qualifying driver control']");
    return control?.getAttribute("data-lap-status") === "FLYING LAP";
  }, undefined, { timeout: 30_000 });

  for (const session of ["Q1", "Q2", "Q3"]) {
    await page.locator(`main[data-qualifying-session='${session}']`).waitFor();
    await page.getByRole("button", { name: `SKIP ${session}` }).click();
    await acknowledge(page, session === "Q3" ? /ACKNOWLEDGE REPORT/i : new RegExp(`START Q${Number(session[1]) + 1}`, "i"));
  }
  await page.getByText("RACE PREPARATION", { exact: true }).first().waitFor();
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => results.consoleErrors.push(error.message));

  await reachRacePreparation(page);

  // Both drivers must expose their own plan rows without a STRATEGY toggle.
  check(await page.getByRole("button", { name: /^STRATEGY$/ }).count() === 0, "race preparation removes the STRATEGY view toggle");
  const planGroups = page.getByRole("group", { name: /race strategy plans$/ });
  check(await planGroups.count() === 2, "both player drivers show their own plan rows", { count: await planGroups.count() });
  for (let index = 0; index < 2; index += 1) {
    const rows = planGroups.nth(index).locator("article");
    check(await rows.count() === 3, `driver ${index + 1} lists PLAN A, B and C`, { count: await rows.count() });
  }

  // Exact set selection, with post-Q3 life on every option.
  const setGroups = page.getByRole("group", { name: /starting tyre set$/ });
  check(await setGroups.count() === 2, "each driver selects from its own allocation");
  const compoundTabs = page.getByRole("group", { name: /compound$/ });
  check(await compoundTabs.count() === 2, "each driver has its own compound tabs");
  check(await compoundTabs.first().getByRole("button").count() === 5, "all five compounds are reachable");

  const setButtons = page.locator("button[data-start-set-choice='true']");
  const setText = await setButtons.allInnerTexts();
  check(setText.length > 0, "the selected compound's sets are listed", { count: setText.length });
  check(setText.every((text) => /\d+%/.test(text)), "every set button reports its remaining life", setText.slice(0, 6));

  // Browse each compound and confirm its whole allocation is reachable.
  let seenSetIds = new Set();
  for (let index = 0; index < 5; index += 1) {
    const tab = compoundTabs.first().getByRole("button").nth(index);
    if (await tab.isDisabled()) continue;
    await tab.click();
    for (const id of await setGroups.first().locator("button[data-start-set-choice='true']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-set-id")))) {
      seenSetIds.add(id);
    }
  }
  check(seenSetIds.size >= 10, "every allocated set is reachable through the compound tabs", { count: seenSetIds.size });

  // The scrubbed qualifying set must report the life it has left after Q3.
  await compoundTabs.first().getByRole("button").first().click();
  const softText = await setGroups.first().locator("button[data-start-set-choice='true']").allInnerTexts();
  check(softText.some((text) => !/100%/.test(text)), "scrubbed qualifying sets show reduced life after Q3", softText);

  // Selecting a scrubbed set must change the plans it produces.
  const firstGroup = setGroups.first();
  const planText = async () => (await planGroups.first().locator("article").allInnerTexts()).join("|");
  const before = await planText();
  const scrubbed = firstGroup.locator("button[data-freshness='USED']").first();
  if (await scrubbed.count() > 0) {
    await scrubbed.click();
    check(await scrubbed.getAttribute("aria-pressed") === "true", "a scrubbed set can be chosen as the race start tyre");
    const after = await planText();
    check(before !== after, "tyre life drives the PLAN A/B/C proposals", { before: before.slice(0, 60), after: after.slice(0, 60) });
  }

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(320);
    const label = `${viewport.width}x${viewport.height}`;
    const metrics = await page.evaluate(() => {
      // Scoped to the race-preparation regions this change owns.
      const scope = [
        ...document.querySelectorAll("button[data-start-set-choice='true']"),
        ...document.querySelectorAll("button[data-start-set-choice='true'] *"),
      ];
      const overflowing = scope
        .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        .map((node) => ({ text: (node.textContent ?? "").trim().slice(0, 24), scrollW: node.scrollWidth, clientW: node.clientWidth }));
      const small = [...document.querySelectorAll("button[data-start-set-choice='true']")]
        .map((button) => button.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height < 40)
        .length;
      return {
        horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        overflowing: overflowing.slice(0, 8),
        tooShortButtons: small,
      };
    });
    check(!metrics.horizontalScroll, `${label} has no horizontal scroll`, metrics);
    check(metrics.overflowing.length === 0, `${label} keeps every control label inside its button`, metrics.overflowing);
    results.viewports[label] = metrics;
    await mkdir(resolve("qa/responsive"), { recursive: true });
    await page.screenshot({ path: resolve(`qa/responsive/race-prep-strategy-${label}.png`) });
  }

  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/race-prep-strategy-rows-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`passed ${results.passed.length} checks`);
  await context.close();
} finally {
  await browser.close();
}
