import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://192.168.0.7:3000";
const results = { target, passed: [], failures: [], consoles: [], requests: [], viewports: {} };

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${JSON.stringify(details)}` : ""}`);
  results.passed.push(message);
}

async function exerciseEntry(browser, config) {
  const context = await browser.newContext({
    viewport: config.viewport,
    hasTouch: config.hasTouch,
    isMobile: config.isMobile,
    deviceScaleFactor: config.deviceScaleFactor ?? 1,
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") results.consoles.push({ viewport: config.label, type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => results.consoles.push({ viewport: config.label, type: "pageerror", text: error.message }));
  page.on("requestfailed", (request) => results.requests.push({ viewport: config.label, url: request.url(), failure: request.failure()?.errorText }));

  await page.goto(target, { waitUntil: "networkidle" });
  const teamOption = page.getByRole("option", { name: /Mercedes/i });
  const confirm = page.getByRole("button", { name: /ENTER WEEKEND/i });
  await teamOption.scrollIntoViewIfNeeded();
  const teamBox = await teamOption.boundingBox();
  const teamHit = teamBox ? await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return { tag: hit?.tagName, text: hit?.textContent?.trim().slice(0, 80), role: hit?.getAttribute("role") };
  }, { x: teamBox.x + teamBox.width / 2, y: teamBox.y + teamBox.height / 2 }) : null;
  check(await teamOption.getAttribute("aria-selected") === "false", `${config.label} starts with a different constructor selected`);
  if (config.hasTouch) await teamOption.tap();
  else await teamOption.click();
  check(await teamOption.getAttribute("aria-selected") === "true", `${config.label} team selection reacts to ${config.hasTouch ? "touch" : "mouse"}`, { teamBox, teamHit });

  await confirm.scrollIntoViewIfNeeded();
  const confirmBox = await confirm.boundingBox();
  const hit = confirmBox ? await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return { tag: element?.tagName, text: element?.textContent?.trim().slice(0, 80), className: element?.className };
  }, { x: confirmBox.x + confirmBox.width / 2, y: confirmBox.y + confirmBox.height / 2 }) : null;
  check(Boolean(confirmBox && confirmBox.width >= 44 && confirmBox.height >= 44), `${config.label} confirm control has a usable touch target`, confirmBox);
  check(hit?.tag === "BUTTON" || hit?.tag === "svg" || hit?.tag === "path", `${config.label} confirm control is not covered by an overlay`, hit);
  await page.screenshot({ path: resolve(`qa/lan-touch-${config.label}-before.png`), type: "png" });
  if (config.hasTouch) await confirm.tap();
  else await confirm.click();
  await page.locator('[data-weekend-session="FP1"]').waitFor({ timeout: 5_000 });
  check(await page.locator('[data-weekend-session="FP1"]').isVisible(), `${config.label} ENTER WEEKEND advances to FP1`);

  const run = page.getByRole("button", { name: "RUN FP1" });
  await run.scrollIntoViewIfNeeded();
  if (config.hasTouch) await run.tap();
  else await run.click();
  await page.getByRole("dialog").waitFor({ timeout: 5_000 });
  check(await page.getByRole("dialog").isVisible(), `${config.label} RUN FP1 remains interactive after LAN entry`);
  const reportLayout = await page.getByRole("dialog").evaluate((dialog) => {
    const cards = dialog.querySelector('[class*="reportCars"]');
    return {
      dialogWidth: dialog.getBoundingClientRect().width,
      viewportWidth: innerWidth,
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
      cardColumns: cards ? getComputedStyle(cards).gridTemplateColumns.split(" ").length : 0,
    };
  });
  check(reportLayout.dialogWidth <= reportLayout.viewportWidth && reportLayout.scrollWidth <= reportLayout.clientWidth + 1, `${config.label} report stays within the viewport`, reportLayout);
  if (config.viewport.width <= 700) check(reportLayout.cardColumns === 1, `${config.label} report stacks driver cards for readable touch use`, reportLayout);
  await page.screenshot({ path: resolve(`qa/lan-touch-${config.label}-after.png`), type: "png" });

  results.viewports[config.label] = await page.evaluate(() => ({
    innerWidth,
    innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  for (const config of [
    { label: "phone-390x844", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    { label: "tablet-1024x768", viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    { label: "desktop-1440x900", viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
  ]) {
    try {
      await exerciseEntry(browser, config);
    } catch (error) {
      results.failures.push({ viewport: config.label, message: error instanceof Error ? error.message : String(error) });
    }
  }
} finally {
  await browser.close();
}

await writeFile(resolve("qa/lan-touch-playwright-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (results.failures.length) process.exit(1);
