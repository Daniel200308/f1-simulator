# Design QA — Full Circuit & Contextual Driver Radio V2

## Final result

**PASSED** — no open P0, P1, or P2 issues.

## Review setup

- Implementation: `http://127.0.0.1:3000/`
- Baseline: `qa/race-layout-radio-v2-baseline-1280x720.jpg`
- Final desktop states: `qa/race-layout-radio-v2-final-1280x720.jpg`, `qa/race-layout-radio-v2-final-1440x900.jpg`, `qa/race-layout-radio-v2-final-1600x900.jpg`
- Native-window evidence: `qa/race-layout-radio-v2-final-native.jpg`, `qa/race-layout-radio-v2-final-native-rain-direct.jpg`
- Native host: 1470×956 screen, 1470×783 browser content area, DPR 2

## Visual and interaction review

| Area | Result | Notes |
| --- | --- | --- |
| Circuit visibility | Pass | The circuit is drawn only inside a calculated safe viewport. Neither radio nor surface information covers any track segment. |
| Monitor fit | Pass | 1280×720, 1440×900, 1600×900 and the native macOS window all fit without page scrolling or clipped required regions. |
| Radio legibility | Pass | Line clamping is removed; the latest driver report expands to its natural height and remains inside the right information rail. |
| Weather context | Pass | Live rain onset produced a colloquial Maggotts report and wettest-sector request. Sustained rain, wet grip, aquaplaning, drying line and crossover have dedicated state rules. |
| Surface information | Pass | Local Surface moved from on-track overlay to the same reserved information rail below radio. |
| Lower workspace | Pass | LIVE CALL and the complete strategy timeline component/styles are removed. The recovered height is assigned to the circuit. |
| Driver controls | Pass | Both driver selectors and all remaining race commands were exercised with normal input and returned to their original state. |

## Closed findings

- **P1 — circuit obstruction:** Local Surface physically covered the left side of Silverstone. It now lives in a dedicated right rail whose width is also reserved by the Pixi viewport calculation.
- **P1 — truncated radio:** the message had `scrollHeight 68px` but only `clientHeight 41px`. Final dense states measured `71/71px`, `78/78px` and `94/94px`.
- **P2 — inefficient lower bar:** LIVE CALL consumed 230px at the smallest desktop. Removing it increases the 1280×720 circuit by 60px; wide desktops gain a 594px-high circuit with a compact one-row command dock.

## Automated verification

- `npm test`: 21 files, 164 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

---

# Previous QA — Race Workspace & Contextual Debrief

## Final result

**PASSED** — no open P0, P1, or P2 issues.

## Review setup

- Implementation: `http://127.0.0.1:3000/`
- Race screenshots: `qa/race-layout-final-1280x720.jpg`, `qa/race-layout-final-1600x900.jpg`
- Practice screenshots: `qa/practice-ui-final-1280x720.jpg`, `qa/practice-report-final-1280x720.jpg`
- Review states: McLaren FP1 ready, McLaren FP1 report, live McLaren race
- Viewports: 1280×720 and 1600×900 at 100% application scale

## Visual and interaction review

| Area | Result | Notes |
| --- | --- | --- |
| Circuit containment | Pass | Canvas and track host share the exact same bounds at both desktop sizes; the previous 360 px canvas minimum no longer clips the lower circuit. |
| Circuit radio | Pass | The transparent Team/Driver Radio overlay occupies a reserved upper-right zone and stays outside the calculated track viewport. |
| Vehicle telemetry | Pass | The right column contains two equal-height, expanded car-status panels with no separate radio card. |
| Driver controls | Pass | Cooling mode and Brake Bias controls are absent; Pace, Energy, Tyre Management and Next Tyre remain. |
| Leader Board gaps | Pass | Car-ahead gaps render in white at 11 px/950 weight and continue updating to three decimals. |
| Playback and Race Control | Pass | Auto is absent; Race Control no longer exposes category/scope/lap metadata and incident states receive a cause line. |
| Weekend progress | Pass | FP1 remains visible and active on initial entry; every session, including Race, stays on the seven-step rail. |
| Session Plan | Pass | The obsolete panel is removed and initial garage telemetry uses the full workspace width. |
| Debrief density | Pass | Both two-car reports fit within 1280×720 without page or modal scrolling. |
| Team portability | Pass | McLaren completed FP1–Q3 and entered the race with NOR/PIA and no hard-coded Ferrari failure. |

