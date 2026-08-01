import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.QA_TARGET ?? "http://127.0.0.1:3000";
const label = process.env.QA_LABEL ?? "current";
const ack = async (page, name) => page.getByRole("dialog").getByRole("button", { name }).click();

const browser = await chromium.launch();
const qaDir = resolve("qa", "team-setup");
await mkdir(qaDir, { recursive: true });

try {
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1280, height: 720 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const size = `${viewport.width}x${viewport.height}`;

    // Team selection panel.
    await page.goto(target, { waitUntil: "networkidle" });
    await page.getByRole("option", { name: /Ferrari/i }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(qaDir, `${label}-team-${size}.png`) });

    const typography = await page.evaluate(() => {
      /*
       * The selection panel is an overlay above the already-mounted race shell,
       * so every query is scoped to the panel. A document-wide search would
       * report the dock underneath and hide real panel problems.
       */
      const panel = [...document.querySelectorAll("main")].find((node) => /Choose Your Team/.test(node.textContent ?? ""));
      if (!panel) return { error: "panel not found" };
      const read = (selector) => {
        const node = panel.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return { fontSize: style.fontSize, textAlign: style.textAlign, w: Math.round(box.width), h: Math.round(box.height) };
      };
      const clipped = [...panel.querySelectorAll("h1, h2, button, strong, small, p")]
        .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
        .map((node) => ({
          tag: node.tagName,
          text: (node.textContent ?? "").trim().slice(0, 40),
          overflowY: node.scrollHeight - node.clientHeight,
          overflowX: node.scrollWidth - node.clientWidth,
        }));
      // The brief column and the confirm button must both be fully on screen.
      const brief = panel.querySelector("aside");
      const confirm = [...panel.querySelectorAll("button")].find((node) => /ENTER WEEKEND/i.test(node.textContent ?? ""));
      const briefBox = brief?.getBoundingClientRect();
      const confirmBox = confirm?.getBoundingClientRect();
      return {
        h1: read("h1"),
        h2: read("h2"),
        panelOverflowY: panel.scrollHeight - panel.clientHeight,
        briefOverflowY: brief ? brief.scrollHeight - brief.clientHeight : null,
        confirmVisible: confirmBox && briefBox
          ? confirmBox.bottom <= briefBox.bottom + 1 && confirmBox.bottom <= window.innerHeight + 1
          : null,
        clipped: clipped.slice(0, 12),
      };
    });
    console.log(`\n=== ${label} team panel ${size} ===`);
    console.log(JSON.stringify(typography, null, 2));

    // Practice setup lab and the debrief after FP1.
    await page.getByRole("button", { name: "ENTER WEEKEND" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(qaDir, `${label}-setup-${size}.png`) });
    await page.getByRole("button", { name: "RUN FP1" }).click();
    await ack(page, /ACKNOWLEDGE REPORT/i);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(qaDir, `${label}-debrief-${size}.png`) });

    const debrief = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("[data-speaker]")].map((node) => ({
        speaker: node.dataset.speaker,
        role: node.querySelector("header span")?.textContent ?? "",
        text: (node.querySelector("p")?.textContent ?? "").trim(),
        // A clamped card hides the sign-off, which is where the mood sits.
        clippedY: (() => {
          const p = node.querySelector("p");
          return p ? p.scrollHeight - p.clientHeight : null;
        })(),
      }));
      const setupLabels = [...document.querySelectorAll(".controlStack label > span b, [class*=controlStack] label > span b")].map((node) => ({
        text: node.textContent,
        fontSize: getComputedStyle(node).fontSize,
      }));
      const legends = [...document.querySelectorAll("[class*=rangeLegend] i")].map((node) => ({
        text: node.textContent,
        fontSize: getComputedStyle(node).fontSize,
      }));
      return { cards, setupLabels: setupLabels.slice(0, 6), legends: legends.slice(0, 4) };
    });
    console.log(`=== ${label} debrief + setup ${size} ===`);
    console.log(JSON.stringify(debrief, null, 2));
    await context.close();
  }
} finally {
  await browser.close();
}
