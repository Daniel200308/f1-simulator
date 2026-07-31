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

async function assertViewportFit(page, label) {
  const metrics = await page.evaluate(() => {
    const box = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const root = document.querySelector("main[data-qualifying-session='Q1']");
    const tower = root?.querySelector("[aria-label='Qualifying leaderboard']");
    const map = root?.querySelector("[data-traffic-overview='true']");
    const controls = root?.querySelector("[aria-label='Qualifying driver control']");
    const controlSections = Array.from(controls?.querySelectorAll("section[class*='controlSection']") ?? [], box);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      root: box(root),
      tower: box(tower),
      map: box(map),
      controls: box(controls),
      controlSections,
    };
  });
  check(metrics.scrollWidth <= metrics.innerWidth && metrics.scrollHeight <= metrics.innerHeight, `${label} has no document overflow`, metrics);
  check(metrics.root && metrics.root.left >= 0 && metrics.root.top >= 0 && metrics.root.right <= metrics.innerWidth && metrics.root.bottom <= metrics.innerHeight, `${label} qualifying shell fits the viewport`, metrics);
  check(metrics.tower && metrics.map && metrics.controls && metrics.tower.right < metrics.map.left && metrics.map.right < metrics.controls.left, `${label} preserves leaderboard, centre circuit and right controls`, metrics);
  check(metrics.map && metrics.map.width > metrics.tower.width && metrics.map.width > metrics.controls.width && metrics.map.height > 500, `${label} keeps the circuit as the dominant visual focus`, metrics);
  check(metrics.controls && metrics.controls.top >= 0 && metrics.controls.bottom <= metrics.innerHeight, `${label} keeps the entire control rail above the fold`, metrics);
  check(metrics.controlSections.length === 6 && metrics.controlSections.every((section) => section.top >= metrics.controls.top && section.bottom <= metrics.controls.bottom), `${label} keeps all six control groups inside the rail`, metrics);
  results.viewports[label] = metrics;
}