## Runtime finding closed during QA

- **P1 — team-switch race transition:** Pixi cleanup previously called `replaceChildren()` on the React-owned map host. Changing constructor and then inserting the start-light overlay caused a DOM `insertBefore` failure. Cleanup now removes only the Pixi canvas; the full selected-team weekend and race-start flow completes without a page error.

## Automated verification

- `npm test`: 21 files, 162 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

---

# Previous QA — Practice & Qualifying Garage Telemetry

## Final result

**PASSED** — no open P0, P1, or P2 issues.

## Review setup

- Reference: `/Users/daniel/.codex/generated_images/019f55bd-cc6d-7982-b5b9-998a0d909c5a/exec-5581be3b-5214-4d54-977b-f720fc1fa60f.png`
- Implementation: `http://127.0.0.1:3000/`
- Final screenshot: `/Users/daniel/Documents/F1 Simulator/qa/practice-ui-final.png`
- Review state: Ferrari selected, FP1 ready, desktop viewport
- Comparison method: reference and implementation inspected together at the same desktop state

## Visual review

| Area | Result | Notes |
| --- | --- | --- |
| Session hierarchy | Pass | FP1/FP2/FP3 and Q1/Q2/Q3 progression is immediately readable; the obsolete duration label is absent. |
| Two-car composition | Pass | Setup gauges sit on the outer edges and both top-view cars form the central visual anchor, matching the selected direction. |
| Setup controls | Pass | Front wing, suspension, and cooling are expressed as labelled graphical sliders with clear values and endpoints. |
| Session plan | Pass | The run programme remains visible beside the garage canvas without covering either car. |
| Debrief dock | Pass | Driver and engineer feedback for both cars is visible in one horizontal row without page scrolling. |
| Primary action | Pass | `RUN FP1` is visually dominant, high contrast, and uses a large label. |
| Typography | Pass | Primary and body copy is legible at the target viewport; formerly tiny setup and speaker metadata was increased. |
| Responsive containment | Pass | No clipped primary controls, overlapping text, or horizontal page overflow at the tested desktop viewport. |

## Interaction and state review

- Team selection was exercised for all 11 constructors; each entered the weekend with its correct two drivers and no simulation-link error.
- Setup sliders are keyboard- and pointer-operable range inputs with driver-specific accessible labels.
- FP1 and FP2 were run end to end; classification, weekend progression, report modal, and acknowledgement controls all updated correctly.
- FP1 and FP2 produced different driver and engineer reports, confirming contextual message variation.
- Post-build browser inspection found no runtime error markers or Next.js error overlay.

## Automated verification

- `npm test`: 21 files, 159 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

## Closed findings

- **P1 — Composition mismatch:** setup controls and cars were initially reversed relative to the selected mock. Fixed by moving gauges outward and cars inward.
- **P2 — Small metadata:** setup details, slider endpoints, session rail metadata, and speaker labels were too small. Increased while preserving the compact broadcast density.
- **P2 — Decimal sentence truncation:** abbreviated engineer feedback split lap times such as `91.063` at the decimal. Sentence parsing now preserves numeric decimals.

---

## Previous QA record — Race HUD and Race Control

- Source visual truth: `qa/source-topbar-before.png`
- Browser-rendered implementation: `qa/race-hud-1304x768.jpeg`
- Focused implementation crops: `qa/race-topbar-1280x62.jpeg`, `qa/race-radio-265x154.jpeg`
- Combined comparison input: `qa/topbar-before-after.png`
- Viewport: 1303 × 768 desktop browser window at 100% zoom; 1280 px application HUD crop
- State: Ferrari race running at 16×, lap 2, green flag, unified LEC/HAM team radio populated

**Result: passed**

- No actionable P0, P1, or P2 differences remained.
- The Round panel and Track Flag panel no longer contained circular flag glyphs.
- The Track Flag state used the entire panel as the semantic color surface.
- The persistent FIA Race Control region and unified Ferrari Radio card remained readable at the compact desktop viewport.
- Weekend entry, FP1–FP3, Q1–Q3 reports, race start, speed change, and populated radio state were exercised through the browser.
