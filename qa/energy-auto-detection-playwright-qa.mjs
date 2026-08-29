import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.QA_URL ?? "http://127.0.0.1:3000";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function enterRace(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
  for (const session of ["FP1", "FP2", "FP3", "Q1", "Q2", "Q3"]) {
    const run = page.getByRole("button", { name: `RUN ${session}` });
    await run.waitFor({ state: "visible", timeout: 10_000 });
    await run.click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "ACKNOWLEDGE REPORT" }).click();
  }
  await page.getByRole("button", { name: "START RACE" }).click();
  await page.getByRole("button", { name: "Pause race" }).waitFor({ state: "visible", timeout: 12_000 });
  await page.waitForTimeout(900);
}

async function layoutEvidence(page, name) {
  return page.evaluate((viewportName) => {
    const root = document.documentElement;
    const map = document.querySelector(".track-map");
    const cards = [...document.querySelectorAll(".car-card")].slice(0, 2);
    const cardHeaders = cards.map((card) => {
      const top = card.querySelector(".car-card__top");
      const position = top?.querySelector(".car-position");
      const number = top?.querySelector(".car-number");
      const name = top?.querySelector(".car-card__identity strong");
      return {
        children: top ? [...top.children].map((element) => element.textContent?.trim()) : [],
        positionFont: position ? Number.parseFloat(getComputedStyle(position).fontSize) : 0,
        numberFont: number ? Number.parseFloat(getComputedStyle(number).fontSize) : 0,
        name: name?.textContent?.trim() ?? "",
        nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : true,
      };
    });
    const trackRect = map?.getBoundingClientRect();
    return {
      viewportName,
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: root.scrollWidth, height: root.scrollHeight },
      map: trackRect ? { left: trackRect.left, top: trackRect.top, right: trackRect.right, bottom: trackRect.bottom, width: trackRect.width, height: trackRect.height } : null,
      detection: map?.getAttribute("data-overtake-detection-distance"),
      activation: map?.getAttribute("data-overtake-activation-distance"),
      canvasLabel: map?.querySelector("canvas")?.getAttribute("aria-label"),
      legend: document.querySelector(".track-map__legend")?.textContent ?? "",
      legacyEnergyTitle: document.body.textContent?.includes("2026 ENERGY") ?? false,
      cardHeaders,
    };
  }, name);
}

async function verifyLayout(page, name) {
  const evidence = await layoutEvidence(page, name);
  assert(evidence.document.width <= evidence.viewport.width + 1, `${name}: horizontal overflow`);
  assert(evidence.document.height <= evidence.viewport.height + 1, `${name}: vertical overflow`);
  assert(evidence.map && evidence.map.left >= -1 && evidence.map.right <= evidence.viewport.width + 1, `${name}: map clipped horizontally`);
  assert(evidence.map && evidence.map.top >= -1 && evidence.map.bottom <= evidence.viewport.height + 1, `${name}: map clipped vertically`);
  assert(Number(evidence.detection) > 0 && Number(evidence.activation) > Number(evidence.detection), `${name}: invalid Overtake line metadata`);
  assert(/detection line after Turn 17/i.test(evidence.canvasLabel ?? ""), `${name}: missing accessible detection line description`);
  assert(evidence.legend.includes("OVERTAKE DET."), `${name}: missing detection legend`);
  assert(!evidence.legacyEnergyTitle, `${name}: legacy 2026 ENERGY label remains`);
  assert(evidence.cardHeaders.length === 2, `${name}: expected two player car headers`);
  for (const header of evidence.cardHeaders) {
    assert(/^P\d+$/.test(header.children[0] ?? ""), `${name}: position is not first`);
    assert(/^#\d+$/.test(header.children.at(-1) ?? ""), `${name}: number is not last`);
    assert(header.positionFont > header.numberFont, `${name}: position is not visually dominant`);
    assert(header.name.length > 3 && !header.nameClipped, `${name}: driver name clipped`);
  }
  return evidence;
}

async function longRunEnergy(page) {
  await page.getByRole("button", { name: "Set energy BALANCED", exact: true }).click();
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  const samples = [];
  const flows = new Set();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const sample = await page.evaluate(() => {
      const telemetry = document.querySelector(".car-card.is-selected .energy-telemetry");
      const label = telemetry?.getAttribute("aria-label") ?? "";
      const soc = Number(label.match(/(\d+) percent state of charge/i)?.[1] ?? Number.NaN);
      return {
        flow: telemetry?.getAttribute("data-flow") ?? "missing",
        soc,
        modePressed: document.querySelector('[aria-label="Set energy BALANCED"]')?.getAttribute("aria-pressed"),
      };
    });
    samples.push(sample);
    flows.add(sample.flow);
    await page.waitForTimeout(250);
  }
  assert(flows.has("deploy"), `long-run: automatic straight deployment not observed (${[...flows].join(", ")})`);
  assert(flows.has("harvest"), `long-run: automatic braking recovery not observed (${[...flows].join(", ")})`);
  assert(samples.every((sample) => sample.modePressed === "true"), "long-run: player tendency was overwritten");
  const socValues = samples.map((sample) => sample.soc).filter(Number.isFinite);
  assert(new Set(socValues).size >= 3, "long-run: SOC appears frozen");
  const lateFlows = new Set(samples.slice(-24).map((sample) => sample.flow));
  assert(lateFlows.has("deploy") && lateFlows.has("harvest"), `long-run: automatic flow stopped late in the run (${[...lateFlows].join(", ")})`);
  assert(Math.min(...socValues.slice(-24)) > 12, "long-run: Balanced mode reached the deployment cutoff");
  return { flows: [...flows], socMinimum: Math.min(...socValues), socMaximum: Math.max(...socValues), samples: samples.length };
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, viewport, runLong] of [["1600x900", { width: 1600, height: 900 }, true], ["1280x720", { width: 1280, height: 720 }, false]]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("React DevTools")) errors.push(`console: ${message.text()}`); });
    page.on("response", (response) => { if (response.status() >= 400) errors.push(`http: ${response.status()} ${response.url()}`); });
    await enterRace(page);
    const layout = await verifyLayout(page, name);
    const energy = runLong ? await longRunEnergy(page) : null;
    await page.screenshot({ path: resolve(`qa/energy-auto-detection-${name}.jpg`), type: "jpeg", quality: 90, fullPage: true });
    assert(errors.length === 0, `${name}: ${errors.join(" | ")}`);
    results.push({ name, layout, energy, errors });
    await context.close();
  }
  await writeFile(resolve("qa/energy-auto-detection-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, runs: results.map(({ name, energy }) => ({ name, energy })) }, null, 2));
} finally {
  await browser.close();
}
