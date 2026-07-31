import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3111";
const stage = process.env.QA_STAGE ?? "before";
const VIEWPORTS = [
  { label: "desktop-1920x1080", width: 1920, height: 1080 },
  { label: "desktop-1440x900", width: 1440, height: 900 },
  { label: "laptop-1280x720", width: 1280, height: 720 },
  { label: "laptop-1180x800", width: 1180, height: 800 },
  { label: "tablet-1024x768", width: 1024, height: 768 },
  { label: "tablet-834x1112", width: 834, height: 1112 },
  { label: "phone-430x932", width: 430, height: 932 },
  { label: "phone-390x844", width: 390, height: 844 },
  { label: "phone-360x740", width: 360, height: 740 },
];

async function acknowledge(page, label) {
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
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

async function audit(page, label) {
  return page.evaluate(() => {
    const round = (value) => Math.round(value * 10) / 10;
    const buttons = [...document.querySelectorAll("main button")].filter((button) => {
      const style = getComputedStyle(button);
      return style.display !== "none" && style.visibility !== "hidden" && button.getBoundingClientRect().width > 0;
    });
    const tooSmall = buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim().slice(0, 46),
          w: round(rect.width),
          h: round(rect.height),
        };
      })
      .filter((entry) => entry.w < 44 || entry.h < 44);
    const textOverflow = [...document.querySelectorAll("main button *, main button")]
      .filter((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
      })
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        cls: node.className?.toString().slice(0, 40),
        text: (node.textContent ?? "").trim().slice(0, 30),
        scrollW: node.scrollWidth,
        clientW: node.clientWidth,
        scrollH: node.scrollHeight,
        clientH: node.clientHeight,
      }));
    const tinyText = [...new Set(buttons.flatMap((button) => [button, ...button.querySelectorAll("*")]))]
      .filter((node) => (node.textContent ?? "").trim().length > 0 && node.children.length === 0)
      .map((node) => ({
        text: (node.textContent ?? "").trim().slice(0, 22),
        size: Number.parseFloat(getComputedStyle(node).fontSize),
      }))
      .filter((entry) => entry.size < 11);
    const overflowing = [...document.querySelectorAll("main *")]
      .filter((node) => node.scrollWidth > node.clientWidth + 2 && getComputedStyle(node).overflowX === "hidden")
      .map((node) => ({ tag: node.tagName.toLowerCase(), cls: node.className?.toString().slice(0, 44), scrollW: node.scrollWidth, clientW: node.clientWidth }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      docScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      buttonCount: buttons.length,
      tooSmallCount: tooSmall.length,
      tooSmall: tooSmall.slice(0, 24),
      textOverflowCount: textOverflow.length,
      textOverflow: textOverflow.slice(0, 16),
      tinyTextCount: tinyText.length,
      tinyTextMin: tinyText.length ? Math.min(...tinyText.map((entry) => entry.size)) : null,
      tinyText: tinyText.slice(0, 16),
      clippedContainers: overflowing.slice(0, 12),
    };
  });
}

const browser = await chromium.launch({ headless: true });
const report = { stage, target, viewports: {} };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await enterQ1(page);
  await mkdir(resolve("qa/responsive"), { recursive: true });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(420);
    report.viewports[viewport.label] = await audit(page, viewport.label);
    await page.screenshot({ path: resolve(`qa/responsive/qualifying-${stage}-${viewport.label}.png`), fullPage: viewport.width < 1101 });
  }
  report.consoleErrors = consoleErrors;
  await writeFile(resolve(`qa/responsive/qualifying-${stage}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(
    Object.fromEntries(Object.entries(report.viewports).map(([key, value]) => [key, {
      horizontalScroll: value.horizontalScroll,
      docScroll: value.docScroll,
      buttons: value.buttonCount,
      tooSmall: value.tooSmallCount,
      textOverflow: value.textOverflowCount,
      tinyText: value.tinyTextCount,
      tinyTextMin: value.tinyTextMin,
      clipped: value.clippedContainers.length,
    }])),
    null,
    2,
  ));
  await context.close();
} finally {
  await browser.close();
}
