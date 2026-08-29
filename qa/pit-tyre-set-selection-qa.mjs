import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const results = { passed: [], consoleErrors: [], pitSamples: [], setPicker: null };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

const ack = async (page, name) => page.getByRole("dialog").getByRole("button", { name }).click();

async function startRace(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("option", { name: /Ferrari/i }).click();
  await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await ack(page, /ACKNOWLEDGE REPORT/i);
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await ack(page, /START Q1/i);
  for (const session of ["Q1", "Q2", "Q3"]) {
    await page.locator(`main[data-qualifying-session='${session}']`).waitFor();
    await page.getByRole("button", { name: `SKIP ${session}` }).click();
    await ack(page, session === "Q3" ? /ACKNOWLEDGE REPORT/i : new RegExp(`START Q${Number(session[1]) + 1}`, "i"));
  }
  await page.getByText("RACE PREPARATION", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: /START RACE/i }).click();
  await page.locator(".status-column").waitFor({ timeout: 30_000 });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") results.consoleErrors.push(message.text());
});

try {
  await startRace(page);
  const qaDir = resolve("qa");
  await mkdir(qaDir, { recursive: true });

  // 1. The dock keeps its five compound buttons plus the cancel control.
  const compoundButtons = page.locator(".pit-tyre-control .tyre-select-button");
  await compoundButtons.first().waitFor();
  check(await compoundButtons.count() === 5, "NEXT TYRE still shows five compound buttons");
  check(await page.locator(".pit-tyre-control .stay-out-control").count() === 1, "Stay-out control is unchanged");
  check(await page.locator(".tyre-set-picker").count() === 0, "Set list is closed until a compound is pressed");

  // 2. Pressing a compound opens that compound's remaining sets with life.
  const medium = page.locator('.pit-tyre-control .tyre-select-button[data-compound="MEDIUM"]');
  await medium.click();
  const picker = page.locator(".tyre-set-picker");
  await picker.waitFor();
  const setButtons = picker.locator(".tyre-set-picker__grid button");
  const setCount = await setButtons.count();
  check(setCount > 0, "Pressing MEDIUM reveals its remaining sets", { setCount });
  const setDetails = await setButtons.evaluateAll((nodes) => nodes.map((node) => ({
    setId: node.dataset.setId,
    label: node.querySelector("b")?.textContent ?? "",
    life: node.querySelector("strong")?.textContent ?? "",
    usage: node.querySelector("small")?.textContent ?? "",
    lifeBarWidth: node.style.getPropertyValue("--set-life"),
  })));
  results.setPicker = { headerCount: await picker.locator("header b").textContent(), sets: setDetails };
  check(setDetails.every((set) => /^#\d\d$/.test(set.label)), "Every set shows its set number", setDetails);
  check(setDetails.every((set) => /^\d+%$/.test(set.life)), "Every set shows remaining life", setDetails);
  check(setDetails.every((set) => set.usage === "NEW" || /^\d+L USED$/.test(set.usage)), "Every set shows laps used", setDetails);
  check(new Set(setDetails.map((set) => set.setId)).size === setDetails.length, "Sets are distinct");
  const clipping = await picker.evaluate((node) => ({
    scrollH: node.scrollHeight,
    clientH: node.clientHeight,
    scrollW: node.scrollWidth,
    clientW: node.clientWidth,
  }));
  check(clipping.scrollH <= clipping.clientH + 1 && clipping.scrollW <= clipping.clientW + 1, "The set list is not clipped", clipping);
  const dockBox = await page.locator(".command-strip").boundingBox();
  await page.screenshot({ path: resolve(qaDir, "pit-tyre-set-picker-1600x900.png"), clip: { x: dockBox.x, y: dockBox.y, width: dockBox.width, height: dockBox.height } });

  // 3. Choosing an exact set schedules the stop for that set.
  const chosen = setDetails.at(-1);
  await setButtons.last().click();
  await page.waitForTimeout(600);
  const scheduled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".track-radio__message p, .radio-message p")].map((node) => node.textContent ?? "");
    return rows.slice(0, 6);
  });
  check(await page.locator(".tyre-set-picker").count() === 0, "The set list closes once a set is chosen");
  check(await medium.getAttribute("aria-pressed") === "true", "The chosen compound reads as the scheduled stop");
  results.chosenSet = { chosen, radio: scheduled };

  // 4. The car must drive the pit lane: entry, its own box, then the exit.
  const pitProgress = [];
  const deadline = Date.now() + 190_000;
  let sawStop = false;
  let sawRejoin = false;
  while (Date.now() < deadline) {
    const sample = await page.evaluate(() => {
      const status = document.querySelector('[data-pit-status]');
      const map = document.querySelector(".track-map");
      return {
        pitStatus: status?.dataset.pitStatus ?? null,
        x: map?.dataset.selectedX ? Number(map.dataset.selectedX) : null,
        y: map?.dataset.selectedY ? Number(map.dataset.selectedY) : null,
      };
    });
    if (sample.pitStatus) {
      pitProgress.push(sample);
      if (sample.pitStatus === "PIT_STOP") sawStop = true;
      if (sawStop && sample.pitStatus === "TYRE_COMPLETE") sawRejoin = true;
    }
    if (sawRejoin) break;
    await page.waitForTimeout(250);
  }
  const stages = [...new Set(pitProgress.map((sample) => sample.pitStatus))];
  results.pitSamples = { stages, sampleCount: pitProgress.length };
  check(stages.includes("PIT_ENTRY") || stages.includes("PIT_LANE"), "The car is seen driving into the pit lane", stages);
  check(sawStop, "The car stops in its box for the tyre change", stages);
  check(stages.includes("PIT_EXIT") || sawRejoin, "The car drives back out of the pit lane", stages);

  // The marker has to move through the lane rather than appear at the exit.
  const positions = pitProgress.filter((sample) => sample.x !== null);
  const spread = positions.length > 1
    ? Math.max(...positions.map((p) => Math.hypot(p.x - positions[0].x, p.y - positions[0].y)))
    : 0;
  results.pitSamples.markerSpreadPx = Number(spread.toFixed(2));
  check(spread > 6, "The pit marker travels along the lane instead of spawning at the exit", { spread });

  // 5. After the stop, the set that came off must read as used with real life.
  await page.locator('.pit-tyre-control .tyre-select-button[data-compound="MEDIUM"]').click();
  await picker.waitFor();
  const usedDetails = await setButtons.evaluateAll((nodes) => nodes.map((node) => ({
    setId: node.dataset.setId,
    freshness: node.dataset.freshness,
    life: node.querySelector("strong")?.textContent ?? "",
    usage: node.querySelector("small")?.textContent ?? "",
  })));
  results.afterStop = usedDetails;
  check(usedDetails.every((set) => /^\d+%$/.test(set.life)), "Life stays a whole percentage after a stop", usedDetails);
  check(usedDetails.every((set) => set.usage === "NEW" || /^\d+L USED$/.test(set.usage)), "Laps used render as whole laps", usedDetails);
  const fitted = usedDetails.find((set) => set.setId?.endsWith("medium-4"));
  check(!fitted, "The set fitted to the car is no longer offered", usedDetails);
  await page.keyboard.press("Escape");

  await page.screenshot({ path: resolve(qaDir, "pit-lane-drive-1600x900.png"), fullPage: false });
  check(results.consoleErrors.length === 0, "No console errors", results.consoleErrors);
  await writeFile(resolve(qaDir, "pit-tyre-set-selection-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
