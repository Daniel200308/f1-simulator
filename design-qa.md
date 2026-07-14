# Design QA

- Source visual truth: `qa/source-topbar-before.png`
- Browser-rendered implementation: `qa/race-hud-1304x768.jpeg`
- Focused implementation crops: `qa/race-topbar-1280x62.jpeg`, `qa/race-radio-265x154.jpeg`
- Combined comparison input: `qa/topbar-before-after.png`
- Viewport: 1303 × 768 desktop browser window at 100% zoom; 1280 px application HUD crop
- State: Ferrari race running at 16×, lap 2, green flag, unified LEC/HAM team radio populated

**Findings**

- No actionable P0, P1, or P2 differences remain.
- The Round panel and Track Flag panel no longer contain circular flag glyphs. The comparison image verifies the requested before/after change in one visual input.
- The Track Flag state uses the entire panel as the semantic color surface; the steady green state is visually distinct without relying on an icon.
- The FIA Race Control region remains centered and visible with the idle monitoring message, larger primary copy, and category/scope/lap metadata.
- The Ferrari Radio card remains legible at the compact 1303 × 768 desktop viewport. Timestamp, driver/source, message body, and unified-channel status have clear hierarchy.

**Required Fidelity Surfaces**

- Fonts and typography: the established project mono/display stack is retained. The central Race Control message and Radio body now carry the dominant readable weights; condensed labels remain secondary.
- Spacing and layout rhythm: the four-part topbar stays on one baseline, avoids overlap, and preserves simulation controls at 100% zoom. Removing both icon columns gives the status copy more usable width.
- Colors and visual tokens: existing cyan, green, red, and dark broadcast tokens are preserved. Green fills the Track Flag panel; FIA red remains a thin broadcast accent rather than competing with the live flag state.
- Image quality and asset fidelity: no replacement raster asset is required. The requested flag icons were intentionally removed rather than approximated with emoji, CSS drawings, or custom SVG.
- Copy and content: the OpenF1-shaped feed exposes category, scope, lap, sector, and car metadata where applicable and uses a stable `TRACK CLEAR · RACE CONTROL MONITORING` idle message.

**Full-view Comparison Evidence**

- `qa/race-hud-1304x768.jpeg` shows the entire running race screen with Leader Board, circuit, Driver Control, both Ferrari telemetry cards, and Team Radio without viewport clipping.
- Weekend entry, FP1–FP3, Q1–Q3 reports, race start, speed change, and populated radio state were operated through the browser before capture.

**Focused Region Comparison Evidence**

- `qa/topbar-before-after.png` places the user-provided previous header and the updated implementation in the same image. Both circular flag icons are absent, the full-color Track Flag panel is present, and the persistent central FIA feed is visible.
- `qa/race-radio-265x154.jpeg` verifies readable timestamp, `LEC · DRIVER` attribution, multi-line message copy, and persistent unified-channel indicator at the actual compact viewport.

**Primary Interactions Tested**

- Select Ferrari and enter the weekend.
- Run and acknowledge FP1, FP2, FP3, Q1, Q2, and Q3 reports.
- Start the formation/start-light sequence and enter the live race.
- Change simulation rate from 1× to 16×.
- Observe live Leader Board updates and generated LEC/HAM Team Radio messages.

**Console Errors Checked**

- No Next.js error overlay, failed page state, or broken accessibility tree appeared during the browser journey.
- The direct in-app browser diagnostics bridge could not initialize in this Codex build, so a raw console-log export was unavailable. TypeScript, ESLint, Vitest, production build, HTTP 200, and the rendered browser journey are checked separately.

**Comparison History**

- Iteration 1: direct in-app capture was blocked by the browser diagnostics runtime, leaving the prior QA result blocked.
- Iteration 2: captured the same local application through the user's desktop browser at 100% zoom, completed the full weekend journey, populated Team Radio, and generated both full-view and same-input focused comparison evidence.
- Post-fix evidence: `qa/topbar-before-after.png`, `qa/race-hud-1304x768.jpeg`, and `qa/race-radio-265x154.jpeg`.

**Follow-up Polish**

- P3: on very short desktop windows the radio intentionally prioritizes one complete, readable message at a time; the remaining messages stay available in the scrollable log.

final result: passed
