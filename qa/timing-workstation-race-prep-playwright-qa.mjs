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

async function enterLiveQ1(page) {
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

async function advanceToRacePreparation(page) {
  for (const session of ["Q1", "Q2", "Q3"]) {
    await page.getByRole("button", { name: `SKIP ${session}` }).click();
    if (session !== "Q3") await clickReportAction(page, new RegExp(`START Q${Number(session[1]) + 1}`, "i"));
  }
  await clickReportAction(page, /ACKNOWLEDGE REPORT/i);
  await page.getByText("RACE PREPARATION", { exact: true }).first().waitFor();
}

async function fitMetrics(page, label, rootSelector = "main") {
  const metrics = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const rect = root?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      root: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
    };
  }, rootSelector);
  check(metrics.scrollWidth <= metrics.innerWidth, `${label} has no document-level horizontal overflow`, metrics);
  check(metrics.scrollHeight <= metrics.innerHeight, `${label} has no document-level vertical overflow`, metrics);
  check(Boolean(metrics.root) && metrics.root.left >= 0 && metrics.root.top >= 0 && metrics.root.right <= metrics.innerWidth && metrics.root.bottom <= metrics.innerHeight, `${label} root stays inside the viewport`, metrics);
  results.viewports[label] = metrics;
}

async function checkQualifying(page, label, screenshot) {
  const shell = page.locator("main[data-qualifying-session='Q1']");
  check(await shell.locator(".track-map").count() === 0, `${label} qualifying has no live circuit canvas`);
  const wall = page.getByRole("region", { name: "Live qualifying sectors" });
  check(await wall.isVisible(), `${label} three-sector timing wall is visible`);
  const sectorRows = wall.locator("[data-sector-driver]");
  const sectorCells = wall.locator("[data-sector-cell='true']");
  check(await sectorRows.count() === 22, `${label} sector wall includes all 22 Q1 drivers`);
  check(await sectorCells.count() === 22 * 3, `${label} renders S1, S2 and S3 for all 22 Q1 drivers`);
  const sectorIndices = await sectorRows.evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll("[data-sector-cell]"), (cell) => cell.getAttribute("data-sector-index"))));
  check(sectorIndices.every((indices) => indices.join(",") === "1,2,3"), `${label} every driver has exactly the three standard sectors`, sectorIndices);
  check(await wall.locator("[aria-label^='Mini sector'], [data-mini-sector]").count() === 0 && !((await wall.textContent()) ?? "").includes("MINI SECTOR"), `${label} removes the mini-sector UI`);
  const wallDescendants = await wall.locator("*").count();
  check(wallDescendants < 550, `${label} keeps the live timing DOM lightweight`, wallDescendants);
  check(await page.getByText("TRAFFIC RESPONSE", { exact: true }).count() === 0, `${label} removes Traffic Response`);
  const tower = page.getByRole("complementary", { name: "Qualifying leaderboard" });
  check(await tower.isVisible(), `${label} qualifying leaderboard is visible`);
  const towerHeader = tower.getByLabel("Qualifying leaderboard columns");
  const headerFacts = await towerHeader.evaluate((header) => ({
    labels: Array.from(header.children).slice(1).map((cell) => cell.textContent?.trim().toUpperCase()),
    fontSize: parseFloat(getComputedStyle(header).fontSize),
    color: getComputedStyle(header).color,
    unclipped: Array.from(header.children).every((cell) => cell.scrollWidth <= cell.clientWidth),
  }));
  check(headerFacts.labels.join(",") === "DRIVER,TYRE,GAP,BEST", `${label} uses the compact Driver / Tyre / Gap / Best header`, headerFacts);
  check(headerFacts.fontSize >= 9 && headerFacts.fontSize <= 10 && headerFacts.color !== "rgb(255, 255, 255)" && headerFacts.unclipped, `${label} keeps every leaderboard header small, grey and fully visible`, headerFacts);
  const lifeValues = tower.locator("strong").filter({ hasText: /^\d+%$/ });
  check(await lifeValues.count() === 0 && !((await tower.textContent()) ?? "").includes("LIFE"), `${label} removes qualifying tyre life from the timing tower`);
  const timingSpacing = await tower.locator("[aria-label*='qualifying position']").first().evaluate((row) => {
    const cells = Array.from(row.children);
    const gap = cells[3]?.getBoundingClientRect();
    const best = cells[4]?.getBoundingClientRect();
    return { separation: gap && best ? best.left - gap.right : 99 };
  });
  check(timingSpacing.separation <= 5, `${label} keeps Gap and Best records close together`, timingSpacing);
  check(await page.getByRole("button", { name: "Release Now" }).count() === 1, `${label} keeps Driver Release controls`);
  const releasePanel = page.getByText("DRIVER RELEASE", { exact: true }).locator("xpath=ancestor::section[1]");
  const releaseText = (await releasePanel.textContent()) ?? "";
  check(!/LOW TRAFFIC|FLYING|FINISH/i.test(releaseText), `${label} removes forecast clutter from Driver Release`, releaseText);
  const driverButtons = page.getByRole("button", { name: /^Control .*car/i });
  const driverCenters = await driverButtons.evaluateAll((buttons) => buttons.map((button) => {
    const content = button.querySelector("strong")?.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return content ? Math.abs((content.left + content.width / 2) - (box.left + box.width / 2)) : 99;
  }));
  check(driverCenters.length === 2 && driverCenters.every((offset) => offset <= 2), `${label} centers both driver selectors`, driverCenters);
  check(await page.getByRole("button", { name: /Set out lap pace/i }).count() === 3, `${label} keeps all Out Lap Pace modes`);
  check(await page.getByRole("button", { name: /Set flying lap attack/i }).count() === 4, `${label} keeps all Flying Lap Attack modes`);
  const controlNodes = page.locator("button[data-control-node='true']");
  check(await controlNodes.count() === 16, `${label} renders all 16 qualifying command nodes`);
  const commandIcons = await controlNodes.evaluateAll((buttons) => buttons.map((button) => {
    const icon = button.querySelector("span > svg");
    const ring = icon?.parentElement;
    const iconBox = icon?.getBoundingClientRect();
    const ringBox = ring?.getBoundingClientRect();
    const style = icon ? getComputedStyle(icon) : null;
    return {
      iconWidth: iconBox?.width ?? 0,
      iconHeight: iconBox?.height ?? 0,
      visibility: style?.visibility,
      opacity: style?.opacity,
      centered: Boolean(iconBox && ringBox) && Math.abs((iconBox.left + iconBox.width / 2) - (ringBox.left + ringBox.width / 2)) <= 2 && Math.abs((iconBox.top + iconBox.height / 2) - (ringBox.top + ringBox.height / 2)) <= 2,
    };
  }));
  check(commandIcons.every((icon) => icon.iconWidth >= 16 && icon.iconHeight >= 16 && icon.visibility === "visible" && Number(icon.opacity) > 0 && icon.centered), `${label} centers a visible icon inside every command node`, commandIcons);
  const tyreRails = page.locator("[aria-label='Live tyre temperatures']");
  check(await tyreRails.count() === 2, `${label} shows both player tyre-temperature rails`);
  const alignment = await tyreRails.evaluateAll((rails) => rails.map((rail) => ({
    justifyContent: getComputedStyle(rail).justifyContent,
    temperatures: Array.from(rail.querySelectorAll("[data-tyre-position]")).map((tyre) => {
      const value = tyre.querySelector("strong")?.getBoundingClientRect();
      const box = tyre.getBoundingClientRect();
      return { offset: value ? Math.abs((value.left + value.width / 2) - (box.left + box.width / 2)) : 99, fontSize: value ? parseFloat(getComputedStyle(tyre.querySelector("strong")).fontSize) : 0 };
    }),
  })));
  check(alignment.every((item) => item.justifyContent === "center" && item.temperatures.length === 4 && item.temperatures.every((temperature) => temperature.offset <= 2 && temperature.fontSize >= 15)), `${label} centers four readable tyre-temperature gauges for each player`, alignment);
  const startButton = page.getByRole("button", { name: "START Q1" });
  if (await startButton.count()) await startButton.click();
  await page.getByRole("button", { name: "Release Now" }).click();
  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  const frameSample = await page.evaluate(() => new Promise((resolveFrameSample) => {
    const startedAt = performance.now();
    let frames = 0;
    const sample = (now) => {
      frames += 1;
      const elapsed = now - startedAt;
      if (elapsed >= 1_200) {
        resolveFrameSample({ frames, elapsed, fps: frames * 1_000 / elapsed, sectorCells: document.querySelectorAll("[data-sector-cell='true']").length });
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  check(frameSample.sectorCells === 66 && frameSample.fps >= 24, `${label} remains responsive at 16x with the three-sector wall`, frameSample);
  const playerOutLapRow = wall.locator("[data-sector-driver='ferrari-1']");
  await playerOutLapRow.locator("[data-sector-index='1'] strong").filter({ hasNotText: "—.---" }).waitFor({ timeout: 12_000 });
  const outLapSector = await playerOutLapRow.evaluate((row) => ({ phase: row.getAttribute("data-phase"), firstSector: row.querySelector("[data-sector-index='1'] strong")?.textContent, tone: row.querySelector("[data-sector-index='1']")?.getAttribute("data-tone") }));
  check(outLapSector.phase === "OUT_LAP" && outLapSector.firstSector !== "—.---" && outLapSector.tone === "NEUTRAL", `${label} shows a neutral measured S1 during the slower out lap`, outLapSector);
  await fitMetrics(page, label, "main[data-qualifying-session='Q1']");
  await page.screenshot({ path: resolve(screenshot), type: "png" });
}

async function checkRacePreparation(page, label, screenshot) {
  const gridSection = page.getByText("STARTING GRID", { exact: true }).locator("xpath=ancestor::section[1]");
  check(await gridSection.locator("article").count() === 22, `${label} displays the full 22-car starting grid`);
  check(await gridSection.locator(".f1-tyre-badge").count() === 22, `${label} shows a starting tyre for every grid car`);
  const compounds = await gridSection.locator(".f1-tyre-badge").evaluateAll((badges) => badges.map((badge) => badge.textContent?.trim()));
  check(new Set(compounds).size >= 2, `${label} AI starting plan uses strategic compound variety`, compounds);
  const choiceButtons = page.getByRole("button", { name: /start on/i });
  check(await choiceButtons.count() === 10, `${label} exposes five graphical tyre choices for both player cars`);
  const availableHard = choiceButtons.filter({ hasText: /HARD/ }).first();
  if (await availableHard.isEnabled()) {
    await availableHard.click();
    check(await availableHard.getAttribute("aria-pressed") === "true", `${label} player tyre selection updates immediately`);
  }
  check(await page.getByText("STINT WINDOW", { exact: true }).count() === 2, `${label} shows a stint window for both player cars`);
  await fitMetrics(page, label, "main");
  await page.screenshot({ path: resolve(screenshot), type: "png" });
}

async function checkRace(page, label, screenshot) {
  await page.getByRole("button", { name: "START RACE" }).click();
  await page.waitForTimeout(5_000);
  check(await page.getByText("UI SCALE", { exact: true }).count() === 0, `${label} removes UI Scale`);
  const conditions = page.locator(".conditions-cluster");
  check(await conditions.isVisible(), `${label} track temperature and weather instruments are visible`);
  check(await conditions.locator(".condition-glyph").count() === 2, `${label} conditions use two icon-led instruments`);
  const trackTemperatureFit = await conditions.locator(".condition-reading--temperature").evaluate((reading) => {
    const labelNode = reading.querySelector("small");
    const cluster = reading.closest(".conditions-cluster");
    if (!labelNode || !cluster) return null;
    const range = document.createRange();
    range.selectNodeContents(labelNode);
    const text = range.getBoundingClientRect();
    const readingBox = reading.getBoundingClientRect();
    const clusterBox = cluster.getBoundingClientRect();
    return {
      text: labelNode.textContent?.trim(),
      fontSize: parseFloat(getComputedStyle(labelNode).fontSize),
      selfFits: labelNode.scrollWidth <= labelNode.clientWidth + 1 && labelNode.scrollHeight <= labelNode.clientHeight + 1,
      insideReading: text.left >= readingBox.left - 1 && text.right <= readingBox.right + 1 && text.top >= readingBox.top - 1 && text.bottom <= readingBox.bottom + 1,
      insideCluster: text.left >= clusterBox.left - 1 && text.right <= clusterBox.right + 1 && text.top >= clusterBox.top - 1 && text.bottom <= clusterBox.bottom + 1,
    };
  });
  check(Boolean(trackTemperatureFit) && trackTemperatureFit.text === "TRACK TEMP" && trackTemperatureFit.fontSize >= 9 && trackTemperatureFit.selfFits && trackTemperatureFit.insideReading && trackTemperatureFit.insideCluster, `${label} shows the full TRACK TEMP label without clipping`, trackTemperatureFit);
  const tower = page.locator(".timing-panel");
  const towerBox = await tower.boundingBox();
  check(Boolean(towerBox) && towerBox.width <= 290, `${label} race leaderboard is compact`, towerBox);
  const driverNames = await tower.locator(".driver-cell strong").allTextContents();
  check(driverNames.every((name) => /^[A-Z]{3}$/.test(name.trim())), `${label} race leaderboard uses three-letter driver codes`, driverNames);
  const paceLabels = page.locator(".visual-control--pace button strong");
  const paceFit = await paceLabels.evaluateAll((labels) => labels.map((label) => ({ text: label.textContent, scrollWidth: label.scrollWidth, clientWidth: label.clientWidth })));
  check(paceFit.every((item) => item.scrollWidth <= item.clientWidth + 1), `${label} pace labels are not clipped`, paceFit);
  check(await page.locator(".pit-tyre-control .tyre-select-button").count() === 5, `${label} Next Tyre keeps all five compounds visible`);
  await page.getByRole("button", { name: "Set pace ATTACK" }).click();
  await page.waitForTimeout(250);
  const radio = page.locator(".track-radio");
  check(await radio.locator("[data-source='DRIVER']").count() >= 1, `${label} Team Radio identifies driver speech`);
  check(await radio.locator("[data-source='ENGINEER']").count() >= 1, `${label} Team Radio identifies engineer speech`);
  const railContainment = await page.evaluate(() => {
    const rail = document.querySelector(".track-intelligence-rail");
    const radio = rail?.querySelector(".track-radio");
    const messages = rail?.querySelector(".track-radio__messages");
    const weather = rail?.querySelector(".track-weather");
    const paragraphs = Array.from(rail?.querySelectorAll(".track-radio__message p") ?? []);
    if (!rail || !radio || !messages || !weather || !paragraphs.length) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const beforeWeather = box(weather);
    const original = paragraphs.map((paragraph) => paragraph.textContent);
    const stressMessage = "We are losing rear stability through the high-speed change of direction and the rain is increasing at the far side of the circuit. Please confirm surface grip, brake temperature and the crossover window before the next stop. ";
    paragraphs.forEach((paragraph, index) => { paragraph.textContent = stressMessage.repeat(index + 3); });
    const railBox = box(rail);
    const radioBox = box(radio);
    const messagesBox = box(messages);
    const weatherBox = box(weather);
    const overflowY = getComputedStyle(messages).overflowY;
    messages.scrollTop = messages.scrollHeight;
    const endReachable = messages.scrollHeight <= messages.clientHeight + 1 || Math.abs(messages.scrollTop + messages.clientHeight - messages.scrollHeight) <= 2;
    const weatherMetrics = { scrollWidth: weather.scrollWidth, clientWidth: weather.clientWidth, scrollHeight: weather.scrollHeight, clientHeight: weather.clientHeight };
    const weatherFits = weather.scrollWidth <= weather.clientWidth + 1 && weather.scrollHeight <= weather.clientHeight + 1;
    paragraphs.forEach((paragraph, index) => { paragraph.textContent = original[index] ?? ""; });
    messages.scrollTop = 0;
    return { beforeWeather, railBox, radioBox, messagesBox, weatherBox, overflowY, endReachable, weatherFits, weatherMetrics };
  });
  check(Boolean(railContainment)
    && Math.abs(railContainment.beforeWeather.top - railContainment.weatherBox.top) <= 1
    && Math.abs(railContainment.beforeWeather.height - railContainment.weatherBox.height) <= 1
    && railContainment.radioBox.bottom <= railContainment.weatherBox.top + 1
    && railContainment.weatherBox.bottom <= railContainment.railBox.bottom + 1
    && railContainment.radioBox.left >= railContainment.railBox.left - 1
    && railContainment.radioBox.right <= railContainment.railBox.right + 1
    && (railContainment.overflowY === "auto" || railContainment.overflowY === "scroll")
    && railContainment.endReachable
    && railContainment.weatherFits,
  `${label} keeps long radio messages inside a scrollable region above Local Surface`, railContainment);
  await fitMetrics(page, label, "main.pitwall-shell");
  await page.screenshot({ path: resolve(screenshot), type: "png" });
}

const browser = await chromium.launch({ headless: true });

try {
  const large = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  large.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(`1920: ${message.text()}`); });
  await enterLiveQ1(large);
  await checkQualifying(large, "1920x1080 qualifying", "qa/timing-workstation-qualifying-1920x1080.png");

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(`1440: ${message.text()}`); });
  await enterLiveQ1(desktop);
  await checkQualifying(desktop, "1440x900 qualifying", "qa/timing-workstation-qualifying-1440x900.png");
  await advanceToRacePreparation(desktop);
  await checkRacePreparation(desktop, "1440x900 race preparation", "qa/timing-workstation-race-prep-1440x900.png");
  await checkRace(desktop, "1440x900 race", "qa/timing-workstation-race-1440x900.png");

  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  compact.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(`1280: ${message.text()}`); });
  await enterLiveQ1(compact);
  await checkQualifying(compact, "1280x720 qualifying", "qa/timing-workstation-qualifying-1280x720.png");
  await advanceToRacePreparation(compact);
  await checkRacePreparation(compact, "1280x720 race preparation", "qa/timing-workstation-race-prep-1280x720.png");
  await checkRace(compact, "1280x720 race", "qa/timing-workstation-race-1280x720.png");
  check(results.consoleErrors.length === 0, "browser console has no errors", results.consoleErrors);
} finally {
  await browser.close();
}

await writeFile(resolve("qa/timing-workstation-race-prep-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