async function assertCommandPanelComposition(controls, label) {
  const geometry = await controls.evaluate((rail) => {
    const box = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const sections = [...rail.querySelectorAll("section[class*='controlSection']")].map((section) => ({
      control: section.getAttribute("data-control"),
      ...box(section),
    }));
    const tyreMeters = [...rail.querySelectorAll("[aria-label='Live tyre temperatures'] [role='meter']")].map(box);
    const meterLabels = [...rail.querySelectorAll("[role='meter']")].map((meter) => meter.getAttribute("aria-label"));
    const tyreChoices = [...rail.querySelectorAll("button[data-tyre-choice='true']")]
      .filter((button) => button.offsetParent !== null)
      .map((button) => ({
        life: button.textContent?.trim() ?? "",
        selected: button.getAttribute("aria-pressed") === "true",
        setCount: Number(button.getAttribute("data-set-count") ?? 0),
        setId: button.getAttribute("data-set-id") ?? "",
        setNumber: button.getAttribute("data-set-number") ?? "",
        status: button.getAttribute("data-status") ?? "",
      }));
    const physicalTyreSets = [...rail.querySelectorAll("button[data-tyre-set-choice='true']")].map((button) => ({
      ...box(button),
      life: button.textContent?.trim() ?? "",
      status: button.getAttribute("data-status") ?? "",
    }));
    const controlCore = rail.querySelector("[class*='controlCore']");
    const coreBox = box(controlCore);
    const coreSections = [...(controlCore?.querySelectorAll(":scope > section[class*='controlSection']") ?? [])].map(box).filter(Boolean);
    const coreTopSpace = coreBox && coreSections.length > 0 ? Math.min(...coreSections.map((section) => section.top)) - coreBox.top : null;
    const coreBottomSpace = coreBox && coreSections.length > 0 ? coreBox.bottom - Math.max(...coreSections.map((section) => section.bottom)) : null;
    const coreBalance = coreTopSpace !== null && coreBottomSpace !== null ? Math.abs(coreTopSpace - coreBottomSpace) : null;
    const operationControls = [...(controlCore?.querySelectorAll("[class*='segmentOptions'], [class*='orbOptions']") ?? [])].map((control) => {
      const bounds = box(control);
      const section = box(control.closest("section"));
      const buttonWidths = [...control.querySelectorAll("button")].map((button) => button.getBoundingClientRect().width);
      return bounds && section ? { ...bounds, maxButtonWidth: Math.max(...buttonWidths), centreOffset: Math.abs((bounds.left + bounds.right) / 2 - (section.left + section.right) / 2) } : null;
    }).filter(Boolean);
    return {
      controlCore: coreBox,
      coreBalance,
      meterLabels,
      operationControls,
      release: box(rail.querySelector("[aria-label$='Release Now']")),
      sections,
      speedRing: box(rail.querySelector("[class*='speedRing']")),
      physicalTyreSets,
      tyreChoices,
      tyreMeters,
    };
  });
  check(geometry.meterLabels.length === 5
    && geometry.meterLabels.some((name) => name?.startsWith("Live speed"))
    && ["Front Left", "Front Right", "Rear Left", "Rear Right"].every((position) => geometry.meterLabels.some((name) => name?.startsWith(position))),
  `${label} exposes one speed and four labelled tyre meters`, geometry.meterLabels);
  check(geometry.speedRing && Math.abs(geometry.speedRing.width - geometry.speedRing.height) < 1.5, `${label} keeps the speed infographic circular`, geometry.speedRing);
  check(geometry.tyreMeters.length === 4 && geometry.tyreMeters.every((meter) => meter && Math.abs(meter.width - meter.height) < 1.5), `${label} keeps all four tyre-temperature meters circular`, geometry.tyreMeters);
  check(geometry.release && geometry.release.width >= 44 && geometry.release.height >= 44, `${label} keeps the release click target at least 44px`, geometry.release);
  check(geometry.tyreChoices.length === 5, `${label} renders exactly five combined tyre choices`, geometry.tyreChoices);
  check(geometry.physicalTyreSets.length >= 2 && geometry.physicalTyreSets.every((set) => /\d+%/.test(set.life) && /^(NEW|USED)$/.test(set.status)), `${label} exposes selectable physical sets with life and state`, geometry.physicalTyreSets);
  // Compound buttons name their compound; remaining life is asserted on the
  // physical-set row above, which is where a set is actually selected.
  check(geometry.tyreChoices.every((choice) => choice.setCount === 0 || (/[A-Z]{3,}/.test(choice.life)
    && !/\d+%/.test(choice.life)
    && choice.setId.length > 0
    && /^\d+$/.test(choice.setNumber)
    && /^(NEW|USED)$/.test(choice.status))),
  `${label} keeps the compound name and exact set metadata on every available tyre choice`, geometry.tyreChoices);
  const tyres = geometry.sections.find((section) => section.control === "tyres");
  const otherSections = geometry.sections.filter((section) => section.control !== "tyres");
  check(tyres
    && otherSections.length === 5
    && tyres.bottom >= Math.max(...otherSections.map((section) => section.bottom)) - 1
    && tyres.height <= 140,
  `${label} keeps the compound and physical-set selector at the bottom of the rail`, geometry.sections);
  check(geometry.controlCore && geometry.coreBalance !== null && geometry.coreBalance <= 5,
    `${label} vertically centres the operation controls`, { core: geometry.controlCore, balance: geometry.coreBalance });
  check(geometry.operationControls.length === 5
    && geometry.operationControls.every((control) => control.centreOffset <= 3 && control.maxButtonWidth < geometry.controlCore.width * .46),
  `${label} centres compact operation buttons without stretching them across the rail`, geometry.operationControls);
}

async function assertControlLabelsFit(controls, label) {
  const clipped = await controls.locator("button span").evaluateAll((nodes) => nodes
    .filter((node) => node.offsetParent !== null)
    .filter((node) => node.scrollWidth > node.clientWidth + 1)
    .map((node) => ({ text: node.textContent?.trim(), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })));
  check(clipped.length === 0, `${label} keeps visible control labels unclipped`, clipped);
}

