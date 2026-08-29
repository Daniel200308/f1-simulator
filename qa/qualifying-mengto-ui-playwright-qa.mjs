import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const results = { passed: [], viewports: {}, consoleErrors: [] };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function acknowledge(page, label) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: label }).click();
}

async function enterQ1(page) {
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByRole("option", { name: /Ferrari/i }).click();
  await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
  for (const session of ["FP1", "FP2"]) {
    await page.getByRole("button", { name: `RUN ${session}` }).click();
    await acknowledge(page, "ACKNOWLEDGE REPORT");
  }
  await page.getByRole("button", { name: "RUN FP3" }).click();
  await acknowledge(page, "START Q1");
  await page.locator("main[data-qualifying-session='Q1']").waitFor();
}

async function layoutMetrics(page, label) {
  const metrics = await page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const clippingSelectors = [
      "[aria-label='Qualifying leaderboard columns'] span",
      "[aria-label='Qualifying driver control'] [class*='driverIdentity'] strong",
      "[aria-label='Qualifying driver control'] [class*='driverIdentity'] small",
      "[aria-label='Qualifying driver control'] button span",
      "[aria-label='Qualifying driver control'] button b",
      "[aria-label='Qualifying driver control'] button strong",
      "[aria-label='Qualifying driver control'] button small",
      "[aria-label='Qualifying driver control'] section > header span",
      "[aria-label='Qualifying driver control'] section > header b",
      "[aria-label='Qualifying driver control'] [role='meter'] b",
      "[aria-label='Qualifying driver control'] [role='meter'] strong",
      "[aria-label='Qualifying driver control'] [role='meter'] small",
      "[aria-label='Qualifying driver control'] [role='meter'] em",
      "[data-traffic-overview='true'] strong",
      "[data-traffic-overview='true'] em",
    ];
    const clipped = clippingSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && element.clientWidth > 0 && element.clientHeight > 0
          && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
      })
      .map((element) => ({ selector, text: element.textContent?.trim(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight })));
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      tower: bounds("[aria-label='Qualifying leaderboard']"),
      map: bounds("[data-traffic-overview='true']"),
      rail: bounds("[aria-label='Qualifying driver control']"),
      clipped,
    };
  });
  check(metrics.scrollWidth <= metrics.width && metrics.scrollHeight <= metrics.height, `${label} has no document overflow`, metrics);
  check([metrics.tower, metrics.map, metrics.rail].every((region) => region && region.left >= 0 && region.top >= 0 && region.right <= metrics.width && region.bottom <= metrics.height), `${label} keeps leaderboard, circuit and command rail in view`, metrics);
  check(metrics.clipped.length === 0, `${label} has no clipped priority labels`, metrics.clipped);
  results.viewports[label] = metrics;
}

async function componentGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const box = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const rail = document.querySelector("[aria-label='Qualifying driver control']");
    const selectedTyreSetId = rail?.getAttribute("data-selected-tyre-set") ?? "";
    const tyreCards = [...(rail?.querySelectorAll("[aria-label='Live tyre temperatures'] [data-tyre-position]") ?? [])]
      .map((element) => element.getBoundingClientRect())
      .map((rect) => ({ width: rect.width, height: rect.height }));
    const meters = [...(rail?.querySelectorAll("[role='meter']") ?? [])].map((meter) => meter.getAttribute("aria-label"));
    const speedRing = box(rail?.querySelector("[class*='speedRing']"));
    const releaseTarget = box(rail?.querySelector("[aria-label$='Release Now']"));
    const tyreBadges = [...(rail?.querySelectorAll("[aria-label$='tyre']") ?? [])]
      .filter((element) => element.classList.contains("f1-tyre-badge"))
      .map((element) => element.getBoundingClientRect())
      .map((rect) => ({ width: rect.width, height: rect.height }));
    const tyreChoices = [...(rail?.querySelectorAll("button[data-tyre-choice='true']") ?? [])]
      .filter((button) => button.offsetParent !== null)
      .map((button) => ({
        life: button.textContent?.trim() ?? "",
        selected: button.getAttribute("aria-pressed") === "true",
        setCount: Number(button.getAttribute("data-set-count") ?? 0),
        setId: button.getAttribute("data-set-id") ?? "",
        setNumber: button.getAttribute("data-set-number") ?? "",
        status: button.getAttribute("data-status") ?? "",
      }));
    const physicalTyreSets = [...(rail?.querySelectorAll("button[data-tyre-set-choice='true']") ?? [])].map((button) => ({
      life: button.textContent?.trim() ?? "",
      selected: button.getAttribute("aria-pressed") === "true",
      status: button.getAttribute("data-status") ?? "",
      ...box(button),
    }));
    const controlSections = [...(rail?.querySelectorAll("section[class*='controlSection']") ?? [])].map((section) => ({
      control: section.getAttribute("data-control"),
      ...box(section),
    }));
    const controlCore = rail?.querySelector("[class*='controlCore']");
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
    const svg = document.querySelector("[data-traffic-overview='true'] svg[viewBox='0 0 1 1']");
    const sectorRibbonItems = [...document.querySelectorAll("[aria-label='Session best sector times'] > span")].map((item) => ({ ...box(item), fontSize: Number.parseFloat(getComputedStyle(item.querySelector("strong")).fontSize) }));
    const paths = [...(svg?.querySelectorAll("path") ?? [])].filter((path) => /trackLine|sectorPath|pitLine/.test(path.getAttribute("class") ?? ""));
    const sectorClearance = [...(svg?.querySelectorAll("[data-sector-label] rect") ?? [])].map((rect) => {
      const bounds = rect.getBoundingClientRect();
      const padded = { left: bounds.left - 2, right: bounds.right + 2, top: bounds.top - 2, bottom: bounds.bottom + 2 };
      const overlapsTrack = paths.some((path) => {
        const length = path.getTotalLength();
        const matrix = path.getScreenCTM();
        if (!matrix) return false;
        for (let index = 0; index <= 600; index += 1) {
          const point = path.getPointAtLength(length * index / 600);
          const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          if (screenPoint.x >= padded.left && screenPoint.x <= padded.right && screenPoint.y >= padded.top && screenPoint.y <= padded.bottom) return true;
        }
        return false;
      });
      return { sector: rect.parentElement?.getAttribute("data-sector"), overlapsTrack };
    });
    return { controlCore: coreBox, coreBalance, controlSections, meters, operationControls, physicalTyreSets, releaseTarget, sectorRibbonItems, selectedTyreSetId, speedRing, tyreCards, tyreBadges, tyreChoices, sectorClearance };
  });
  check(geometry.tyreCards.length === 4, `${label} shows four tyre-temperature cards`, geometry.tyreCards);
  check(Math.max(...geometry.tyreCards.map((card) => card.width)) - Math.min(...geometry.tyreCards.map((card) => card.width)) < 1.5
    && Math.max(...geometry.tyreCards.map((card) => card.height)) - Math.min(...geometry.tyreCards.map((card) => card.height)) < 1.5,
  `${label} keeps tyre-temperature cards consistently sized`, geometry.tyreCards);
  check(geometry.tyreCards.every((card) => Math.abs(card.width - card.height) < 1.5), `${label} renders every tyre-temperature meter as a circle`, geometry.tyreCards);
  check(geometry.meters.length === 5
    && geometry.meters.some((name) => name?.startsWith("Live speed"))
    && ["Front Left", "Front Right", "Rear Left", "Rear Right"].every((position) => geometry.meters.some((name) => name?.startsWith(position))),
  `${label} exposes one speed and four labelled tyre meters`, geometry.meters);
  check(geometry.speedRing && Math.abs(geometry.speedRing.width - geometry.speedRing.height) < 1.5, `${label} renders speed as a circular infographic`, geometry.speedRing);
  check(geometry.releaseTarget && geometry.releaseTarget.width >= 44 && geometry.releaseTarget.height >= 44, `${label} keeps the single release action at least 44px in both dimensions`, geometry.releaseTarget);
  check(geometry.tyreBadges.length >= 5 && geometry.tyreBadges.every((badge) => Math.abs(badge.width - badge.height) < 0.5), `${label} keeps every tyre badge circular`, geometry.tyreBadges);
  check(geometry.tyreChoices.length === 5, `${label} renders exactly five combined compound and physical-set buttons`, geometry.tyreChoices);
  check(geometry.physicalTyreSets.length >= 2 && geometry.physicalTyreSets.every((set) => /\d+%/.test(set.life) && /^(NEW|USED)$/.test(set.status)), `${label} directly exposes physical sets with life and status`, geometry.physicalTyreSets);
  // Compound buttons carry identity only; remaining life is asserted on the
  // physical-set row below, which is where a set is actually chosen.
  check(geometry.tyreChoices.every((button) => button.setCount === 0 || (/^[A-Z]+$/.test(button.life.replace(/×\d+/g, "").trim())
    && button.setId.length > 0
    && /^\d+$/.test(button.setNumber)
    && /^(NEW|USED)$/.test(button.status))),
  `${label} exposes the compound name and exact physical-set metadata on every available tyre choice`, geometry.tyreChoices);
  const selectedChoices = geometry.tyreChoices.filter((button) => button.selected);
  check(selectedChoices.length === (geometry.selectedTyreSetId ? 1 : 0)
    && (!geometry.selectedTyreSetId || selectedChoices[0]?.setId === geometry.selectedTyreSetId),
  `${label} mirrors the exact selected physical set without inventing one`, { selectedTyreSetId: geometry.selectedTyreSetId, choices: geometry.tyreChoices });
  const tyreSection = geometry.controlSections.find((section) => section.control === "tyres");
  const otherSections = geometry.controlSections.filter((section) => section.control !== "tyres");
  check(tyreSection
    && otherSections.length === 5
    && tyreSection.bottom >= Math.max(...otherSections.map((section) => section.bottom)) - 1
    && tyreSection.height <= 140,
  `${label} keeps compound and physical-set selection at the bottom of the rail`, geometry.controlSections);
  check(geometry.controlCore && geometry.coreBalance !== null && geometry.coreBalance <= 5,
    `${label} vertically centres the operation controls in the available core`, { core: geometry.controlCore, balance: geometry.coreBalance });
  check(geometry.operationControls.length === 5
    && geometry.operationControls.every((control) => control.centreOffset <= 3 && control.maxButtonWidth < geometry.controlCore.width * .46),
  `${label} centres every operation selector without stretching individual buttons across the rail`, geometry.operationControls);
  check(geometry.sectorClearance.length === 3 && geometry.sectorClearance.every((sector) => !sector.overlapsTrack), `${label} keeps all sector labels clear of the circuit`, geometry.sectorClearance);
  check(geometry.sectorRibbonItems.length === 3
    && Math.max(...geometry.sectorRibbonItems.map((item) => item.top)) - Math.min(...geometry.sectorRibbonItems.map((item) => item.top)) < 1
    && geometry.sectorRibbonItems.every((item) => item.fontSize >= 12),
  `${label} lays out the enlarged fastest-sector timing in one horizontal row`, geometry.sectorRibbonItems);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") results.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => results.consoleErrors.push(error.message));

  await enterQ1(page);
  check(await page.getByText("TOP 16 ADVANCE", { exact: true }).count() === 1, "Q1 exposes a labelled top-16 advancement cut");
  check(await page.locator("[data-traffic-overview='true'] svg[viewBox='0 0 1 1']").count() === 1, "qualifying keeps one static circuit SVG");
  const liveCanvas = page.locator("canvas[data-renderer='SINGLE_CANVAS']");
  check(await liveCanvas.count() === 1, "qualifying keeps one live car canvas");
  const markerPresentation = {
    opponentRadius: Number(await liveCanvas.getAttribute("data-ai-marker-radius")),
    playerRadius: Number(await liveCanvas.getAttribute("data-player-marker-radius")),
    opponentLabel: Number(await liveCanvas.getAttribute("data-ai-label-size")),
    playerLabel: Number(await liveCanvas.getAttribute("data-player-label-size")),
    coreOpacity: Number(await liveCanvas.getAttribute("data-marker-core-opacity")),
  };
  check(markerPresentation.opponentRadius >= 5 && markerPresentation.playerRadius >= 8,
    "qualifying uses readable opponent and player marker sizes", markerPresentation);
  check(markerPresentation.opponentLabel >= 12 && markerPresentation.playerLabel >= 15,
    "qualifying uses enlarged three-letter driver codes", markerPresentation);
  check(markerPresentation.coreOpacity === 1,
    "qualifying keeps every car marker core fully opaque in all lap phases", markerPresentation);

  const rail = page.getByLabel("Qualifying driver control");
  const releaseControls = rail.getByRole("group", { name: "LEC pit release controls" });
  check(await releaseControls.getByRole("button").count() === 1, "pit release exposes one intentional release action");
  check(await rail.getByRole("button", { name: /Hold in Garage|Wait for Gap/i }).count() === 0, "pit release removes Hold and Wait controls");
  check(await rail.getByText("ACTIVE SET", { exact: true }).count() === 0, "qualifying removes the duplicate Active Set card");
  check(await rail.getByText("BATTERY STRATEGY", { exact: true }).count() === 0
    && await rail.getByRole("button", { name: /set energy mode/i }).count() === 0,
  "qualifying removes Battery Strategy and manual energy controls");
  check(await rail.getByText("NEXT ACTION", { exact: true }).count() === 0, "qualifying removes the Next Action strip");
  const tyreChoices = rail.locator("button[data-tyre-choice='true']");
  check(await tyreChoices.count() === 5, "qualifying exposes exactly five combined tyre choices");
  check(await rail.locator("button[data-tyre-set-choice='true']").count() >= 2, "qualifying exposes the selected compound's physical sets directly");
  const soft = rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await soft.click();
  const firstSoftSetId = await soft.getAttribute("data-set-id");
  await soft.click();
  const cycledSoftSetId = await soft.getAttribute("data-set-id");
  check(Boolean(firstSoftSetId && cycledSoftSetId && firstSoftSetId !== cycledSoftSetId), "reselecting Soft cycles to a different physical set", { firstSoftSetId, cycledSoftSetId });
  check(await rail.locator("button[data-tyre-choice='true'][aria-pressed='true']").count() === 1 && /SOFT/.test(await soft.innerText()), "selected combined tyre choice names its compound and resolves to one exact set");
  check(!/\d+%/.test(await soft.innerText()), "compound buttons leave remaining life to the physical-set row");
  check(/\d+%/.test(await rail.locator("button[data-tyre-set-choice='true']").first().innerText()), "physical-set buttons carry the remaining tyre life");

  await rail.getByRole("button", { name: "Control Lewis Hamilton, car 44" }).click();
  check(await rail.getAttribute("data-car-id") === "ferrari-2", "driver tab switches the command identity to HAM");
  const hamChoices = rail.locator("button[data-tyre-choice='true']");
  check(await hamChoices.count() === 5, "second driver retains all five combined tyre choices");
  const hamSoft = rail.locator("button[data-tyre-choice='true'][data-compound='SOFT']");
  await hamSoft.click();
  check(await hamSoft.getAttribute("aria-pressed") === "true" && Boolean(await hamSoft.getAttribute("data-set-id")), "second driver can select an exact physical tyre set");
  await rail.getByRole("button", { name: "Control Charles Leclerc, car 16" }).click();
  check(await rail.getAttribute("data-car-id") === "ferrari-1", "driver tab returns the command identity to LEC");

  await layoutMetrics(page, "Q1 READY 1280x720");
  await componentGeometry(page, "Q1 READY 1280x720");
  await page.screenshot({ path: resolve("qa/qualifying-mengto-ui-1280x720.png"), type: "png" });

  await rail.getByRole("button", { name: "LEC set out lap pace Aggressive Warm-up" }).click();
  await rail.getByRole("button", { name: "LEC set flying lap attack Maximum" }).click();
  await rail.getByRole("button", { name: "LEC set fuel plan 2 Laps + Margin" }).click();
  await rail.getByRole("button", { name: "LEC Release Now" }).click();
  await page.locator("[aria-label='Qualifying driver control'][data-lap-status='OUTLAP']").waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas[data-renderer='SINGLE_CANVAS']");
    return Number(canvas?.getAttribute("data-active-cars") ?? 0) > 0;
  });
  check(Number(await page.locator("canvas[data-renderer='SINGLE_CANVAS']").getAttribute("data-active-cars")) > 0, "release adds live cars to the single canvas");
  check(await rail.getByRole("meter").count() === 5, "out lap keeps speed and four tyre meters live");

  await page.getByRole("button", { name: "Set simulation speed to 16 times" }).click();
  await page.locator("[aria-label='Qualifying driver control'][data-lap-status='FLYING LAP']").waitFor({ timeout: 20_000 });
  check(await rail.getByRole("meter").count() === 5, "flying lap keeps speed and four tyre meters live without battery controls");
  await page.waitForTimeout(30_000);
  await page.getByRole("button", { name: "Pause qualifying" }).click();
  await page.locator("main[data-qualifying-paused='true']").waitFor();
  const pausedLegendState = await page.locator("[data-traffic-overview='true'] [data-phase='PUSH_LAP']").evaluate((element) => getComputedStyle(element).animationPlayState);
  check(pausedLegendState === "paused", "flying-lap legend pulse pauses with the simulation", pausedLegendState);

  await page.setViewportSize({ width: 1440, height: 900 });
  await layoutMetrics(page, "Q1 LIVE 1440x900");
  await componentGeometry(page, "Q1 LIVE 1440x900");
  await page.screenshot({ path: resolve("qa/qualifying-mengto-ui-1440x900.png"), type: "png" });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await layoutMetrics(page, "Q1 LIVE 1920x1080");
  await componentGeometry(page, "Q1 LIVE 1920x1080");
  await page.screenshot({ path: resolve("qa/qualifying-mengto-ui-1920x1080.png"), type: "png" });

  check(results.consoleErrors.length === 0, "browser reports no runtime errors", results.consoleErrors);
  await writeFile(resolve("qa/qualifying-mengto-ui-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  await context.close();
} finally {
  await browser.close();
}