async function checkQualifyingWorkspace(page, label, screenshotPrefix) {
  const panel = page.locator("[data-traffic-overview='true']");
  const canvas = panel.locator("canvas[data-renderer='SINGLE_CANVAS']");
  const tower = page.getByRole("complementary", { name: "Qualifying leaderboard" });
  const controls = page.getByLabel("Qualifying driver control");
  const tabs = page.getByRole("navigation", { name: "Player driver selection" });

  check(await panel.isVisible(), `${label} centre Circuit Detail is visible`);
  check(await canvas.count() === 1 && await panel.locator("svg[class*='circuitBackdrop']").count() === 1, `${label} separates one animated canvas from the static circuit`);
  check(await canvas.getAttribute("data-label-anchoring") === "PERSISTENT_OFFSETS", `${label} uses persistent driver-label anchors`);
  check(await canvas.getAttribute("data-marker-language") === "PHASE_CODED", `${label} uses phase-coded map markers`);
  check(await panel.getByLabel("Live circuit marker legend").getByText(/Flying Lap/i).count() === 1, `${label} shows the compact map legend`);
  // Cool-down is no longer a separate phase: a recovery lap is an in lap.
  check(await panel.getByLabel("Live circuit marker legend").locator("span").count() === 7, `${label} legend covers flying, out, in, pit-entry, yielding, manual-abort and player states`);
  check(await tower.locator("[data-sector-cell='true']").count() === 66, `${label} keeps S1 S2 S3 for all 22 drivers in the leaderboard`);

  check(await tabs.getByRole("button").count() === 2, `${label} exposes two compact player-driver tabs`);
  check(await controls.locator("[data-car-id]").count() === 0, `${label} does not duplicate large driver control rows`);
  for (const group of ["PIT RELEASE", "OUT LAP PACE", "FLYING ATTACK", "FUEL PLAN", "LAP ACTION", "TYRE SELECTION"]) {
    check(await controls.getByText(group, { exact: true }).count() === 1, `${label} shows one compact ${group} control group`);
  }
  check(await controls.getByText("ACTIVE SET", { exact: true }).count() === 0, `${label} removes the duplicate Active Set card`);
  check(await controls.getByText("BATTERY STRATEGY", { exact: true }).count() === 0
    && await controls.getByRole("button", { name: /set energy mode/i }).count() === 0,
  `${label} removes Battery Strategy and manual energy controls`);
  check(await controls.getByText("NEXT ACTION", { exact: true }).count() === 0, `${label} removes the Next Action strip`);
  check(await controls.getByRole("group", { name: /pit release controls/i }).getByRole("button").count() === 1, `${label} exposes one release action`);
  await assertControlLabelsFit(controls, label);
  await assertCommandPanelComposition(controls, label);

  const initialCarId = await controls.getAttribute("data-car-id");
  const initialTyreChoices = controls.locator("button[data-tyre-choice='true']");
  check(await initialTyreChoices.count() === 5, `${label} exposes exactly five merged tyre buttons for the first player car`);
  const initialTyreSet = controls.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await initialTyreSet.click();
  const initialSetId = await initialTyreSet.getAttribute("data-set-id");
  await initialTyreSet.click();
  const cycledSetId = await initialTyreSet.getAttribute("data-set-id");
  check(Boolean(initialSetId && cycledSetId && initialSetId !== cycledSetId), `${label} cycles the first driver's Soft button through exact physical sets`, { initialSetId, cycledSetId });
  check(await controls.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 1, `${label} keeps exactly one physical tyre set selected for the first player car`);
  const attack = controls.getByRole("button", { name: /set flying lap attack Attack/i });
  await attack.click();
  check(await attack.getAttribute("aria-pressed") === "true", `${label} flying attack selector updates the active driver`);
  const fuel = controls.getByRole("button", { name: /set fuel plan 2 Flying Laps/i });
  await fuel.click();
  check(await fuel.getAttribute("aria-pressed") === "true", `${label} fuel selector updates before release`);
  await controls.getByRole("button", { name: /Release Now/i }).click();

  const otherTab = tabs.getByRole("button", { pressed: false });
  await otherTab.click();
  const switchedCarId = await controls.getAttribute("data-car-id");
  check(Boolean(initialCarId && switchedCarId && initialCarId !== switchedCarId), `${label} switches LEC and HAM through compact tabs`, { initialCarId, switchedCarId });
  check(await controls.locator("button[data-tyre-choice='true']").count() === 5, `${label} exposes exactly five merged tyre buttons after switching drivers`);
  const switchedTyreSet = controls.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await switchedTyreSet.click();
  check(await switchedTyreSet.getAttribute("aria-pressed") === "true"
    && Boolean(await switchedTyreSet.getAttribute("data-set-id"))
    && await controls.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 1,
  `${label} selects one exact physical tyre set for the second player car`);
  await controls.getByRole("button", { name: /Release Now/i }).click();

  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.waitForTimeout(8_200);
  const active = Number(await canvas.getAttribute("data-active-cars") ?? 0);
  const labelled = Number(await canvas.getAttribute("data-labelled-cars") ?? 0);
  const flying = Number(await canvas.getAttribute("data-flying-cars") ?? 0);
  check(active >= 2 && active <= 14, `${label} spreads the early qualifying field instead of releasing one continuous train`, { active });
  check(labelled === active, `${label} labels every active car with stable canvas labels`, { active, labelled });
  check(flying >= 1, `${label} reaches a visible pulsing flying-lap state`, { flying });

  await page.getByRole("button", { name: "Pause qualifying" }).click();
  await page.waitForTimeout(220);
  const firstFrame = await canvas.evaluate((element) => element.toDataURL());
  await page.waitForTimeout(220);
  const secondFrame = await canvas.evaluate((element) => element.toDataURL());
  check(firstFrame === secondFrame, `${label} stops marker and label animation while paused`);
  await assertViewportFit(page, label);
  await page.screenshot({ path: resolve(`${screenshotPrefix}.png`), type: "png" });
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
    await checkQualifyingWorkspace(page, label, `qa/qualifying-right-rail-${label}`);
    await context.close();
  }
  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-traffic-canvas-playwright-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
